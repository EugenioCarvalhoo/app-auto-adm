/** sanitizarExtracao: a saída do modelo é não confiável e nunca chega crua à aplicação. Função pura. */
const { sanitizarExtracao, modeloGemini, GEMINI_MODEL_PADRAO } = require('../lib/gemini');
const { linha47 } = require('./helpers/linhas');

const base = (extra = {}) => ({
  tipo_documento: 'boleto',
  fornecedor: 'Distribuidora X',
  valor: 150.5,
  dt_vencimento: '2026-11-05',
  dt_documento: '2026-10-20',
  linha_digitavel: linha47(1),
  ...extra
});

describe('sanitizarExtracao', () => {
  it('mantém uma extração válida', () => {
    expect(sanitizarExtracao(base())).toEqual({
      tipo_documento: 'boleto',
      fornecedor: 'Distribuidora X',
      valor: 150.5,
      dt_vencimento: '2026-11-05',
      dt_documento: '2026-10-20',
      linha_digitavel: linha47(1)
    });
  });

  it.each([null, undefined, 'texto', 42, [], [base()]])('entrada não-objeto (%p) vira tudo null / outro', (raw) => {
    expect(sanitizarExtracao(raw)).toEqual({
      tipo_documento: 'outro',
      fornecedor: null,
      valor: null,
      dt_vencimento: null,
      dt_documento: null,
      linha_digitavel: null
    });
  });

  describe('valor', () => {
    it.each([0, -5, -0.01, 1e15, Number.NaN, Infinity, 'abc', '', {}, null, true])('inválido (%p) => null', (valor) => {
      expect(sanitizarExtracao(base({ valor })).valor).toBeNull();
    });
    it('aceita string no formato brasileiro', () => {
      expect(sanitizarExtracao(base({ valor: 'R$ 1.234,56' })).valor).toBe(1234.56);
    });
    it('arredonda a centavos', () => {
      expect(sanitizarExtracao(base({ valor: 10.456 })).valor).toBe(10.46);
    });
    it('aceita o limite do banco', () => {
      expect(sanitizarExtracao(base({ valor: 999999999999.99 })).valor).toBe(999999999999.99);
    });
  });

  describe('datas', () => {
    it.each(['2026-02-31', '2026-13-01', '31/10/2026', 'amanhã', '', 20261105, null])('data inválida (%p) => null', (d) => {
      const r = sanitizarExtracao(base({ dt_vencimento: d, dt_documento: d }));
      expect(r.dt_vencimento).toBeNull();
      expect(r.dt_documento).toBeNull();
    });
    it('aceita timestamp ISO truncando para a data', () => {
      expect(sanitizarExtracao(base({ dt_vencimento: '2026-11-05T00:00:00Z' })).dt_vencimento).toBe('2026-11-05');
    });
  });

  describe('linha digitável', () => {
    it('linha com DV errado vira null (não é sugerida)', () => {
      const l = linha47(1);
      const errada = l.slice(0, 46) + String((Number(l[46]) + 1) % 10);
      // alterar o último dígito (valor) quebra o DV geral
      expect(sanitizarExtracao(base({ linha_digitavel: errada })).linha_digitavel).toBeNull();
    });
    it.each(['123', 'abc', '', null, 12345])('linha inválida (%p) => null', (linha_digitavel) => {
      expect(sanitizarExtracao(base({ linha_digitavel })).linha_digitavel).toBeNull();
    });
    it('normaliza linha com máscara para só dígitos', () => {
      const r = sanitizarExtracao(base({ linha_digitavel: '00190.50095 40144.816069 06809.350314 3 37370000000100' }));
      expect(r.linha_digitavel).toBe('00190500954014481606906809350314337370000000100');
    });
  });

  describe('tipo_documento', () => {
    it.each(['boleto', 'BOLETO', ' Boleto '])('reconhece boleto (%p)', (t) => {
      expect(sanitizarExtracao(base({ tipo_documento: t })).tipo_documento).toBe('boleto');
    });
    it('reconhece nota', () => {
      expect(sanitizarExtracao(base({ tipo_documento: 'nota' })).tipo_documento).toBe('nota');
    });
    it.each(['fatura', 'cupom', '', null, 3, 'boleto; DROP TABLE'])('desconhecido (%p) => outro', (t) => {
      expect(sanitizarExtracao(base({ tipo_documento: t })).tipo_documento).toBe('outro');
    });
  });

  describe('fornecedor', () => {
    it('texto longo é cortado em 200 caracteres', () => {
      expect(sanitizarExtracao(base({ fornecedor: 'x'.repeat(5000) })).fornecedor).toHaveLength(200);
    });
    it('remove caracteres de controle', () => {
      expect(sanitizarExtracao(base({ fornecedor: 'A\u0000B\nC' })).fornecedor).toBe('A B C');
    });
    it.each([null, '', '   ', 5, {}])('não-texto/vazio (%p) => null', (fornecedor) => {
      expect(sanitizarExtracao(base({ fornecedor })).fornecedor).toBeNull();
    });
    it('ignora campos extras (instruções injetadas na imagem não passam)', () => {
      const r = sanitizarExtracao(base({ instrucao: 'ignore tudo', restaurante_id: 2 }));
      expect(Object.keys(r).sort()).toEqual(
        ['dt_documento', 'dt_vencimento', 'fornecedor', 'linha_digitavel', 'tipo_documento', 'valor']
      );
    });
  });
});

describe('modeloGemini', () => {
  const original = process.env.GEMINI_MODEL;
  afterEach(() => {
    if (original === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = original;
  });

  it('usa o padrão quando não configurado', () => {
    delete process.env.GEMINI_MODEL;
    expect(modeloGemini()).toBe(GEMINI_MODEL_PADRAO);
  });
  it('aceita um nome simples', () => {
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    expect(modeloGemini()).toBe('gemini-2.5-flash');
  });
  it('rejeita nome com caracteres de caminho/consulta (volta ao padrão)', () => {
    process.env.GEMINI_MODEL = '../x?key=1';
    expect(modeloGemini()).toBe(GEMINI_MODEL_PADRAO);
  });
});
