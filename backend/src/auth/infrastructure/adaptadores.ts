import { Inject, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { Pool } from 'pg';
import { PG_POOL } from '../../shared/infrastructure/database/tokens';
import type { PasswordHasher, UsuarioAuth, UsuariosAuthRepository } from '../application/portas';

@Injectable()
export class PgUsuariosAuthRepository implements UsuariosAuthRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async buscarPorUsername(username: string): Promise<UsuarioAuth | null> {
    const result = await this.pool.query<UsuarioAuth>('SELECT * FROM usuarios WHERE username = $1', [username]);
    return result.rows[0] ?? null;
  }

  async buscarPorId(id: number): Promise<UsuarioAuth | null> {
    const result = await this.pool.query<UsuarioAuth>('SELECT * FROM usuarios WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }
}

@Injectable()
export class BcryptPasswordHasher implements PasswordHasher {
  comparar(senha: string, hash: string): Promise<boolean> {
    return bcrypt.compare(senha, hash);
  }

  gerar(senha: string): Promise<string> {
    return bcrypt.hash(senha, 10);
  }
}
