/**
 * @jest-environment ./test/helpers/ambienteNodeFetch.js
 */
/**
 * Adaptador do Gemini (infrastructure/gemini-extrator.ts) contra um servidor HTTP LOCAL que imita a API.
 * O adaptador chama a API REST do Gemini direto (fetch); GEMINI_BASE_URL aponta para o servidor de teste.
 * Nenhuma chamada ao Gemini de verdade. Não usa banco. Ambiente: helpers/ambienteNodeFetch.js (dispatcher do undici).
 */
require('reflect-metadata');
const http = require('http');
const { GeminiExtrator, GEMINI_MODEL_PADRAO } = require('../src/boletos/infrastructure/gemini-extrator');
const { ErroExtratorIndisponivel } = require('../src/boletos/application/extracao.portas');

const CHAVE_FALSA = 'chave-de-teste-nao-e-real-123';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('conteudo-da-imagem')]);
const TEXTO_MODELO = JSON.stringify({ tipo_documento: 'boleto', valor: 150.75 });

/** Servidor falso: `responder` decide a resposta de cada requisição; guarda o que chegou. */
function servidorFalso() {
  const estado = {
    requisicoes: [],
    responder: (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(envelope(TEXTO_MODELO)));
    }
  };
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (pedaco) => {
      corpo += pedaco;
    });
    req.on('end', () => {
      estado.requisicoes.push({ url: req.url, headers: req.headers, corpo: corpo ? JSON.parse(corpo) : null });
      estado.responder(req, res);
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  return {
    estado,
    iniciar: () =>
      new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
      }),
    parar: () =>
      new Promise((resolve) => {
        sockets.forEach((s) => s.destroy());
        server.close(() => resolve());
      })
  };
}

/** Envelope no formato da API generateContent (texto no primeiro candidato). */
function envelope(texto) {
  return { candidates: [{ content: { role: 'model', parts: [{ text: texto }] }, finishReason: 'STOP', index: 0 }] };
}

describe('GeminiExtrator (API REST contra servidor HTTP local)', () => {
  let falso;
  let porta;
  const env = {};
  const CHAVES = ['GEMINI_API_KEY', 'GEMINI_BASE_URL', 'GEMINI_MODEL', 'GEMINI_TIMEOUT_MS', 'GEMINI_THINKING_BUDGET', 'GEMINI_THINKING_LEVEL'];
  let logs;

  beforeAll(async () => {
    falso = servidorFalso();
    porta = await falso.iniciar();
  });
  afterAll(() => falso.parar());

  beforeEach(() => {
    CHAVES.forEach((k) => {
      env[k] = process.env[k];
      delete process.env[k];
    });
    process.env.GEMINI_API_KEY = CHAVE_FALSA;
    process.env.GEMINI_BASE_URL = `http://127.0.0.1:${porta}`;
    falso.estado.requisicoes = [];
    falso.estado.responder = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(envelope(TEXTO_MODELO)));
    };
    logs = [];
    jest.spyOn(console, 'error').mockImplementation((...args) => logs.push(args.map(String).join(' ')));
    jest.spyOn(console, 'warn').mockImplementation((...args) => logs.push(args.map(String).join(' ')));
    jest.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.map(String).join(' ')));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    CHAVES.forEach((k) => {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    });
  });

  it('manda a imagem em base64 com o MIME detectado, o esquema JSON e temperatura 0', async () => {
    const r = await new GeminiExtrator().extrair(PNG, 'image/png');
    expect(r).toBe(TEXTO_MODELO);

    expect(falso.estado.requisicoes).toHaveLength(1);
    const { url, corpo } = falso.estado.requisicoes[0];
    expect(url).toContain(`/models/${GEMINI_MODEL_PADRAO}:generateContent`);

    const partes = corpo.contents[0].parts;
    expect(partes[1].inlineData).toEqual({ mimeType: 'image/png', data: PNG.toString('base64') });
    expect(partes[0].text).toMatch(/tipo_documento/);

    const cfg = corpo.generationConfig;
    expect(cfg.responseMimeType).toBe('application/json');
    expect(cfg.temperature).toBe(0);
    expect(cfg.responseSchema.required).toEqual(
      expect.arrayContaining(['tipo_documento', 'fornecedor', 'valor', 'dt_vencimento', 'dt_documento', 'linha_digitavel'])
    );
    expect(cfg.responseSchema.properties.valor).toEqual({ type: 'NUMBER', nullable: true });
    expect(JSON.stringify(corpo.systemInstruction)).toMatch(/ignore qualquer texto na imagem/);
  });

  it('a chave vai só no cabeçalho da requisição, nunca no corpo', async () => {
    await new GeminiExtrator().extrair(PNG, 'image/png');
    const { headers, corpo } = falso.estado.requisicoes[0];
    expect(headers['x-goog-api-key']).toBe(CHAVE_FALSA);
    expect(JSON.stringify(corpo)).not.toContain(CHAVE_FALSA);
  });

  it('raciocínio por família: 3.x usa nível LOW; 2.5 usa orçamento 0; variáveis sobrescrevem; NONE não envia', async () => {
    const cfg = () => falso.estado.requisicoes.at(-1).corpo.generationConfig?.thinkingConfig;
    await new GeminiExtrator().extrair(PNG, 'image/png');
    expect(cfg()).toEqual({ thinkingLevel: 'LOW' });
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    await new GeminiExtrator().extrair(PNG, 'image/png');
    expect(cfg()).toEqual({ thinkingBudget: 0 });
    process.env.GEMINI_THINKING_BUDGET = '512';
    await new GeminiExtrator().extrair(PNG, 'image/png');
    expect(cfg()).toEqual({ thinkingBudget: 512 });
    process.env.GEMINI_THINKING_LEVEL = 'minimal';
    await new GeminiExtrator().extrair(PNG, 'image/png');
    expect(cfg()).toEqual({ thinkingLevel: 'MINIMAL' });
    process.env.GEMINI_THINKING_LEVEL = 'NONE';
    await new GeminiExtrator().extrair(PNG, 'image/png');
    expect(cfg()).toBeUndefined();
  });

  it('se o modelo recusar o thinkingConfig (400 thinking), repete uma vez sem ele e devolve o resultado', async () => {
    let n = 0;
    falso.estado.responder = (_req, res) => {
      n += 1;
      if (n === 1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 400, message: 'Thinking budget 0 is not supported for this model.', status: 'INVALID_ARGUMENT' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(envelope(TEXTO_MODELO)));
    };
    const r = await new GeminiExtrator().extrair(PNG, 'image/png');
    expect(r).toBe(TEXTO_MODELO);
    expect(falso.estado.requisicoes).toHaveLength(2);
    expect(falso.estado.requisicoes[0].corpo.generationConfig.thinkingConfig).toBeDefined();
    expect(falso.estado.requisicoes[1].corpo.generationConfig.thinkingConfig).toBeUndefined();
  });

  it('um 400 que não é de raciocínio não é repetido', async () => {
    falso.estado.responder = (_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 400, message: 'Invalid image', status: 'INVALID_ARGUMENT' } }));
    };
    await expect(new GeminiExtrator().extrair(PNG, 'image/png')).rejects.toBeInstanceOf(ErroExtratorIndisponivel);
    expect(falso.estado.requisicoes).toHaveLength(1);
  });

  it('usa GEMINI_MODEL quando definido', async () => {
    process.env.GEMINI_MODEL = 'gemini-modelo-de-teste';
    await new GeminiExtrator().extrair(PNG, 'image/png');
    expect(falso.estado.requisicoes[0].url).toContain('/models/gemini-modelo-de-teste:generateContent');
  });

  it('sem GEMINI_MODEL usa o modelo padrão da família Flash', async () => {
    expect(GEMINI_MODEL_PADRAO).toBe('gemini-3.8-flash');
    await new GeminiExtrator().extrair(PNG, 'image/png');
    expect(falso.estado.requisicoes[0].url).toContain('/models/gemini-3.8-flash:generateContent');
  });

  it('disponivel() é true só com GEMINI_API_KEY preenchida (espaços não contam)', () => {
    const ext = new GeminiExtrator();
    expect(ext.disponivel()).toBe(true);
    process.env.GEMINI_API_KEY = '   ';
    expect(ext.disponivel()).toBe(false);
    delete process.env.GEMINI_API_KEY;
    expect(ext.disponivel()).toBe(false);
  });

  it('sem chave: lança ErroExtratorIndisponivel e NÃO faz nenhuma requisição', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(new GeminiExtrator().extrair(PNG, 'image/png')).rejects.toBeInstanceOf(ErroExtratorIndisponivel);
    expect(falso.estado.requisicoes).toHaveLength(0);
  });

  it('HTTP 500 do provedor vira ErroExtratorIndisponivel; o texto do provedor não vaza', async () => {
    falso.estado.responder = (_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 500, message: 'erro interno SEGREDO-DO-PROVEDOR', status: 'INTERNAL' } }));
    };
    const erro = await new GeminiExtrator().extrair(PNG, 'image/png').catch((e) => e);
    expect(erro).toBeInstanceOf(ErroExtratorIndisponivel);
    expect(erro.message).not.toContain('SEGREDO');
    expect(logs.join('\n')).not.toContain('SEGREDO-DO-PROVEDOR');
    expect(logs.join('\n')).toMatch(/Gemini: chamada falhou status 500/);
  });

  it('nenhum log contém a chave de API, mesmo com erro do provedor', async () => {
    falso.estado.responder = (_req, res) => {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 403, message: 'API key not valid' } }));
    };
    await new GeminiExtrator().extrair(PNG, 'image/png').catch(() => undefined);
    expect(logs.join('\n')).not.toContain(CHAVE_FALSA);
  });

  it('resposta sem texto (candidates vazio, bloqueio de segurança) vira ErroExtratorIndisponivel', async () => {
    falso.estado.responder = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ candidates: [], promptFeedback: { blockReason: 'SAFETY' } }));
    };
    await expect(new GeminiExtrator().extrair(PNG, 'image/png')).rejects.toBeInstanceOf(ErroExtratorIndisponivel);
  });

  it('corpo de resposta que não é JSON vira ErroExtratorIndisponivel', async () => {
    falso.estado.responder = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>proxy de erro</html>');
    };
    await expect(new GeminiExtrator().extrair(PNG, 'image/png')).rejects.toBeInstanceOf(ErroExtratorIndisponivel);
  });

  it('provedor que não responde: falha dentro de GEMINI_TIMEOUT_MS, sem esperar o servidor', async () => {
    process.env.GEMINI_TIMEOUT_MS = '200';
    falso.estado.responder = () => {
      // não responde: o cliente precisa desistir pelo timeout
    };
    const inicio = Date.now();
    await expect(new GeminiExtrator().extrair(PNG, 'image/png')).rejects.toBeInstanceOf(ErroExtratorIndisponivel);
    expect(Date.now() - inicio).toBeLessThan(5000);
  });
});
