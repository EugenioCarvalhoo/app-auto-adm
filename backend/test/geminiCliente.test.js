/**
 * Configuração (GEMINI_BASE_URL / GEMINI_TIMEOUT_MS) e cliente REAL do Gemini (extrairBrutoDaImagem ->
 * chamarGeminiUmaVez), apontado para um servidor mock local (http://127.0.0.1:<porta>). A API do Google nunca é chamada.
 */
const crypto = require('crypto');
const http = require('http');
const request = require('supertest');
const { usarBancoReal, auth, U } = require('./helpers/setup');
const { jpeg } = require('./helpers/imagens');
const { linha47 } = require('./helpers/linhas');
const {
  baseUrlGemini,
  timeoutGeminiMs,
  leituraIaConfigurada,
  extrairBrutoDaImagem,
  definirExtratorImagem,
  GeminiErro,
  GEMINI_BASE_URL_PADRAO,
  GEMINI_TIMEOUT_MS
} = require('../lib/gemini');
const { definirStorage } = require('../lib/storage');
const { criarStorageFake } = require('./helpers/storageFake');
const { extrairRateLimit } = require('../lib/rateLimit');

const env = usarBancoReal();

const ORIGINAIS = {
  GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
  GEMINI_TIMEOUT_MS: process.env.GEMINI_TIMEOUT_MS,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL
};

function restaurarEnv() {
  Object.entries(ORIGINAIS).forEach(([k, v]) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
}

beforeEach(() => {
  delete process.env.GEMINI_BASE_URL;
  delete process.env.GEMINI_TIMEOUT_MS;
  delete process.env.GEMINI_MODEL;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  restaurarEnv();
  jest.restoreAllMocks();
});

describe('baseUrlGemini', () => {
  const definir = (v) => {
    process.env.GEMINI_BASE_URL = v;
    return baseUrlGemini();
  };

  it('ausente ou vazia => URL oficial padrão', () => {
    expect(baseUrlGemini()).toBe(GEMINI_BASE_URL_PADRAO);
    expect(definir('')).toBe(GEMINI_BASE_URL_PADRAO);
    expect(definir('   ')).toBe(GEMINI_BASE_URL_PADRAO);
  });

  it('https válido é aceito', () => {
    expect(definir('https://proxy.exemplo.com/v1beta/models')).toBe('https://proxy.exemplo.com/v1beta/models');
  });

  it.each(['http://localhost:4000/models', 'http://127.0.0.1:4000/models'])('http local (%s) é aceito', (u) => {
    expect(definir(u)).toBe(u);
  });

  it.each([
    ['http externo', 'http://api.exemplo.com/models'],
    ['http com host parecido com localhost', 'http://localhost.exemplo.com/models'],
    ['ftp', 'ftp://exemplo.com/models'],
    ['lixo', 'isto não é url'],
    ['só o esquema', 'https://'],
    ['usuário e senha', 'https://user:pass@exemplo.com/models'],
    ['só usuário', 'https://user@exemplo.com/models'],
    ['http local com credenciais', 'http://user:pass@127.0.0.1:4000/models']
  ])('rejeita %s', (_n, u) => {
    expect(definir(u)).toBeNull();
  });

  it('remove barras finais', () => {
    expect(definir('https://proxy.exemplo.com/v1beta/models/')).toBe('https://proxy.exemplo.com/v1beta/models');
    expect(definir('https://proxy.exemplo.com/v1beta/models///')).toBe('https://proxy.exemplo.com/v1beta/models');
  });

  it('leituraIaConfigurada é false com URL inválida, mesmo com chave', () => {
    process.env.GEMINI_API_KEY = 'chave-de-teste';
    process.env.GEMINI_BASE_URL = 'http://api.exemplo.com';
    expect(leituraIaConfigurada()).toBe(false);
    process.env.GEMINI_BASE_URL = 'https://ok.exemplo.com';
    expect(leituraIaConfigurada()).toBe(true);
  });
});

describe('timeoutGeminiMs', () => {
  it('ausente => padrão', () => {
    expect(timeoutGeminiMs()).toBe(GEMINI_TIMEOUT_MS);
  });
  it('inteiro positivo é usado', () => {
    process.env.GEMINI_TIMEOUT_MS = '1500';
    expect(timeoutGeminiMs()).toBe(1500);
  });
  it.each(['0', '-5', 'abc', '1.5', '10s', '', '  '])('inválido (%p) => padrão', (v) => {
    process.env.GEMINI_TIMEOUT_MS = v;
    expect(timeoutGeminiMs()).toBe(GEMINI_TIMEOUT_MS);
  });
});

describe('cliente real do Gemini contra servidor mock local', () => {
  let server;
  let porta;
  let chamadas;
  let respostas; // fila: função (req, res) por chamada; a última repete

  const textoOk = (obj) => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });
  const ok = (obj = { tipo_documento: 'nota', fornecedor: 'Loja', valor: 12.5 }) => (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(textoOk(obj));
  };
  const status = (codigo) => (_req, res) => {
    res.writeHead(codigo, { 'Content-Type': 'application/json' });
    res.end('{"error":"x"}');
  };
  const corpoCru = (txt) => (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(txt);
  };
  const naoResponde = () => {};

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const i = chamadas.length;
        chamadas.push({ url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
        const h = respostas[Math.min(i, respostas.length - 1)];
        h(req, res);
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    porta = server.address().port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    chamadas = [];
    respostas = [ok()];
    process.env.GEMINI_API_KEY = 'chave-de-teste';
    process.env.GEMINI_BASE_URL = `http://127.0.0.1:${porta}/v1beta/models/`;
    process.env.GEMINI_TIMEOUT_MS = '2000';
    definirExtratorImagem(null);
  });

  const extrair = () => extrairBrutoDaImagem(jpeg(1), 'image/jpeg');

  it('resposta ok: devolve o JSON do modelo e envia chave, modelo, imagem e schema', async () => {
    const r = await extrair();
    expect(r).toEqual({ tipo_documento: 'nota', fornecedor: 'Loja', valor: 12.5 });
    expect(chamadas).toHaveLength(1);
    const c = chamadas[0];
    expect(c.method).toBe('POST');
    expect(c.url).toBe('/v1beta/models/gemini-2.5-flash-lite:generateContent'); // barra final da base removida
    expect(c.headers['x-goog-api-key']).toBe('chave-de-teste');
    expect(c.url).not.toContain('chave-de-teste'); // chave só no header, nunca na URL
    const corpo = JSON.parse(c.body);
    expect(corpo.contents[0].parts[1].inline_data).toEqual({ mime_type: 'image/jpeg', data: jpeg(1).toString('base64') });
    expect(corpo.generationConfig.responseMimeType).toBe('application/json');
    expect(corpo.generationConfig.responseSchema).toBeTruthy();
  });

  it('GEMINI_MODEL válido entra na URL; inválido (com caminho) volta ao padrão', async () => {
    process.env.GEMINI_MODEL = 'gemini-teste-1.0';
    await extrair();
    expect(chamadas[0].url).toBe('/v1beta/models/gemini-teste-1.0:generateContent');
    process.env.GEMINI_MODEL = '../admin?x=1';
    await extrair();
    expect(chamadas[1].url).toBe('/v1beta/models/gemini-2.5-flash-lite:generateContent');
  });

  it.each([500, 503, 429])('status %i na 1a tentativa => 1 retry e sucesso', async (codigo) => {
    respostas = [status(codigo), ok()];
    const r = await extrair();
    expect(r.fornecedor).toBe('Loja');
    expect(chamadas).toHaveLength(2);
  });

  it('5xx nas duas tentativas => GeminiErro transitório após exatamente 2 chamadas', async () => {
    respostas = [status(500)];
    await expect(extrair()).rejects.toMatchObject({ name: 'GeminiErro', transitorio: true, message: expect.stringContaining('500') });
    expect(chamadas).toHaveLength(2);
  });

  it('4xx (exceto 429) não tem retry e não é transitório', async () => {
    respostas = [status(400), ok()];
    await expect(extrair()).rejects.toMatchObject({ name: 'GeminiErro', transitorio: false });
    expect(chamadas).toHaveLength(1);
  });

  it('corpo da resposta que não é JSON => "Resposta da IA inválida" (com retry)', async () => {
    respostas = [corpoCru('<html>oops</html>')];
    await expect(extrair()).rejects.toThrow('Resposta da IA inválida');
    expect(chamadas).toHaveLength(2);
  });

  it('texto do modelo que não é JSON => "não é JSON válido"; um retry bem sucedido recupera', async () => {
    const textoRuim = corpoCru(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'isto não é json' }] } }] }));
    respostas = [textoRuim];
    await expect(extrair()).rejects.toThrow('Resposta da IA não é JSON válido');
    expect(chamadas).toHaveLength(2);

    chamadas = [];
    respostas = [textoRuim, ok()];
    expect((await extrair()).fornecedor).toBe('Loja');
    expect(chamadas).toHaveLength(2);
  });

  it.each([
    ['sem candidates', '{}'],
    ['candidates vazio', '{"candidates":[]}'],
    ['sem parts', '{"candidates":[{"content":{}}]}'],
    ['parts sem texto', '{"candidates":[{"content":{"parts":[{"x":1}]}}]}']
  ])('resposta %s => "Resposta da IA vazia"', async (_n, corpo) => {
    respostas = [corpoCru(corpo)];
    await expect(extrair()).rejects.toThrow('Resposta da IA vazia');
  });

  it('timeout: servidor que não responde => GeminiErro transitório após abortar, com 1 retry', async () => {
    process.env.GEMINI_TIMEOUT_MS = '150';
    respostas = [naoResponde];
    const t0 = Date.now();
    // No sandbox do Jest o AbortError do fetch vem de outro realm (`instanceof Error` falha), então a mensagem
    // pode sair como "Falha de rede"; em Node puro sai "Tempo esgotado". Ambas são transitórias e caem em 502.
    await expect(extrair()).rejects.toMatchObject({
      name: 'GeminiErro',
      transitorio: true,
      message: expect.stringMatching(/Tempo esgotado ao consultar a IA|Falha de rede ao consultar a IA/)
    });
    expect(chamadas).toHaveLength(2);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('falha de rede (porta fechada) => GeminiErro "Falha de rede", sem vazar a chave', async () => {
    const tmp = http.createServer();
    await new Promise((resolve) => tmp.listen(0, '127.0.0.1', resolve));
    const portaMorta = tmp.address().port;
    await new Promise((resolve) => tmp.close(resolve));
    process.env.GEMINI_BASE_URL = `http://127.0.0.1:${portaMorta}/v1beta/models`;
    const erro = await extrair().catch((e) => e);
    expect(erro).toBeInstanceOf(GeminiErro);
    expect(erro.message).toBe('Falha de rede ao consultar a IA');
    expect(erro.message).not.toContain('chave-de-teste');
  });

  it('URL base inválida => GeminiErro "não configurada" sem chamar a rede', async () => {
    process.env.GEMINI_BASE_URL = 'http://api.exemplo.com/models';
    await expect(extrair()).rejects.toMatchObject({ message: 'Leitura por IA não configurada', transitorio: false });
    expect(chamadas).toHaveLength(0);
  });

  describe('POST /api/boletos/extrair com o cliente real', () => {
    let storage;
    beforeEach(() => {
      storage = criarStorageFake();
      definirStorage(storage);
      extrairRateLimit.reset();
    });
    afterEach(() => {
      definirStorage(null);
      extrairRateLimit.reset();
    });

    const enviar = (imagem = jpeg(31)) =>
      request(env.app)
        .post('/api/boletos/extrair')
        .set(auth(U.gerenteA))
        .field('restaurante_id', '1')
        .attach('imagem', imagem, { filename: 'a.jpg', contentType: 'image/jpeg' });

    it('200 com dados saneados vindos do mock, hash_sha256 da imagem e nada gravado (nem anexo, nem storage)', async () => {
      respostas = [
        ok({ tipo_documento: 'boleto', fornecedor: 'Distribuidora Sol', valor: 321.45, dt_vencimento: '2026-11-10', dt_documento: '2026-10-21', linha_digitavel: linha47(1) })
      ];
      const res = await enviar().expect(200);
      expect(res.body).toMatchObject({ tipo_sugerido: 'Boleto', fornecedor: 'Distribuidora Sol', valor: 321.45, linha_digitavel: linha47(1) });
      expect(res.body.hash_sha256).toBe(crypto.createHash('sha256').update(jpeg(31)).digest('hex'));
      expect(chamadas).toHaveLength(1);
      expect(Number((await env.um('SELECT count(*) AS n FROM boletos_anexos')).n)).toBe(0);
      expect(storage.chaves()).toEqual([]);
    });

    it('falha do mock (5xx) => 502, nenhum anexo gravado e a tentativa conta no teto diário', async () => {
      respostas = [status(500)];
      await enviar().expect(502);
      expect(Number((await env.um('SELECT count(*) AS n FROM boletos_anexos')).n)).toBe(0);
      expect((await env.um('SELECT total FROM boletos_extracoes_uso WHERE usuario_id = 2')).total).toBe(1);
    });

    it('GEMINI_BASE_URL inválida => 503 e o mock não é chamado', async () => {
      process.env.GEMINI_BASE_URL = 'ftp://exemplo.com';
      const res = await enviar().expect(503);
      expect(res.body.error).toMatch(/não configurada/);
      expect(chamadas).toHaveLength(0);
      expect(Number((await env.um('SELECT count(*) AS n FROM boletos_anexos')).n)).toBe(0);
    });
  });
});
