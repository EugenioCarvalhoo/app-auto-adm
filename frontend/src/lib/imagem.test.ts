import { reduzirImagem, TAMANHO_LIMITE } from './imagem';

interface BitmapFalso {
  width: number;
  height: number;
  close: jest.Mock;
}

const criarBitmapMock = jest.fn<Promise<ImageBitmap>, [Blob, ImageBitmapOptions?]>();
const ctxFalso = { fillStyle: '', fillRect: jest.fn(), drawImage: jest.fn() };
const toBlobMock = jest.fn();

function bitmap(width: number, height: number): BitmapFalso & ImageBitmap {
  return { width, height, close: jest.fn() } as unknown as BitmapFalso & ImageBitmap;
}

/** Arquivo com tamanho declarado (sem alocar megabytes de memória). */
function arquivo(nome: string, tamanho: number, tipo = 'image/jpeg'): File {
  const f = new File(['conteudo'], nome, { type: tipo });
  Object.defineProperty(f, 'size', { value: tamanho });
  return f;
}

beforeEach(() => {
  criarBitmapMock.mockReset();
  toBlobMock.mockReset();
  toBlobMock.mockImplementation((cb: BlobCallback) => cb(new Blob(['jpeg'], { type: 'image/jpeg' })));
  ctxFalso.fillRect.mockReset();
  ctxFalso.drawImage.mockReset();
  Object.defineProperty(globalThis, 'createImageBitmap', {
    value: criarBitmapMock,
    configurable: true,
    writable: true
  });
  HTMLCanvasElement.prototype.getContext = jest.fn(
    () => ctxFalso as unknown as CanvasRenderingContext2D
  ) as unknown as HTMLCanvasElement['getContext'];
  HTMLCanvasElement.prototype.toBlob = toBlobMock as unknown as HTMLCanvasElement['toBlob'];
});

describe('reduzirImagem', () => {
  it('envia a imagem pequena como está, sem redesenhar', async () => {
    const foto = bitmap(800, 600);
    criarBitmapMock.mockResolvedValue(foto);
    const original = arquivo('pequena.jpg', 200 * 1024);

    const resultado = await reduzirImagem(original);

    expect(resultado).toBe(original);
    expect(toBlobMock).not.toHaveBeenCalled();
    expect(foto.close).toHaveBeenCalledTimes(1);
  });

  it('respeita a orientação EXIF ao decodificar', async () => {
    criarBitmapMock.mockResolvedValue(bitmap(800, 600));
    const original = arquivo('pequena.jpg', 200 * 1024);

    await reduzirImagem(original);

    expect(criarBitmapMock).toHaveBeenCalledWith(original, { imageOrientation: 'from-image' });
  });

  it('redimensiona imagem grande para lado maior 1600 e devolve JPEG 0,85', async () => {
    criarBitmapMock.mockResolvedValue(bitmap(3200, 2400));
    const original = arquivo('foto.png', 3 * 1024 * 1024, 'image/png');

    const resultado = await reduzirImagem(original);

    expect(ctxFalso.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
    expect(toBlobMock).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85);
    expect(resultado).not.toBe(original);
    expect(resultado.name).toBe('foto.jpg');
    expect(resultado.type).toBe('image/jpeg');
  });

  it('reduz pelo lado vertical quando a foto está em retrato', async () => {
    criarBitmapMock.mockResolvedValue(bitmap(1200, 4000));
    const original = arquivo('retrato.jpg', 2 * 1024 * 1024);

    await reduzirImagem(original);

    expect(ctxFalso.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 480, 1600);
  });

  it('reprocessa imagem com dimensão ok mas acima de 1,5 MB', async () => {
    criarBitmapMock.mockResolvedValue(bitmap(1000, 800));
    const original = arquivo('pesada.jpg', 2 * 1024 * 1024);

    const resultado = await reduzirImagem(original);

    expect(toBlobMock).toHaveBeenCalled();
    expect(resultado).not.toBe(original);
    expect(resultado.name).toBe('pesada.jpg');
  });

  it('se não decodificar e o original couber no limite do servidor, envia o original', async () => {
    criarBitmapMock.mockRejectedValue(new Error('formato não suportado'));
    const original = arquivo('estranha.heic', 4 * 1024 * 1024, 'image/heic');

    const resultado = await reduzirImagem(original);

    expect(resultado).toBe(original);
    expect(toBlobMock).not.toHaveBeenCalled();
  });

  it('se não decodificar e o original passar de 5 MB, lança "Imagem muito grande"', async () => {
    criarBitmapMock.mockRejectedValue(new Error('formato não suportado'));
    const original = arquivo('gigante.jpg', TAMANHO_LIMITE + 1);

    await expect(reduzirImagem(original)).rejects.toThrow('Imagem muito grande');
  });

  it('se o encode para JPEG falhar, envia o original quando couber no limite', async () => {
    criarBitmapMock.mockResolvedValue(bitmap(3200, 2400));
    toBlobMock.mockImplementation((cb: BlobCallback) => cb(null));
    const original = arquivo('foto.jpg', 3 * 1024 * 1024);

    await expect(reduzirImagem(original)).resolves.toBe(original);
  });

  it('se o encode falhar e o original passar de 5 MB, lança "Imagem muito grande"', async () => {
    criarBitmapMock.mockResolvedValue(bitmap(3200, 2400));
    toBlobMock.mockImplementation((cb: BlobCallback) => cb(null));
    const original = arquivo('foto.jpg', TAMANHO_LIMITE + 1);

    await expect(reduzirImagem(original)).rejects.toThrow('Imagem muito grande');
  });
});
