const fs = require('fs');
const path = require('path');

// Isola dotenv/fs: não depende do .env real da máquina.
describe('lib/loadEnv', () => {
  afterEach(() => jest.restoreAllMocks());

  function carregar(existe) {
    const config = jest.fn();
    jest.resetModules();
    jest.doMock('dotenv', () => ({ __esModule: true, default: { config }, config }));
    jest.spyOn(fs, 'existsSync').mockImplementation((p) => existe(String(p)));
    require('../src/config/loadEnv');
    jest.dontMock('dotenv');
    return config;
  }

  const backendEnv = path.resolve(__dirname, '..', '.env');

  it('carrega backend/.env quando existe', () => {
    const config = carregar((p) => path.resolve(p) === backendEnv);
    expect(config).toHaveBeenCalledTimes(1);
    expect(path.resolve(config.mock.calls[0][0].path)).toBe(backendEnv);
  });

  it('não carrega nada quando nenhum .env existe', () => {
    expect(carregar(() => false)).not.toHaveBeenCalled();
  });

  it('usa o .env de ../../ (dist) se o primeiro não existe, e só carrega um', () => {
    const dist = path.resolve(__dirname, '..', '..', '.env');
    const config = carregar((p) => path.resolve(p) === dist);
    expect(config).toHaveBeenCalledTimes(1);
    expect(path.resolve(config.mock.calls[0][0].path)).toBe(dist);
  });
});

describe('lib/loadEnv com dotenv real', () => {
  const tmp = path.join(require('os').tmpdir(), `loadenv-${process.pid}.env`);
  afterEach(() => { fs.rmSync(tmp, { force: true }); delete process.env.QA_LOADENV_NOVA; delete process.env.QA_LOADENV_EXISTE; });

  it('não sobrescreve variáveis já definidas', () => {
    fs.writeFileSync(tmp, 'QA_LOADENV_NOVA=do_arquivo\nQA_LOADENV_EXISTE=do_arquivo\n');
    process.env.QA_LOADENV_EXISTE = 'do_ambiente';
    require('dotenv').config({ path: tmp });
    expect(process.env.QA_LOADENV_NOVA).toBe('do_arquivo');
    expect(process.env.QA_LOADENV_EXISTE).toBe('do_ambiente');
  });
});
