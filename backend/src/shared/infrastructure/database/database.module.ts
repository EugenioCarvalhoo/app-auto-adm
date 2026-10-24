import { DynamicModule, Global, Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from './tokens';

@Global()
@Module({})
export class DatabaseModule {
  static forRoot(pool: Pool): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [{ provide: PG_POOL, useValue: pool }],
      exports: [PG_POOL]
    };
  }
}
