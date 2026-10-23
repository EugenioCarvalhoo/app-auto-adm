/**
 * lib/storage (sem rede, sem banco): lerConfigStorage (regras do endpoint), storageConfigurado/definirStorage/getStorage
 * e as validações de criarStorageS3 que acontecem ANTES de qualquer chamada ao S3. O S3 real (MinIO) é coberto em
 * storageMinio.test.js.
 */
const {
  lerConfigStorage,
  criarStorageS3,
  storageConfigurado,
  getStorage,
  definirStorage,
  StorageNaoConfigurado
} = require('../lib/storage');
const { criarStorageFake } = require('./helpers/storageFake');

const base = (extra = {}) => ({
  STORAGE_ENDPOINT: 'https://s3.exemplo.com',
  STORAGE_BUCKET: 'boletos',
  STORAGE_ACCESS_KEY: 'ak',
  STORAGE_SECRET_KEY: 'sk',
  ...extra
});

describe('lerConfigStorage', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('configuração completa: devolve os campos, região us-east-1 e path-style por padrão', () => {
    expect(lerConfigStorage(base())).toEqual({
      endpoint: 'https://s3.exemplo.com',
      region: 'us-east-1',
      bucket: 'boletos',
      accessKey: 'ak',
      secretKey: 'sk',
      forcePathStyle: true
    });
  });

  it.each(['STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY'])('sem %s => null (desativado)', (campo) => {
    expect(lerConfigStorage(base({ [campo]: '' }))).toBeNull();
    expect(lerConfigStorage(base({ [campo]: '   ' }))).toBeNull();
    const sem = base();
    delete sem[campo];
    expect(lerConfigStorage(sem)).toBeNull();
  });

  it('aparar espaços; barras finais do endpoint são removidas; região e path-style configuráveis', () => {
    const cfg = lerConfigStorage(base({ STORAGE_ENDPOINT: '  https://s3.exemplo.com/  ', STORAGE_REGION: ' sa-east-1 ', STORAGE_FORCE_PATH_STYLE: 'FALSE' }));
    expect(cfg).toMatchObject({ endpoint: 'https://s3.exemplo.com', region: 'sa-east-1', forcePathStyle: false });
    expect(lerConfigStorage(base({ STORAGE_FORCE_PATH_STYLE: '0' })).forcePathStyle).toBe(false);
    expect(lerConfigStorage(base({ STORAGE_FORCE_PATH_STYLE: 'no' })).forcePathStyle).toBe(false);
    expect(lerConfigStorage(base({ STORAGE_FORCE_PATH_STYLE: 'true' })).forcePathStyle).toBe(true);
  });

  describe('endpoint: https sempre', () => {
    it.each(['https://s3.amazonaws.com', 'https://minio.meudominio.com.br:9000', 'https://localhost:9000', 'https://203.0.113.10'])('%s é aceito', (e) => {
      expect(lerConfigStorage(base({ STORAGE_ENDPOINT: e }))).not.toBeNull();
    });
  });

  describe('endpoint: http só para localhost e hostnames internos', () => {
    it.each([
      'http://localhost:9000',
      'http://127.0.0.1:9000',
      'http://[::1]:9000',
      'http://minio:9000',
      'http://minio',
      'http://api.interno.internal:9000',
      'http://minio.local:9000',
      'http://minio.default.svc:9000',
      'http://minio.default.svc.cluster.local:9000'
    ])('%s é aceito', (e) => {
      expect(lerConfigStorage(base({ STORAGE_ENDPOINT: e }))).not.toBeNull();
    });

    it.each([
      'http://s3.amazonaws.com',
      'http://minio.meudominio.com.br:9000',
      'http://203.0.113.10:9000',
      'http://localhost.evil.com:9000',
      'http://127.0.0.1.evil.com',
      'http://evil.com/internal',
      'http://minio.internal.evil.com',
      'http://10.0.0.5:9000'
    ])('%s é recusado (null) e loga o motivo', (e) => {
      expect(lerConfigStorage(base({ STORAGE_ENDPOINT: e }))).toBeNull();
      expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/https/));
    });
  });

  it.each(['não é url', 'ftp://minio:9000', 'file:///etc/passwd', '//s3.exemplo.com', 's3.exemplo.com', 'javascript:alert(1)'])('endpoint inválido %p => null', (e) => {
    expect(lerConfigStorage(base({ STORAGE_ENDPOINT: e }))).toBeNull();
  });

  it.each(['A', 'Bucket', 'bucket_x', '-bucket', 'bucket-', '../x', 'a b', 'x'.repeat(64)])('bucket inválido %p => null', (b) => {
    expect(lerConfigStorage(base({ STORAGE_BUCKET: b }))).toBeNull();
  });

  it('os logs de erro nunca contêm as chaves de acesso', () => {
    lerConfigStorage(base({ STORAGE_ENDPOINT: 'http://evil.com', STORAGE_ACCESS_KEY: 'AK-SECRETA', STORAGE_SECRET_KEY: 'SK-SECRETA' }));
    lerConfigStorage(base({ STORAGE_ENDPOINT: 'lixo', STORAGE_ACCESS_KEY: 'AK-SECRETA', STORAGE_SECRET_KEY: 'SK-SECRETA' }));
    const saida = JSON.stringify(console.error.mock.calls);
    expect(saida).not.toMatch(/SECRETA/);
  });

  it('usa process.env por padrão', () => {
    const antes = { ...process.env };
    try {
      Object.assign(process.env, base());
      expect(lerConfigStorage()).not.toBeNull();
      delete process.env.STORAGE_BUCKET;
      expect(lerConfigStorage()).toBeNull();
    } finally {
      Object.keys(process.env).forEach((k) => {
        if (!(k in antes)) delete process.env[k];
      });
      Object.assign(process.env, antes);
    }
  });
});

describe('storageConfigurado / getStorage / definirStorage', () => {
  const chaves = ['STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY'];
  let guardado;
  beforeEach(() => {
    guardado = Object.fromEntries(chaves.map((k) => [k, process.env[k]]));
    chaves.forEach((k) => delete process.env[k]);
    definirStorage(null);
  });
  afterEach(() => {
    definirStorage(null);
    jest.restoreAllMocks();
    chaves.forEach((k) => {
      if (guardado[k] === undefined) delete process.env[k];
      else process.env[k] = guardado[k];
    });
  });

  it('sem STORAGE_* e sem injeção: não configurado e getStorage lança StorageNaoConfigurado', () => {
    expect(storageConfigurado()).toBe(false);
    expect(() => getStorage()).toThrow(StorageNaoConfigurado);
  });

  it('definirStorage injeta o fake; null volta a reavaliar o env', () => {
    const fake = criarStorageFake();
    definirStorage(fake);
    expect(storageConfigurado()).toBe(true);
    expect(getStorage()).toBe(fake);
    definirStorage(null);
    expect(storageConfigurado()).toBe(false);
  });

  it('com STORAGE_* válido: configurado e getStorage devolve um storage S3 (sem rede até usar)', () => {
    Object.assign(process.env, base({ STORAGE_ENDPOINT: 'http://127.0.0.1:9' }));
    expect(storageConfigurado()).toBe(true);
    const s = getStorage();
    expect(typeof s.salvar).toBe('function');
    expect(getStorage()).toBe(s); // memoizado
  });

  it('endpoint http público => desativado (não configurado)', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    Object.assign(process.env, base({ STORAGE_ENDPOINT: 'http://s3.exemplo.com' }));
    expect(storageConfigurado()).toBe(false);
    expect(() => getStorage()).toThrow(StorageNaoConfigurado);
  });

  it('StorageNaoConfigurado tem nome e mensagem estáveis', () => {
    const e = new StorageNaoConfigurado();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('StorageNaoConfigurado');
    expect(e.message).toMatch(/não configurado/);
  });
});

describe('criarStorageS3: validações locais (antes de qualquer chamada de rede)', () => {
  // Endpoint em porta fechada: qualquer tentativa de rede falharia por conexão, não pelo erro esperado.
  const s3 = criarStorageS3({ endpoint: 'http://127.0.0.1:9', region: 'us-east-1', bucket: 'x-test', accessKey: 'a', secretKey: 'b', forcePathStyle: true });

  it.each([0, -1, 1.5, Number.NaN, '1', null, undefined])('salvar recusa restauranteId inválido (%p)', async (rid) => {
    await expect(s3.salvar(rid, Buffer.from('x'), 'jpg')).rejects.toThrow('restauranteId inválido');
  });

  it.each(['exe', 'gif', 'jpg/../../x', '', 'jpeg'])('salvar recusa extensão %p', async (ext) => {
    await expect(s3.salvar(1, Buffer.from('x'), ext)).rejects.toThrow('Extensão não permitida');
  });

  const maliciosas = [
    '../segredo.jpg', '1/../../segredo.jpg', '..\\segredo.jpg', '/etc/passwd', 'C:\\Windows\\win.ini', '1/abc.jpg',
    `1/${'a'.repeat(32)}.exe`, `1/${'A'.repeat(32)}.jpg`, `1/${'a'.repeat(32)}.jpg/../x`, `1/${'a'.repeat(32)}.jpg\u0000.png`,
    `../1/${'a'.repeat(32)}.jpg`, `1/2/${'a'.repeat(32)}.jpg`, `%2e%2e/1/${'a'.repeat(32)}.jpg`, '', null, undefined, 42, {}
  ];
  it.each(maliciosas.map((c) => [String(c), c]))('ler recusa a chave %s', async (_n, chave) => {
    await expect(s3.ler(chave)).rejects.toThrow('Chave de armazenamento inválida');
  });
  it.each(maliciosas.map((c) => [String(c), c]))('apagar recusa a chave %s', async (_n, chave) => {
    await expect(s3.apagar(chave)).rejects.toThrow('Chave de armazenamento inválida');
  });
});
