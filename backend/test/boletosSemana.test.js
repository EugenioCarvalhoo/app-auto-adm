const {
  intervaloSemana,
  mesSemana,
  semanaMes,
  vencimentoEfetivo,
  grupoSemana
} = require('../lib/boletosSemana');

describe('INTERVALOSEMANA', () => {
  test('sábado inicia a semana e sexta encerra', () => {
    expect(intervaloSemana('2026-09-12')).toEqual({
      inicio: '2026-09-12',
      fim: '2026-09-18',
      chave: '20260912.20260918'
    });
    expect(intervaloSemana('2026-09-14').chave).toBe('20260912.20260918');
    expect(intervaloSemana('2026-09-18').chave).toBe('20260912.20260918');
    expect(intervaloSemana('2026-09-19').chave).toBe('20260919.20260925');
    expect(intervaloSemana('2026-09-21').chave).toBe('20260919.20260925');
  });
});

describe('vencimento e grupo da semana', () => {
  test('sem boleto usa recebimento mais 7 dias', () => {
    expect(vencimentoEfetivo('2026-09-16', null, 'Sem Boleto')).toBe('2026-09-23');
    expect(grupoSemana('2026-09-16', '2026-09-16', 'Sem Boleto').chave).toBe('20260919.20260925');
  });

  test('boleto usa a data de vencimento informada', () => {
    expect(vencimentoEfetivo('2026-09-16', '2026-10-08', 'Boleto')).toBe('2026-10-08');
    expect(grupoSemana('2026-09-16', '2026-10-08', 'Boleto').chave).toBe('20261003.20261009');
  });

  test('sem recebimento não entra no total', () => {
    expect(grupoSemana(null, '2026-09-16', 'Boleto')).toBeNull();
  });
});

describe('funções nomeadas não usadas nas células', () => {
  test('MES_SEMANA e SEMANA_MES', () => {
    expect(mesSemana('2026-09-14')).toBe('0903');
    expect(semanaMes('2026-09-14')).toBe('0902');
    expect(mesSemana('')).toBe('');
    expect(semanaMes('')).toBe('');
  });
});
