const {
  montarResumoSemanal,
  podeExcluirLancamento,
  parseValorBoleto,
  parseDateOnly,
  enriquecerBoleto
} = require('../../src/boletos/domain/boleto');

const criado = new Date('2026-10-20T12:00:00Z');
let seq = 0;
function boleto(over) {
  seq += 1;
  return {
    id: seq,
    restaurante_id: 1,
    usuario_id: 1,
    dt_recebimento: '2026-10-20',
    dt_vencimento: '2026-10-24',
    descricao: 'x',
    valor: '10.00',
    tipo: 'Boleto',
    created_at: criado,
    updated_at: criado,
    ...over
  };
}
function meta(over) {
  seq += 1;
  return {
    id: seq,
    restaurante_id: 1,
    data_referencia: '2026-10-24',
    semana_chave: '20261024.20261030',
    semana_inicio: '2026-10-24',
    semana_fim: '2026-10-30',
    maximo_gasto: '100.00',
    created_at: criado,
    updated_at: criado,
    ...over
  };
}

describe('montarResumoSemanal', () => {
  it('sem dados devolve semanas vazias e total zero', () => {
    expect(montarResumoSemanal([], [])).toEqual({ semanas: [], total_geral: 0 });
  });

  it('agrupa sábado-sexta: sáb 24/10 e sex 30/10 na mesma semana; sáb 31/10 na seguinte', () => {
    const r = montarResumoSemanal(
      [
        boleto({ dt_vencimento: '2026-10-24', valor: '10.00' }),
        boleto({ dt_vencimento: '2026-10-30', valor: '5.50' }),
        boleto({ dt_vencimento: '2026-10-31', valor: '7.00' })
      ],
      []
    );
    expect(r.semanas).toHaveLength(2);
    expect(r.semanas[0]).toMatchObject({ inicio: '2026-10-24', fim: '2026-10-30', total: 15.5, quantidade: 2, maximo: null, saldo: null });
    expect(r.semanas[1]).toMatchObject({ inicio: '2026-10-31', total: 7, quantidade: 1 });
    expect(r.total_geral).toBe(22.5);
  });

  it('soma em centavos sem erro de ponto flutuante', () => {
    const r = montarResumoSemanal(
      [boleto({ valor: '0.10' }), boleto({ valor: '0.20' }), boleto({ valor: '0.30' })],
      []
    );
    expect(r.semanas[0].total).toBe(0.6);
    expect(r.total_geral).toBe(0.6);
  });

  it('meta calcula saldo (pode ficar negativo) e meta sem boletos cria semana zerada', () => {
    const r = montarResumoSemanal(
      [boleto({ dt_vencimento: '2026-10-24', valor: '150.00' })],
      [
        meta({ maximo_gasto: '100.00' }),
        meta({ semana_chave: '20261107.20261113', semana_inicio: '2026-11-07', semana_fim: '2026-11-13', maximo_gasto: '50.00' })
      ]
    );
    expect(r.semanas[0]).toMatchObject({ total: 150, maximo: 100, saldo: -50 });
    expect(r.semanas[1]).toMatchObject({ chave: '20261107.20261113', total: 0, quantidade: 0, maximo: 50, saldo: 50 });
  });

  it('ignora boleto sem semana (datas inválidas) e ordena por chave', () => {
    const r = montarResumoSemanal(
      [
        boleto({ dt_vencimento: null, dt_recebimento: null }),
        boleto({ dt_vencimento: '2026-11-07' }),
        boleto({ dt_vencimento: '2026-10-24' })
      ],
      []
    );
    expect(r.semanas.map((s) => s.inicio)).toEqual(['2026-10-24', '2026-11-07']);
    expect(r.semanas.reduce((a, s) => a + s.quantidade, 0)).toBe(2);
  });
});

describe('podeExcluirLancamento', () => {
  const base = new Date('2026-10-20T12:00:00Z').getTime();
  const DIA = 24 * 60 * 60 * 1000;

  it('admin exclui sempre, mesmo com mais de 24h ou data inválida', () => {
    expect(podeExcluirLancamento(true, new Date(base), base + 100 * DIA)).toBe(true);
    expect(podeExcluirLancamento(true, 'lixo', base)).toBe(true);
  });

  it('não-admin exclui até exatamente 24h (borda inclusiva) e não após 24h + 1ms', () => {
    expect(podeExcluirLancamento(false, new Date(base), base)).toBe(true);
    expect(podeExcluirLancamento(false, new Date(base), base + DIA)).toBe(true);
    expect(podeExcluirLancamento(false, new Date(base), base + DIA + 1)).toBe(false);
  });

  it('aceita created_at como string ISO', () => {
    expect(podeExcluirLancamento(false, '2026-10-20T12:00:00Z', base + 1000)).toBe(true);
    expect(podeExcluirLancamento(false, '2026-10-20T12:00:00Z', base + 2 * DIA)).toBe(false);
  });

  it('created_at inválido bloqueia o não-admin', () => {
    expect(podeExcluirLancamento(false, 'não é data', base)).toBe(false);
    expect(podeExcluirLancamento(false, new Date(NaN), base)).toBe(false);
  });
});

describe('parseValorBoleto / parseDateOnly / enriquecerBoleto', () => {
  it('parseia formatos BR e rejeita inválidos ou acima do limite NUMERIC(14,2)', () => {
    expect(parseValorBoleto('R$ 1.234,56')).toBe(1234.56);
    expect(parseValorBoleto('12.5')).toBe(12.5);
    expect(parseValorBoleto(0)).toBe(0);
    expect(parseValorBoleto(-1)).toBeNull();
    expect(parseValorBoleto('abc')).toBeNull();
    expect(parseValorBoleto('')).toBeNull();
    expect(parseValorBoleto(null)).toBeNull();
    expect(parseValorBoleto(1e15)).toBeNull();
    expect(parseValorBoleto(999999999999.99)).toBe(999999999999.99);
    expect(parseValorBoleto(Infinity)).toBeNull();
  });

  it('parseDateOnly rejeita datas impossíveis', () => {
    expect(parseDateOnly('2026-02-28')).toBe('2026-02-28');
    expect(parseDateOnly('2026-02-31')).toBeNull();
    expect(parseDateOnly('2024-02-29')).toBe('2024-02-29');
    expect(parseDateOnly('2026-13-01')).toBeNull();
    expect(parseDateOnly('26-01-01')).toBeNull();
    expect(parseDateOnly(20260101)).toBeNull();
  });

  it('enriquecerBoleto converte valor, descrição nula e tipo desconhecido', () => {
    const e = enriquecerBoleto(boleto({ valor: '12.30', descricao: null, tipo: 'qualquer' }));
    expect(e.valor).toBe(12.3);
    expect(e.descricao).toBe('');
    expect(e.tipo).toBe('Boleto');
  });
});
