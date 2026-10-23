/** Rate limit por usuário (em memória). Funções puras, sem banco. */
const { criarRateLimitPorUsuario, extrairRateLimit } = require('../lib/rateLimit');

function chamar(limiter, userId) {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    }
  };
  let passou = false;
  limiter.middleware({ user: userId === undefined ? undefined : { id: userId } }, res, () => {
    passou = true;
  });
  return { passou, res };
}

describe('rateLimit', () => {
  afterEach(() => {
    jest.useRealTimers();
    extrairRateLimit.reset();
  });

  it('deixa passar até o máximo e bloqueia a seguinte com 429 e Retry-After', () => {
    const l = criarRateLimitPorUsuario(3, 60000);
    for (let i = 0; i < 3; i++) expect(chamar(l, 1).passou).toBe(true);
    const r = chamar(l, 1);
    expect(r.passou).toBe(false);
    expect(r.res.statusCode).toBe(429);
    expect(Number(r.res.headers['Retry-After'])).toBeGreaterThanOrEqual(1);
    expect(r.res.body.error).toMatch(/Aguarde/);
  });

  it('o limite é por usuário', () => {
    const l = criarRateLimitPorUsuario(1, 60000);
    expect(chamar(l, 1).passou).toBe(true);
    expect(chamar(l, 1).passou).toBe(false);
    expect(chamar(l, 2).passou).toBe(true);
  });

  it('reset zera os contadores (isola um teste do outro)', () => {
    const l = criarRateLimitPorUsuario(1, 60000);
    expect(chamar(l, 1).passou).toBe(true);
    expect(chamar(l, 1).passou).toBe(false);
    l.reset();
    expect(chamar(l, 1).passou).toBe(true);
  });

  it('a janela desliza: depois do tempo, libera de novo', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-23T12:00:00Z'));
    const l = criarRateLimitPorUsuario(2, 1000);
    expect(chamar(l, 1).passou).toBe(true);
    expect(chamar(l, 1).passou).toBe(true);
    expect(chamar(l, 1).passou).toBe(false);
    jest.setSystemTime(new Date('2026-10-23T12:00:01.500Z'));
    expect(chamar(l, 1).passou).toBe(true);
  });

  it('requisições bloqueadas não prolongam o bloqueio', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-23T12:00:00Z'));
    const l = criarRateLimitPorUsuario(1, 1000);
    expect(chamar(l, 1).passou).toBe(true);
    jest.setSystemTime(new Date('2026-10-23T12:00:00.900Z'));
    expect(chamar(l, 1).passou).toBe(false);
    jest.setSystemTime(new Date('2026-10-23T12:00:01.100Z'));
    expect(chamar(l, 1).passou).toBe(true);
  });
});
