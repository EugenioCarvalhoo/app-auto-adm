import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Inject } from '@nestjs/common';
import { catchError, Observable, throwError } from 'rxjs';
import { codigoErro, ehTabelaInexistente, ErroAplicacao, MSG_BANCO_DESATUALIZADO, mensagemErro, stackErro } from '../domain/erros';
import type { CodigoErroAplicacao } from '../domain/erros';

export interface OpcoesTratamentoErro {
  /** Mensagem do 500 genérico daquela rota (ex.: 'Erro ao buscar restaurantes'). */
  mensagem500: string;
  /** Prefixo do log de erro inesperado (padrão: `${mensagem500}:`). */
  log?: string;
  /** Inclui `details` (mensagem do erro) no 500 só quando NODE_ENV=development (como o login fazia). */
  detalhes?: boolean;
  /** Códigos SQLSTATE com resposta própria (checados antes do log e do 42P01). */
  mapa?: Record<string, { codigo: CodigoErroAplicacao; mensagem: string }>;
}

const CHAVE = 'tratar-erros';

/** Define, por rota, como erros inesperados (banco etc.) viram resposta; equivale ao try/catch de cada rota Express. */
export const TratarErros = (opcoes: OpcoesTratamentoErro) => SetMetadata(CHAVE, opcoes);

@Injectable()
export class TratarErrosInterceptor implements NestInterceptor {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const opcoes = this.reflector.get<OpcoesTratamentoErro | undefined>(CHAVE, context.getHandler());
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (!opcoes || error instanceof ErroAplicacao || error instanceof HttpException) {
          return throwError(() => error);
        }
        return throwError(() => traduzir(error, opcoes));
      })
    );
  }
}

function traduzir(error: unknown, opcoes: OpcoesTratamentoErro): ErroAplicacao {
  const cod = codigoErro(error);
  const especifico = cod ? opcoes.mapa?.[cod] : undefined;
  if (especifico) return new ErroAplicacao(especifico.codigo, especifico.mensagem);

  console.error(opcoes.log ?? `${opcoes.mensagem500}:`, error);
  if (ehTabelaInexistente(error)) return new ErroAplicacao('INDISPONIVEL', MSG_BANCO_DESATUALIZADO);
  if (opcoes.detalhes) {
    console.error('Stack trace:', stackErro(error));
    return new ErroAplicacao('INTERNO', opcoes.mensagem500, {
      details: process.env.NODE_ENV === 'development' ? mensagemErro(error) : undefined
    });
  }
  return new ErroAplicacao('INTERNO', opcoes.mensagem500);
}
