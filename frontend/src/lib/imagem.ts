/** Lado maior máximo (px) da imagem enviada para leitura por IA. */
export const LADO_MAXIMO = 1600;
/** Abaixo disso, e dentro do lado máximo, a imagem segue sem reprocessar. */
export const TAMANHO_PEQUENO = 1.5 * 1024 * 1024;
/** Limite do servidor (5 MB). */
export const TAMANHO_LIMITE = 5 * 1024 * 1024;
const QUALIDADE_JPEG = 0.85;

export const TIPOS_IMAGEM_ACEITOS = ['image/jpeg', 'image/png', 'image/webp'];

function paraBlob(canvas: HTMLCanvasElement, qualidade: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', qualidade));
}

/**
 * Reduz a imagem no cliente (lado maior <= 1600 px, JPEG 0.85), respeitando a orientação EXIF.
 * Se já for pequena, devolve o próprio arquivo. Se não for possível decodificar, devolve o
 * original quando couber no limite do servidor; senão lança erro.
 */
export async function reduzirImagem(arquivo: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    // 'from-image' é o valor da especificação atual; os tipos do TS ainda só listam 'none' | 'flipY'.
    const opcoes = { imageOrientation: 'from-image' } as unknown as ImageBitmapOptions;
    bitmap = await createImageBitmap(arquivo, opcoes);
  } catch {
    if (arquivo.size <= TAMANHO_LIMITE) return arquivo;
    throw new Error('Imagem muito grande');
  }
  try {
    const maior = Math.max(bitmap.width, bitmap.height);
    if (maior <= LADO_MAXIMO && arquivo.size <= TAMANHO_PEQUENO) return arquivo;

    const escala = maior > LADO_MAXIMO ? LADO_MAXIMO / maior : 1;
    const largura = Math.max(1, Math.round(bitmap.width * escala));
    const altura = Math.max(1, Math.round(bitmap.height * escala));
    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if (arquivo.size <= TAMANHO_LIMITE) return arquivo;
      throw new Error('Imagem muito grande');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, largura, altura);
    ctx.drawImage(bitmap, 0, 0, largura, altura);
    const blob = await paraBlob(canvas, QUALIDADE_JPEG);
    if (!blob) {
      if (arquivo.size <= TAMANHO_LIMITE) return arquivo;
      throw new Error('Imagem muito grande');
    }
    const nome = arquivo.name.replace(/\.[^.]+$/, '') || 'documento';
    return new File([blob], `${nome}.jpg`, { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}
