/**
 * MinIO de TESTE (S3 real, só para os testes do storage e do fluxo ponta a ponta).
 * Padrão: container `minio-controle` em 127.0.0.1:9100 (API) / 9101 (console), bucket privado `boletos-test`.
 * Para outro MinIO/S3: TEST_MINIO_ENDPOINT, TEST_MINIO_BUCKET, TEST_MINIO_ACCESS_KEY, TEST_MINIO_SECRET_KEY.
 *
 * Guarda de segurança (análoga a "_test" no banco): o bucket precisa terminar em "-test". Os testes gravam e apagam objetos.
 */
const { S3Client, HeadBucketCommand, CreateBucketCommand } = require('@aws-sdk/client-s3');

function configMinio() {
  const cfg = {
    endpoint: (process.env.TEST_MINIO_ENDPOINT || 'http://127.0.0.1:9100').replace(/\/+$/, ''),
    bucket: process.env.TEST_MINIO_BUCKET || 'boletos-test',
    accessKey: process.env.TEST_MINIO_ACCESS_KEY || 'minioteste',
    secretKey: process.env.TEST_MINIO_SECRET_KEY || 'minioteste123',
    region: 'us-east-1',
    forcePathStyle: true
  };
  if (!/-test$/.test(cfg.bucket)) {
    throw new Error(`Recusado: o bucket de teste deve terminar em "-test" (recebido "${cfg.bucket}").`);
  }
  return cfg;
}

/** Variáveis STORAGE_* equivalentes (para o app / processos filhos). */
function envStorage(cfg = configMinio()) {
  return {
    STORAGE_ENDPOINT: cfg.endpoint,
    STORAGE_BUCKET: cfg.bucket,
    STORAGE_ACCESS_KEY: cfg.accessKey,
    STORAGE_SECRET_KEY: cfg.secretKey,
    STORAGE_REGION: cfg.region,
    STORAGE_FORCE_PATH_STYLE: 'true'
  };
}

/** true se o MinIO responde ao health check. Nunca lança. */
async function minioAcessivel(cfg = configMinio()) {
  try {
    const r = await fetch(`${cfg.endpoint}/minio/health/live`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Cria o bucket (privado por padrão) se não existir. Idempotente. */
async function garantirBucket(cfg = configMinio()) {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey }
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
  } catch {
    try {
      await client.send(new CreateBucketCommand({ Bucket: cfg.bucket }));
    } catch (e) {
      if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(e && e.name)) throw e;
    }
  }
}

/** Preenchido pelo globalSetup: '1' se o MinIO de teste está no ar e com o bucket pronto. */
const minioDisponivel = () => process.env.TEST_MINIO_OK === '1';

/** `describe` que PULA (com aviso) quando o MinIO de teste não está disponível. */
function describeMinio(nome, fn) {
  if (minioDisponivel()) return describe(nome, fn);
  return describe.skip(`${nome} [PULADO: MinIO de teste indisponível; veja backend/test/README.md]`, fn);
}

module.exports = { configMinio, envStorage, minioAcessivel, garantirBucket, minioDisponivel, describeMinio };
