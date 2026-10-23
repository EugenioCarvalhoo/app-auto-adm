import pool from '../db';
import { hojeBrasil } from './boletos';

export const LIMITE_DIARIO_PADRAO = 30;

/** EXTRAIR_LIMITE_DIARIO: inteiro positivo; ausente/inválido/<=0 usa o padrão (30). Lido a cada uso. */
export function limiteDiarioExtracoes(env: NodeJS.ProcessEnv = process.env): number {
  const bruto = (env.EXTRAIR_LIMITE_DIARIO || '').trim();
  if (!/^\d+$/.test(bruto)) return LIMITE_DIARIO_PADRAO;
  const n = Number(bruto);
  return Number.isSafeInteger(n) && n > 0 ? n : LIMITE_DIARIO_PADRAO;
}

/**
 * Reserva uma leitura do dia (incremento atômico). Devolve true se ainda estava dentro do limite.
 * Ao passar do limite o contador não é incrementado de novo (WHERE no DO UPDATE), então nega sem crescer.
 */
export async function reservarLeituraDiaria(usuarioId: number, limite: number = limiteDiarioExtracoes()): Promise<boolean> {
  const r = await pool.query<{ total: number }>(
    `INSERT INTO boletos_extracoes_uso (usuario_id, dia, total)
     VALUES ($1, $2::date, 1)
     ON CONFLICT (usuario_id, dia) DO UPDATE SET total = boletos_extracoes_uso.total + 1
       WHERE boletos_extracoes_uso.total < $3
     RETURNING total`,
    [usuarioId, hojeBrasil(), limite]
  );
  // Sem linha retornada: o WHERE do DO UPDATE barrou (limite atingido).
  return r.rows.length > 0 && r.rows[0].total <= limite;
}
