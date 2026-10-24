// Carregar .env ANTES de importar os módulos que leem process.env
import './config/loadEnv';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import type { Pool } from 'pg';
import { AppModule } from './app.module';
import { logHttpAtivo } from './config/env';
import { criarPool } from './shared/infrastructure/database/pool';
import { PG_POOL } from './shared/infrastructure/database/tokens';
import { contentLengthPadrao, logHttp } from './shared/presentation/middleware-http';

export interface OpcoesApp {
  /** Pool já criado (testes/compatibilidade). Sem ele, cria um a partir de DB_*. */
  pool?: Pool;
}

/**
 * Cria e inicializa o app Nest (adapter Express) SEM escutar porta: usado por main.ts e pelos testes
 * (`request(app.getHttpServer())`). Quem criou o pool é quem o encerra (`app.get(PG_POOL).end()`).
 */
export async function criarApp(opcoes: OpcoesApp = {}): Promise<NestExpressApplication> {
  const pool = opcoes.pool ?? criarPool();
  // bodyParser desligado: o limite (50mb) e o parser urlencoded são os mesmos da API Express anterior.
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(pool), {
    bodyParser: false,
    logger: ['error', 'warn']
  });

  // Aumentar limite de headers para evitar erro 431
  app.use(contentLengthPadrao);
  app.enableCors({ credentials: true, maxAge: 86400 });
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Uma linha por requisição ao fim da resposta (LOG_HTTP=0 desliga; nunca em NODE_ENV=test)
  if (logHttpAtivo()) {
    app.use(logHttp);
  }

  await app.init();
  return app;
}

export function obterPool(app: NestExpressApplication): Pool {
  return app.get<Pool>(PG_POOL);
}
