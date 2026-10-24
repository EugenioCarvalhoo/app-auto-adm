import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LivenessUseCase, ProntidaoUseCase } from '../application/casos-de-uso';

@Controller()
export class HealthController {
  constructor(
    @Inject(LivenessUseCase) private readonly liveness: LivenessUseCase,
    @Inject(ProntidaoUseCase) private readonly prontidao: ProntidaoUseCase
  ) {}

  @Get('api/health')
  verificarLiveness() {
    return this.liveness.executar();
  }

  // /health na raiz: Easypanel / probes antigos continuam com checagem de banco
  @Get(['api/health/ready', 'health'])
  async verificarProntidao(@Res({ passthrough: true }) res: Response) {
    const { pronto, corpo } = await this.prontidao.executar();
    res.status(pronto ? 200 : 503);
    return corpo;
  }
}
