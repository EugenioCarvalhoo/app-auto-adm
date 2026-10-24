/**
 * Limite diário de leituras por IA no Postgres real (PgLimiteDiarioRepository + tabela boletos_extracoes_uso).
 * Confere o efeito no banco: contagem, atomicidade sob concorrência, devolução sem ficar negativa,
 * virada do dia (data de São Paulo, informada pela aplicação) e independência entre usuários.
 */
require('reflect-metadata');
const { usarBancoReal } = require('./helpers/setup');
const { PgLimiteDiarioRepository } = require('../src/boletos/infrastructure/pg-limite-diario.repository');

const env = usarBancoReal();

const DIA = '2026-10-23';
const DIA_SEGUINTE = '2026-10-24';

describe('limite diário de leituras por IA (Postgres real)', () => {
  let repo;
  beforeEach(() => {
    repo = new PgLimiteDiarioRepository(env.pool);
  });

  const total = async (usuarioId, dia = DIA) => {
    const linha = await env.um('SELECT total FROM boletos_extracoes_uso WHERE usuario_id = $1 AND dia = $2', [usuarioId, dia]);
    return linha ? linha.total : null;
  };

  it('reserva até o limite e a reserva seguinte falha; o banco registra exatamente o limite', async () => {
    expect(await repo.reservar(2, DIA, 3)).toBe(true);
    expect(await repo.reservar(2, DIA, 3)).toBe(true);
    expect(await repo.reservar(2, DIA, 3)).toBe(true);
    expect(await repo.reservar(2, DIA, 3)).toBe(false);
    expect(await repo.reservar(2, DIA, 3)).toBe(false);
    expect(await total(2)).toBe(3);
  });

  it('falha de reserva não grava nada além do limite (total não passa de 3)', async () => {
    for (let i = 0; i < 5; i++) await repo.reservar(2, DIA, 3);
    expect(await total(2)).toBe(3);
  });

  it('concorrência: 10 reservas simultâneas com limite 3 dão exatamente 3 sucessos', async () => {
    const resultados = await Promise.all(Array.from({ length: 10 }, () => repo.reservar(2, DIA, 3)));
    expect(resultados.filter(Boolean)).toHaveLength(3);
    expect(await total(2)).toBe(3);
  });

  it('concorrência sem linha prévia (a 1ª reserva do dia é a que cria a linha): ainda exatamente o limite', async () => {
    // Vários dias para aumentar a chance de pegar a corrida da criação da linha (INSERT ... ON CONFLICT).
    const dias = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
    for (const dia of dias) {
      const resultados = await Promise.all(Array.from({ length: 10 }, () => repo.reservar(3, dia, 1)));
      expect(resultados.filter(Boolean)).toHaveLength(1);
      expect(await total(3, dia)).toBe(1);
    }
  });

  it('devolver libera uma vaga para nova reserva', async () => {
    expect(await repo.reservar(2, DIA, 1)).toBe(true);
    expect(await repo.reservar(2, DIA, 1)).toBe(false);
    await repo.devolver(2, DIA);
    expect(await total(2)).toBe(0);
    expect(await repo.reservar(2, DIA, 1)).toBe(true);
  });

  it('devolver nunca deixa o total abaixo de zero (GREATEST), mesmo devolvendo várias vezes', async () => {
    await repo.reservar(2, DIA, 5);
    await repo.devolver(2, DIA);
    await repo.devolver(2, DIA);
    await repo.devolver(2, DIA);
    expect(await total(2)).toBe(0);
  });

  it('devolver sem linha do dia não cria registro', async () => {
    await repo.devolver(2, DIA);
    expect(await total(2)).toBeNull();
    expect(Number((await env.um('SELECT count(*) AS n FROM boletos_extracoes_uso')).n)).toBe(0);
  });

  it('dia seguinte começa zerado: o limite de um dia não vale para o outro', async () => {
    expect(await repo.reservar(2, DIA, 1)).toBe(true);
    expect(await repo.reservar(2, DIA, 1)).toBe(false);
    expect(await repo.reservar(2, DIA_SEGUINTE, 1)).toBe(true);
    expect(await total(2, DIA)).toBe(1);
    expect(await total(2, DIA_SEGUINTE)).toBe(1);
  });

  it('usuários são independentes: o limite de um não bloqueia o outro', async () => {
    expect(await repo.reservar(2, DIA, 1)).toBe(true);
    expect(await repo.reservar(3, DIA, 1)).toBe(true);
    expect(await repo.reservar(2, DIA, 1)).toBe(false);
    expect(await repo.reservar(3, DIA, 1)).toBe(false);
    expect(await total(2)).toBe(1);
    expect(await total(3)).toBe(1);
  });

  it('a linha do limite some junto com o usuário (ON DELETE CASCADE)', async () => {
    await repo.reservar(2, DIA, 5);
    await env.rows('DELETE FROM usuarios WHERE id = 2');
    expect(await total(2)).toBeNull();
  });

  // Bug encontrado na revisão: com limite 0 o INSERT inicial não consulta o WHERE do DO UPDATE,
  // então a 1ª reserva do dia é aceita. Na API isso não acontece (o caso de uso só chama o
  // repositório com limite > 0), mas o contrato do repositório fica furado. Reproduz o problema.
  it.failing('BUG: reservar com limite 0 nunca devolve true, nem na 1ª chamada do dia', async () => {
    expect(await repo.reservar(2, DIA, 0)).toBe(false);
    expect(await total(2)).toBeNull();
  });
});
