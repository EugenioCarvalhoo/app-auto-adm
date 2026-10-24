import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import { ErroAplicacao } from '../../shared/domain/erros';

export const IMAGEM_MAX_MB_PADRAO = 5;

/** Tamanho máximo do upload em bytes (IMAGEM_MAX_MB, padrão 5), lido a cada requisição. */
export function imagemMaxBytes(): number {
  const mb = Number(process.env.IMAGEM_MAX_MB);
  return Math.floor((Number.isFinite(mb) && mb > 0 ? mb : IMAGEM_MAX_MB_PADRAO) * 1024 * 1024);
}

/**
 * multipart com um único arquivo "imagem" em memória (multer). Erros do multer viram JSON
 * `{ error }` no padrão da API: arquivo grande -> 413; qualquer outro envio inválido -> 400.
 */
@Injectable()
export class ImagemUploadInterceptor implements NestInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const Interceptor = FileInterceptor('imagem', {
      limits: { fileSize: imagemMaxBytes(), files: 1, fields: 10, parts: 12, fieldSize: 1024 }
    });
    const interno = new Interceptor();
    try {
      return await interno.intercept(context, next);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 413) {
        throw new ErroAplicacao('PAYLOAD_GRANDE', `Imagem maior que o limite de ${imagemMaxBytes() / 1024 / 1024} MB.`);
      }
      if (error instanceof HttpException) throw new ErroAplicacao('VALIDACAO', 'Envio inválido. Use multipart com o campo "imagem".');
      throw error;
    }
  }
}
