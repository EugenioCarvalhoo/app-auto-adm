import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import type { Pool } from 'pg';
import { AcessoModule } from './acesso/acesso.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { BoletosModule } from './boletos/boletos.module';
import { HealthModule } from './health/health.module';
import { RestaurantesModule } from './restaurantes/restaurantes.module';
import { DatabaseModule } from './shared/infrastructure/database/database.module';
import { TodasExcecoesFilter } from './shared/presentation/todas-excecoes.filter';
import { TratarErrosInterceptor } from './shared/presentation/tratar-erros';

@Module({})
export class AppModule {
  static register(pool: Pool): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DatabaseModule.forRoot(pool),
        AcessoModule,
        AuthModule,
        RestaurantesModule,
        BoletosModule,
        AdminModule,
        HealthModule
      ],
      providers: [
        { provide: APP_FILTER, useClass: TodasExcecoesFilter },
        { provide: APP_INTERCEPTOR, useClass: TratarErrosInterceptor }
      ]
    };
  }
}
