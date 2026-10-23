export type MimeImagem = 'image/jpeg' | 'image/png' | 'image/webp';

export const IMAGEM_MAX_BYTES = 5 * 1024 * 1024;

const EXT_POR_MIME: Record<MimeImagem, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

export function extensaoDoMime(mime: MimeImagem): string {
  return EXT_POR_MIME[mime];
}

/** Detecta o tipo real pelos magic bytes (JPEG, PNG, WebP). null se não for um desses. */
export function detectarMimeImagem(buf: Buffer): MimeImagem | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** MIME declarado pelo cliente que aceitamos (image/jpg é alias comum de image/jpeg). */
export function mimeDeclaradoPermitido(mime: string): MimeImagem | null {
  const m = mime.toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return 'image/jpeg';
  if (m === 'image/png') return 'image/png';
  if (m === 'image/webp') return 'image/webp';
  return null;
}
