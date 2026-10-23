/** Compressão de imagem no cliente antes do envio (câmera do celular gera arquivos grandes). */
export const IMAGEM_MAX_LADO = 1600;
export const IMAGEM_MAX_BYTES = 5 * 1024 * 1024;

/** Calcula o tamanho final mantendo a proporção, sem ampliar. */
export function dimensoesReduzidas(largura: number, altura: number, maxLado = IMAGEM_MAX_LADO) {
  const maior = Math.max(largura, altura);
  if (maior <= maxLado || maior === 0) return { largura, altura };
  const fator = maxLado / maior;
  return { largura: Math.round(largura * fator), altura: Math.round(altura * fator) };
}

function carregarImagem(arquivo: Blob): Promise<{ img: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível abrir a imagem. Use JPG, PNG ou WebP.'));
    };
    img.src = url;
  });
}

function paraBlob(canvas: HTMLCanvasElement, qualidade: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', qualidade));
}

/** Redimensiona (máx. 1600 px) e recomprime em JPEG (~0,8), reduzindo a qualidade até caber em 5 MB. */
export async function comprimirImagem(arquivo: File): Promise<Blob> {
  const { img, url } = await carregarImagem(arquivo);
  try {
    const { largura, altura } = dimensoesReduzidas(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Seu navegador não conseguiu processar a imagem.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, largura, altura);
    ctx.drawImage(img, 0, 0, largura, altura);
    for (const qualidade of [0.8, 0.65, 0.5, 0.35]) {
      const blob = await paraBlob(canvas, qualidade);
      if (blob && blob.size <= IMAGEM_MAX_BYTES) return blob;
    }
    throw new Error('A imagem continua muito grande (máximo 5 MB). Tente uma foto menor.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
