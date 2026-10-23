/**
 * criarStorageS3 contra um MinIO REAL (container `minio-controle`; ver README). Pula com aviso se o MinIO de teste
 * não estiver no ar. Sem banco.
 */
const crypto = require('crypto');
const { S3Client, ListObjectsV2Command, GetBucketPolicyCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { criarStorageS3 } = require('../lib/storage');
const { configMinio, describeMinio } = require('./helpers/minio');
const { jpeg, png, webp } = require('./helpers/imagens');

describeMinio('criarStorageS3 com MinIO real', () => {
  const cfg = configMinio();
  const storage = criarStorageS3(cfg);
  const s3 = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey }
  });
  const criadas = [];
  const salvar = async (...args) => {
    const chave = await storage.salvar(...args);
    criadas.push(chave);
    return chave;
  };
  const existe = async (chave) => {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: chave }));
      return true;
    } catch (e) {
      if (e.$metadata && e.$metadata.httpStatusCode === 404) return false;
      throw e;
    }
  };

  afterAll(async () => {
    for (const c of criadas) await storage.apagar(c).catch(() => {});
    s3.destroy();
  });

  it('salva e lê: bytes e Content-Type idênticos; chave gerada pelo servidor', async () => {
    const conteudo = jpeg(77);
    const chave = await salvar(7, conteudo, 'jpg');
    expect(chave).toMatch(/^7\/[a-f0-9]{32}\.jpg$/);
    const lido = await storage.ler(chave);
    expect(lido.conteudo.equals(conteudo)).toBe(true);
    expect(lido.mime).toBe('image/jpeg');
  });

  it.each([
    ['png', png(3), 'image/png'],
    ['webp', webp(3), 'image/webp'],
    ['WEBP', webp(4), 'image/webp']
  ])('extensão %s => Content-Type %s e bytes preservados', async (ext, conteudo, mime) => {
    const chave = await salvar(2, conteudo, ext);
    expect(chave.endsWith(`.${ext.toLowerCase()}`)).toBe(true);
    const lido = await storage.ler(chave);
    expect(lido.mime).toBe(mime);
    expect(lido.conteudo.equals(conteudo)).toBe(true);
  });

  it('bytes binários arbitrários e arquivo de ~1 MB sobrevivem íntegros (SHA-256)', async () => {
    const grande = Buffer.concat([jpeg(1), crypto.randomBytes(1024 * 1024)]);
    const chave = await salvar(1, grande, 'jpg');
    const lido = await storage.ler(chave);
    expect(crypto.createHash('sha256').update(lido.conteudo).digest('hex')).toBe(crypto.createHash('sha256').update(grande).digest('hex'));
  });

  it('dois salvamentos do mesmo conteúdo geram chaves distintas (nunca sobrescreve)', async () => {
    const a = await salvar(1, jpeg(5), 'jpg');
    const b = await salvar(1, jpeg(5), 'jpg');
    expect(a).not.toBe(b);
  });

  it('o objeto existe de fato no bucket (consulta independente pelo SDK)', async () => {
    const chave = await salvar(3, jpeg(9), 'jpg');
    expect(await existe(chave)).toBe(true);
    const r = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: chave }));
    expect(r.ContentType).toBe('image/jpeg');
  });

  it('apagar remove o objeto; ler depois rejeita', async () => {
    const chave = await salvar(4, jpeg(10), 'jpg');
    await storage.apagar(chave);
    expect(await existe(chave)).toBe(false);
    await expect(storage.ler(chave)).rejects.toMatchObject({ name: expect.stringMatching(/NoSuchKey|NotFound/) });
  });

  it('apagar é idempotente: chave válida inexistente e segundo apagar não são erro', async () => {
    await expect(storage.apagar(`5/${'b'.repeat(32)}.jpg`)).resolves.toBeUndefined();
    const chave = await salvar(5, jpeg(11), 'jpg');
    await storage.apagar(chave);
    await expect(storage.apagar(chave)).resolves.toBeUndefined();
  });

  it('ler objeto inexistente rejeita (NoSuchKey), sem devolver conteúdo', async () => {
    await expect(storage.ler(`6/${'c'.repeat(32)}.jpg`)).rejects.toMatchObject({ name: 'NoSuchKey' });
  });

  it('chaves inválidas/traversal são rejeitadas ANTES de chegar ao MinIO e nada é lido nem apagado', async () => {
    const alvo = await salvar(8, jpeg(12), 'jpg');
    for (const ruim of [`../${alvo}`, `8/../8/${alvo.split('/')[1]}`, `/${alvo}`, `${alvo}/..`, alvo.toUpperCase()]) {
      await expect(storage.ler(ruim)).rejects.toThrow('Chave de armazenamento inválida');
      await expect(storage.apagar(ruim)).rejects.toThrow('Chave de armazenamento inválida');
    }
    expect(await existe(alvo)).toBe(true);
  });

  it('restauranteId e extensão inválidos não criam objeto algum', async () => {
    const antes = await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: '0/' }));
    await expect(storage.salvar(0, jpeg(), 'jpg')).rejects.toThrow();
    await expect(storage.salvar(1, jpeg(), 'exe')).rejects.toThrow();
    const depois = await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: '0/' }));
    expect(depois.KeyCount).toBe(antes.KeyCount);
  });

  describe('falhas de infraestrutura viram erro (nunca resultado falso)', () => {
    it('bucket inexistente: salvar e ler rejeitam', async () => {
      const s = criarStorageS3({ ...cfg, bucket: 'bucket-que-nao-existe-test' });
      await expect(s.salvar(1, jpeg(), 'jpg')).rejects.toMatchObject({ name: 'NoSuchBucket' });
      await expect(s.ler(`1/${'a'.repeat(32)}.jpg`)).rejects.toBeTruthy();
    });

    // BUG DE PRODUÇÃO (backend/lib/storage.ts, ehNotFound ~linha 40): trata qualquer HTTP 404 como "objeto não existe",
    // inclusive NoSuchBucket. Com bucket errado, apagar() "tem sucesso" e limpar-boletos conta arquivos apagados que
    // continuam lá. `it.failing` mantém a suíte verde; quando o bug for corrigido este teste passará a falhar
    // ("unexpected pass") e basta trocar por `it`.
    it.failing('bucket inexistente: apagar propaga o erro (não confunde NoSuchBucket com objeto ausente)', async () => {
      const s = criarStorageS3({ ...cfg, bucket: 'bucket-que-nao-existe-test' });
      await expect(s.apagar(`1/${'a'.repeat(32)}.jpg`)).rejects.toMatchObject({ name: 'NoSuchBucket' });
    });

    it('credenciais erradas: salvar, ler e apagar rejeitam (apagar não engole 403)', async () => {
      const s = criarStorageS3({ ...cfg, secretKey: 'senha-errada-123' });
      await expect(s.salvar(1, jpeg(), 'jpg')).rejects.toMatchObject({ name: expect.stringMatching(/SignatureDoesNotMatch|AccessDenied|InvalidAccessKeyId/) });
      await expect(s.ler(`1/${'a'.repeat(32)}.jpg`)).rejects.toBeTruthy();
      await expect(s.apagar(`1/${'a'.repeat(32)}.jpg`)).rejects.toBeTruthy();
    });

    it('chave de acesso inexistente: rejeita', async () => {
      const s = criarStorageS3({ ...cfg, accessKey: 'naoexiste', secretKey: 'naoexiste123' });
      await expect(s.salvar(1, jpeg(), 'jpg')).rejects.toBeTruthy();
    });

    it('endpoint inalcançável: rejeita (não pendura)', async () => {
      const s = criarStorageS3({ ...cfg, endpoint: 'http://127.0.0.1:1' });
      await expect(s.salvar(1, jpeg(), 'jpg')).rejects.toBeTruthy();
    });
  });

  it('o bucket de teste é privado: leitura anônima negada e sem política pública', async () => {
    const chave = await salvar(9, jpeg(13), 'jpg');
    const anonimo = await fetch(`${cfg.endpoint}/${cfg.bucket}/${chave}`);
    expect([401, 403]).toContain(anonimo.status);
    const politica = await s3.send(new GetBucketPolicyCommand({ Bucket: cfg.bucket })).catch((e) => e);
    if (politica && politica.Policy) expect(politica.Policy).not.toMatch(/"Principal"\s*:\s*(\{\s*"AWS"\s*:\s*)?"\*"/);
    else expect(politica.name).toBe('NoSuchBucketPolicy');
  });
});
