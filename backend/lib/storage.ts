import crypto from 'crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand
} from '@aws-sdk/client-s3';

/** Armazenamento de arquivos de anexo. A chave é opaca e gerada pelo servidor. */
export interface Storage {
  /** Grava o conteúdo e devolve a chave (ex.: "12/ab34....jpg"). */
  salvar(restauranteId: number, conteudo: Buffer, extensao: string): Promise<string>;
  /** Devolve o conteúdo e o Content-Type gravado. */
  ler(chave: string): Promise<{ conteudo: Buffer; mime: string }>;
  /** Idempotente: arquivo inexistente não é erro. */
  apagar(chave: string): Promise<void>;
}

/** Storage ausente/inválido: as rotas de imagem respondem 503; o resto do app segue. */
export class StorageNaoConfigurado extends Error {
  constructor(message = 'Armazenamento de imagens não configurado') {
    super(message);
    this.name = 'StorageNaoConfigurado';
  }
}

const EXTENSOES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const CHAVE_RE = /^\d{1,10}\/[a-f0-9]{32}\.(jpg|png|webp)$/;

function validarChave(chave: string): void {
  if (typeof chave !== 'string' || !CHAVE_RE.test(chave)) {
    throw new Error('Chave de armazenamento inválida');
  }
}

function ehNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: unknown; Code?: unknown; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NoSuchKey' || e.name === 'NotFound' || e.Code === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
}

export interface StorageS3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
}

/**
 * Lê e valida STORAGE_* (único lugar que lê essas variáveis). Devolve null se faltar algo ou for inválido.
 * Regra do endpoint: https sempre; http só para localhost, 127.0.0.1, ::1 e hostnames internos
 * (nome simples sem ponto, como o serviço "minio" do docker, ou terminado em .internal / .local / .svc).
 */
export function lerConfigStorage(env: NodeJS.ProcessEnv = process.env): StorageS3Config | null {
  const endpoint = (env.STORAGE_ENDPOINT || '').trim();
  const bucket = (env.STORAGE_BUCKET || '').trim();
  const accessKey = (env.STORAGE_ACCESS_KEY || '').trim();
  const secretKey = (env.STORAGE_SECRET_KEY || '').trim();
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    console.error('[storage] STORAGE_ENDPOINT inválido (não é uma URL). Imagens desativadas.');
    return null;
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const interno =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    !host.includes('.') ||
    /\.(internal|local|svc|svc\.cluster\.local)$/.test(host);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && interno)) {
    console.error('[storage] STORAGE_ENDPOINT deve ser https (http só para localhost/hostname interno). Imagens desativadas.');
    return null;
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    console.error('[storage] STORAGE_BUCKET inválido. Imagens desativadas.');
    return null;
  }
  const region = (env.STORAGE_REGION || '').trim() || 'us-east-1';
  const fp = (env.STORAGE_FORCE_PATH_STYLE || '').trim().toLowerCase();
  const forcePathStyle = !['false', '0', 'no'].includes(fp);
  return { endpoint: url.toString().replace(/\/+$/, ''), region, bucket, accessKey, secretKey, forcePathStyle };
}

/** Armazenamento S3-compatível (MinIO/R2/S3). O bucket é privado e deve existir (infra cria). */
export function criarStorageS3(cfg: StorageS3Config): Storage {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey }
  });
  return {
    async salvar(restauranteId, conteudo, extensao) {
      if (!Number.isInteger(restauranteId) || restauranteId <= 0) throw new Error('restauranteId inválido');
      const ext = extensao.toLowerCase();
      const mime = EXTENSOES[ext];
      if (!mime) throw new Error('Extensão não permitida');
      const chave = `${restauranteId}/${crypto.randomBytes(16).toString('hex')}.${ext}`;
      validarChave(chave);
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: chave,
          Body: conteudo,
          ContentType: mime,
          ContentLength: conteudo.length
        })
      );
      return chave;
    },
    async ler(chave) {
      validarChave(chave);
      const r = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: chave }));
      if (!r.Body) throw new Error('Objeto vazio');
      const bytes = await r.Body.transformToByteArray();
      return { conteudo: Buffer.from(bytes), mime: r.ContentType || '' };
    },
    async apagar(chave) {
      validarChave(chave);
      try {
        await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: chave }));
      } catch (error) {
        if (!ehNotFound(error)) throw error;
      }
    }
  };
}

let storageAtual: Storage | null = null;

/** true se há storage injetado ou configuração STORAGE_* completa e válida. */
export function storageConfigurado(): boolean {
  if (storageAtual) return true;
  return lerConfigStorage() !== null;
}

/** Lança StorageNaoConfigurado se não houver configuração. */
export function getStorage(): Storage {
  if (!storageAtual) {
    const cfg = lerConfigStorage();
    if (!cfg) throw new StorageNaoConfigurado();
    storageAtual = criarStorageS3(cfg);
  }
  return storageAtual;
}

/** Para testes (fake em memória). Passe null para voltar ao padrão (reavalia o env). */
export function definirStorage(s: Storage | null): void {
  storageAtual = s;
}

