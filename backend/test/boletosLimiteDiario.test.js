/**
 * Teto diário de leituras por IA (EXTRAIR_LIMITE_DIARIO, padrão 30) em POST /api/boletos/extrair.
 * Contador por usuário e por dia (America/Sao_Paulo) na tabela boletos_extracoes_uso, incremento atômico no banco.
 * O Gemini nunca é chamado: o extrator é um mock e o teste prova que ele NÃO é chamado depois do teto.
 */
const request = require('supertest');
const { usarBancoReal, auth, U } = require('./helpers/setup');
const { linha47 } = require('./helpers/linhas');
const { jpeg, png } = require('./helpers/imagens');
const { definirExtratorImagem, GeminiErro } = require('../lib/gemini');
// limiteDiario/boletos importam o pool (db.ts): só podem ser carregados depois de usarBancoReal() definir DB_* (beforeAll).
const limite = () => require('../lib/limiteDiario');
const reservarLeituraDiaria = (...args) => limite().reservarLeituraDiaria(...args);
const limiteDiarioExtracoes = (...args) => limite().limiteDiarioExtracoes(...args);
const hojeBrasil = () => require('../lib/boletos').hojeBrasil();
const { extrairRateLimit } = require('../lib/rateLimit');

const env = usarBancoReal();

const ROTA = '/api/boletos/extrair';
const extracao = () => ({
  tipo_documento: 'boleto',
  fornecedor: 'Distribuidora Sol',
  valor: 10,
  dt_vencimento: '2026-11-10',
  dt_documento: '2026-10-21',
  linha_digitavel: linha47(1)
});

function enviar(usuario, { rid = 1, imagem = jpeg(1), mime = 'image/jpeg', extra = {} } = {}) {
  let req = request(env.app).post(ROTA).set(auth(usuario));
  if (rid !== null) req = req.field('restaurante_id', String(rid));
  Object.entries(extra).forEach(([k, v]) => {
    req = req.field(k, v);
  });
  if (imagem) req = req.attach('imagem', imagem, { filename: 'foto.jpg', contentType: mime });
  return req;
}

const uso = (usuarioId) => env.rows('SELECT dia::text AS dia, total FROM boletos_extracoes_uso WHERE usuario_id = $1 ORDER BY dia', [usuarioId]);
const totalHoje = async (usuarioId) => {
  const r = await env.um('SELECT total FROM boletos_extracoes_uso WHERE usuario_id = $1 AND dia = $2::date', [usuarioId, hojeBrasil()]);
  return r ? r.total : 0;
};

describe('limite diário de leituras por IA', () => {
  let extrator;
  const original = {
    limite: process.env.EXTRAIR_LIMITE_DIARIO,
    rate: process.env.EXTRAIR_RATE_LIMIT_MAX,
    chave: process.env.GEMINI_API_KEY
  };

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    extrator = jest.fn(async () => extracao());
    definirExtratorImagem(extrator);
    extrairRateLimit.reset();
    process.env.EXTRAIR_LIMITE_DIARIO = '2';
    delete process.env.GEMINI_API_KEY;
  });
  afterEach(() => {
    definirExtratorImagem(null);
    extrairRateLimit.reset();
    ['limite:EXTRAIR_LIMITE_DIARIO', 'rate:EXTRAIR_RATE_LIMIT_MAX', 'chave:GEMINI_API_KEY'].forEach((par) => {
      const [k, nome] = par.split(':');
      if (original[k] === undefined) delete process.env[nome];
      else process.env[nome] = original[k];
    });
    jest.restoreAllMocks();
  });

  describe('a 3ª leitura com limite 2', () => {
    it('responde 429 LIMITE_DIARIO SEM chamar o Gemini e sem incrementar além do limite', async () => {
      await enviar(U.gerenteA, { imagem: jpeg(1) }).expect(200);
      await enviar(U.gerenteA, { imagem: jpeg(2) }).expect(200);
      expect(extrator).toHaveBeenCalledTimes(2);

      const res = await enviar(U.gerenteA, { imagem: jpeg(3) }).expect(429);
      expect(res.body).toMatchObject({ codigo: 'LIMITE_DIARIO' });
      expect(res.body.error).toMatch(/Limite diário/);
      expect(res.headers['retry-after']).toBeUndefined(); // não é o rate limit por minuto
      expect(extrator).toHaveBeenCalledTimes(2);
      expect(await totalHoje(2)).toBe(2);

      // continua negando, sem crescer
      await enviar(U.gerenteA, { imagem: jpeg(4) }).expect(429);
      await enviar(U.gerenteA, { imagem: jpeg(5) }).expect(429);
      expect(extrator).toHaveBeenCalledTimes(2);
      expect(await totalHoje(2)).toBe(2);
    });

    it('o 429 do rate limit por minuto NÃO usa o código LIMITE_DIARIO (o front distingue os dois)', async () => {
      process.env.EXTRAIR_LIMITE_DIARIO = '1000';
      const max = Number(process.env.EXTRAIR_RATE_LIMIT_MAX) || 10;
      for (let i = 0; i < max; i++) await enviar(U.gerenteA, { imagem: jpeg(100 + i) }).expect(200);
      const res = await enviar(U.gerenteA, { imagem: jpeg(999) }).expect(429);
      expect(res.body.codigo).not.toBe('LIMITE_DIARIO');
      expect(res.headers['retry-after']).toBeDefined();
    });
  });

  describe('contador por usuário e por dia', () => {
    it('é por usuário: esgotar o do gerenteA não afeta o admin nem o gerenteB', async () => {
      await enviar(U.gerenteA, { imagem: jpeg(1) }).expect(200);
      await enviar(U.gerenteA, { imagem: jpeg(2) }).expect(200);
      await enviar(U.gerenteA, { imagem: jpeg(3) }).expect(429);

      await enviar(U.admin, { imagem: jpeg(4) }).expect(200);
      await enviar(U.gerenteB, { rid: 2, imagem: jpeg(5) }).expect(200);
      expect(await totalHoje(1)).toBe(1);
      expect(await totalHoje(3)).toBe(1);
      expect(await totalHoje(2)).toBe(2);
    });

    it('o admin também está sujeito ao teto', async () => {
      await enviar(U.admin, { imagem: jpeg(1) }).expect(200);
      await enviar(U.admin, { imagem: jpeg(2) }).expect(200);
      await enviar(U.admin, { imagem: jpeg(3) }).expect(429);
    });

    it('o dia é a data de hojeBrasil() (America/Sao_Paulo) e há uma linha por usuário/dia', async () => {
      await enviar(U.gerenteA, { imagem: jpeg(1) }).expect(200);
      expect(await uso(2)).toEqual([{ dia: hojeBrasil(), total: 1 }]);
    });

    it('virada de dia: com o contador de ontem esgotado, hoje começa do zero (nova linha) e ontem fica preservado', async () => {
      await enviar(U.gerenteA, { imagem: jpeg(1) }).expect(200);
      await enviar(U.gerenteA, { imagem: jpeg(2) }).expect(200);
      await enviar(U.gerenteA, { imagem: jpeg(3) }).expect(429);

      // simula a virada: o contador esgotado passa a ser o de ONTEM
      await env.rows('UPDATE boletos_extracoes_uso SET dia = dia - 1 WHERE usuario_id = 2');
      await enviar(U.gerenteA, { imagem: jpeg(4) }).expect(200);
      await enviar(U.gerenteA, { imagem: jpeg(5) }).expect(200);
      await enviar(U.gerenteA, { imagem: jpeg(6) }).expect(429);

      const linhas = await uso(2);
      expect(linhas).toHaveLength(2);
      expect(linhas.map((l) => l.total)).toEqual([2, 2]);
      expect(linhas[1].dia).toBe(hojeBrasil());
      expect(linhas[0].dia < linhas[1].dia).toBe(true);
    });

    it('um contador de AMANHÃ (relógio adiantado) não conta para hoje', async () => {
      await env.rows(`INSERT INTO boletos_extracoes_uso (usuario_id, dia, total) VALUES (2, $1::date + 1, 99)`, [hojeBrasil()]);
      await enviar(U.gerenteA, { imagem: jpeg(1) }).expect(200);
      expect(await totalHoje(2)).toBe(1);
    });

    it('remover o usuário apaga o contador (ON DELETE CASCADE)', async () => {
      await enviar(U.gerenteA, { imagem: jpeg(1) }).expect(200);
      await env.rows('DELETE FROM usuarios WHERE id = 2');
      expect(await uso(2)).toEqual([]);
    });
  });

  describe('o limite é lido a cada uso', () => {
    it('subir o EXTRAIR_LIMITE_DIARIO libera de novo sem reiniciar', async () => {
      await enviar(U.gerenteA, { imagem: jpeg(1) }).expect(200);
      await enviar(U.gerenteA, { imagem: jpeg(2) }).expect(200);
      await enviar(U.gerenteA, { imagem: jpeg(3) }).expect(429);
      process.env.EXTRAIR_LIMITE_DIARIO = '3';
      await enviar(U.gerenteA, { imagem: jpeg(3) }).expect(200);
      await enviar(U.gerenteA, { imagem: jpeg(4) }).expect(429);
      expect(await totalHoje(2)).toBe(3);
    });

    it('baixar o limite abaixo do já usado nega imediatamente', async () => {
      process.env.EXTRAIR_LIMITE_DIARIO = '5';
      await enviar(U.gerenteA, { imagem: jpeg(1) }).expect(200);
      await enviar(U.gerenteA, { imagem: jpeg(2) }).expect(200);
      process.env.EXTRAIR_LIMITE_DIARIO = '1';
      await enviar(U.gerenteA, { imagem: jpeg(3) }).expect(429);
      expect(await totalHoje(2)).toBe(2);
    });

    it('sem a variável, vale o padrão (30): a 31ª leitura é negada', async () => {
      delete process.env.EXTRAIR_LIMITE_DIARIO;
      await env.rows('INSERT INTO boletos_extracoes_uso (usuario_id, dia, total) VALUES (2, $1::date, 29)', [hojeBrasil()]);
      await enviar(U.gerenteA, { imagem: jpeg(1) }).expect(200); // 30ª
      await enviar(U.gerenteA, { imagem: jpeg(2) }).expect(429); // 31ª
      expect(await totalHoje(2)).toBe(30);
    });
  });

  describe('o que NÃO conta no teto', () => {
    const naoConsumiu = async () => {
      expect(await totalHoje(2)).toBe(0);
      expect(extrator).not.toHaveBeenCalled();
    };

    it('sem arquivo (400)', async () => {
      await enviar(U.gerenteA, { imagem: null }).expect(400);
      await naoConsumiu();
    });

    it('sem restaurante_id (400)', async () => {
      await enviar(U.gerenteA, { rid: null }).expect(400);
      await naoConsumiu();
    });

    it('formato inválido (415): PNG declarado como JPEG e tipo não suportado', async () => {
      await enviar(U.gerenteA, { imagem: png(), mime: 'image/jpeg' }).expect(415);
      await enviar(U.gerenteA, { imagem: Buffer.from('GIF89a......'), mime: 'image/gif' }).expect(415);
      await naoConsumiu();
    });

    it('imagem grande demais (413)', async () => {
      await enviar(U.gerenteA, { imagem: Buffer.concat([jpeg(), Buffer.alloc(5 * 1024 * 1024 + 10)]) }).expect(413);
      await naoConsumiu();
    });

    it('sem acesso ao restaurante (403) e sem módulo (403)', async () => {
      await enviar(U.gerenteA, { rid: 2 }).expect(403);
      await enviar(U.semModulo).expect(403);
      await enviar(U.semVinculo).expect(403);
      expect(await uso(2)).toEqual([]);
      expect(await uso(4)).toEqual([]);
      expect(await uso(5)).toEqual([]);
      expect(extrator).not.toHaveBeenCalled();
    });

    it('sem token (401)', async () => {
      await request(env.app).post(ROTA).field('restaurante_id', '1').attach('imagem', jpeg(), { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(401);
      expect(await env.rows('SELECT * FROM boletos_extracoes_uso')).toEqual([]);
    });

    it('leitura por IA não configurada (503)', async () => {
      definirExtratorImagem(null);
      await enviar(U.gerenteA).expect(503);
      expect(await totalHoje(2)).toBe(0);
    });

    /** Marca a imagem como já cadastrada no restaurante 1 (anexo vinculado ao boleto 10), como após o fluxo completo. */
    const jaCadastrada = (imagem) =>
      env.rows(
        `INSERT INTO boletos_anexos (boleto_id, restaurante_id, usuario_id, storage_chave, mime, tamanho_bytes, hash_sha256)
         VALUES (10, 1, 2, $1, 'image/jpeg', $2, $3)`,
        [`1/${'a'.repeat(32)}.jpg`, imagem.length, require('crypto').createHash('sha256').update(imagem).digest('hex')]
      );

    it('imagem repetida (aviso sem chamar a IA): não conta; com forcar_repetida conta', async () => {
      const imagem = jpeg(8);
      await jaCadastrada(imagem);

      const repetida = await enviar(U.gerenteA, { imagem }).expect(200);
      expect(repetida.body.aviso_imagem_repetida).toBeTruthy();
      expect(extrator).not.toHaveBeenCalled();
      expect(await totalHoje(2)).toBe(0);

      await enviar(U.gerenteA, { imagem, extra: { forcar_repetida: 'true' } }).expect(200);
      expect(extrator).toHaveBeenCalledTimes(1);
      expect(await totalHoje(2)).toBe(1);
    });

    it('imagem repetida responde 200 (aviso) mesmo com o teto esgotado: não gasta IA, então não é bloqueada', async () => {
      const imagem = jpeg(9);
      await jaCadastrada(imagem);
      await env.rows('INSERT INTO boletos_extracoes_uso (usuario_id, dia, total) VALUES (2, $1::date, 2)', [hojeBrasil()]);

      const res = await enviar(U.gerenteA, { imagem }).expect(200);
      expect(res.body.aviso_imagem_repetida).toBeTruthy();
      // uma imagem nova continua bloqueada, e forçar a repetida também (gastaria IA)
      await enviar(U.gerenteA, { imagem: jpeg(10) }).expect(429);
      await enviar(U.gerenteA, { imagem, extra: { forcar_repetida: 'true' } }).expect(429);
      expect(extrator).not.toHaveBeenCalled();
      expect(await totalHoje(2)).toBe(2);
    });
  });

  describe('o que conta', () => {
    it('falha do Gemini (502) CONTA: a chamada saiu', async () => {
      extrator.mockRejectedValue(new GeminiErro('A IA respondeu com status 500', true));
      await enviar(U.gerenteA, { imagem: jpeg(1) }).expect(502);
      await enviar(U.gerenteA, { imagem: jpeg(2) }).expect(502);
      expect(await totalHoje(2)).toBe(2);
      await enviar(U.gerenteA, { imagem: jpeg(3) }).expect(429);
      expect(extrator).toHaveBeenCalledTimes(2);
    });

    it('erro inesperado do extrator (502) também conta', async () => {
      extrator.mockRejectedValue(new Error('boom'));
      await enviar(U.gerenteA, { imagem: jpeg(1) }).expect(502);
      expect(await totalHoje(2)).toBe(1);
    });
  });

  it('reservarLeituraDiaria: true até o limite, false depois, sem incrementar além dele', async () => {
    const r = [];
    for (let i = 0; i < 4; i++) r.push(await reservarLeituraDiaria(2, 2));
    expect(r).toEqual([true, true, false, false]);
    expect(await uso(2)).toEqual([{ dia: hojeBrasil(), total: 2 }]);
  });

  describe('concorrência', () => {
    it('requisições simultâneas nunca passam do limite (3 permitidas de 8 paralelas)', async () => {
      process.env.EXTRAIR_LIMITE_DIARIO = '3';
      const respostas = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((i) => enviar(U.gerenteA, { imagem: jpeg(200 + i) })));
      const status = respostas.map((r) => r.status);
      expect(status.filter((s) => s === 200)).toHaveLength(3);
      expect(status.filter((s) => s === 429)).toHaveLength(5);
      expect(respostas.filter((r) => r.status === 429).every((r) => r.body.codigo === 'LIMITE_DIARIO')).toBe(true);
      expect(extrator).toHaveBeenCalledTimes(3);
      expect(await totalHoje(2)).toBe(3);
      expect(await uso(2)).toHaveLength(1);
    });

    it('reservarLeituraDiaria direto: 20 chamadas paralelas com limite 5 => exatamente 5 verdadeiras', async () => {
      const resultados = await Promise.all(Array.from({ length: 20 }, () => reservarLeituraDiaria(2, 5)));
      expect(resultados.filter(Boolean)).toHaveLength(5);
      expect(await totalHoje(2)).toBe(5);
    });

    it('a primeira leitura do dia em paralelo não estoura a PK (INSERT ... ON CONFLICT)', async () => {
      const resultados = await Promise.all(Array.from({ length: 6 }, () => reservarLeituraDiaria(3, 10)));
      expect(resultados.every(Boolean)).toBe(true);
      expect(await totalHoje(3)).toBe(6);
    });
  });
});

describe('limiteDiarioExtracoes (valor da variável)', () => {
  it('padrão é 30', () => {
    expect(limite().LIMITE_DIARIO_PADRAO).toBe(30);
    expect(limiteDiarioExtracoes({})).toBe(30);
  });

  it.each([['5', 5], ['  7 ', 7], ['1', 1], ['100', 100]])('%p => %p', (bruto, esperado) => {
    expect(limiteDiarioExtracoes({ EXTRAIR_LIMITE_DIARIO: bruto })).toBe(esperado);
  });

  it.each(['', '0', '-1', '1.5', 'abc', '10 leituras', '1e3', '99999999999999999999999', '+5'])('inválido %p => padrão (não zera nem libera tudo)', (bruto) => {
    expect(limiteDiarioExtracoes({ EXTRAIR_LIMITE_DIARIO: bruto })).toBe(30);
  });
});
