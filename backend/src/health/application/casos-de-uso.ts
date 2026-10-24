import { Inject, Injectable } from '@nestjs/common';
import { mensagemErro } from '../../shared/domain/erros';
import { MIGRACOES_PENDENTES, SAUDE_BANCO } from './portas';
import type { ConsultaMigracoesPendentes, SaudeBanco } from './portas';

/** Liveness: sem banco (evita 502 por timeout do proxy se o Postgres estiver inacessível). */
@Injectable()
export class LivenessUseCase {
  executar() {
    return {
      status: 'ok',
      check: 'liveness',
      service: 'controle-financeiro-api',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      hint: 'GET /api/health/ready para testar conexão com o banco.'
    };
  }
}

export interface ResultadoProntidao {
  pronto: boolean;
  corpo: Record<string, unknown>;
}

/** Readiness: SELECT 1 no Postgres e conferência das migrations. */
@Injectable()
export class ProntidaoUseCase {
  constructor(
    @Inject(SAUDE_BANCO) private readonly banco: SaudeBanco,
    @Inject(MIGRACOES_PENDENTES) private readonly migracoes: ConsultaMigracoesPendentes
  ) {}

  async executar(): Promise<ResultadoProntidao> {
    try {
      await this.banco.ping();
      const pendentes = await this.migracoes.listar();
      if (pendentes.length > 0) {
        return {
          pronto: false,
          corpo: {
            status: 'error',
            check: 'ready',
            database: 'connected',
            migrations: 'pending',
            pendentes,
            error: `Migrations pendentes: ${pendentes.join(', ')}`
          }
        };
      }
      return {
        pronto: true,
        corpo: {
          status: 'ok',
          check: 'ready',
          database: 'connected',
          migrations: 'ok',
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      return {
        pronto: false,
        corpo: {
          status: 'error',
          check: 'ready',
          database: 'disconnected',
          error: mensagemErro(error)
        }
      };
    }
  }
}
