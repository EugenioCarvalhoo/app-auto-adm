import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../config';
import {
  formatarDataBr,
  formatarMoeda,
  grupoSemana,
  parseValorBr,
  vencimentoEfetivo
} from '../../lib/boletosSemana';
import './BoletosModulo.css';

type Aba = 'resumo' | 'cadastro' | 'metas';
type TipoDado = 'Boleto' | 'Sem Boleto';

interface Boleto {
  id: number;
  restaurante_id: number;
  dt_recebimento: string | null;
  dt_vencimento: string | null;
  descricao: string;
  valor: number;
  tipo: TipoDado;
  dt_vencimento_efetivo: string | null;
  semana_inicio: string | null;
  semana_fim: string | null;
}

interface SemanaResumo {
  chave: string;
  inicio: string;
  fim: string;
  total: number;
  quantidade: number;
  maximo: number | null;
  saldo: number | null;
}

interface Meta {
  id: number;
  data_referencia: string;
  semana_inicio: string;
  semana_fim: string;
  maximo_gasto: number;
}

interface Props {
  restauranteId: number;
  onMessage?: (msg: string | null) => void;
}

const VAZIO = {
  dt_recebimento: '',
  dt_vencimento: '',
  descricao: '',
  valor: '',
  tipo: 'Boleto' as TipoDado
};

function mensagemErro(error: unknown, fallback: string): string {
  const ax = error as { response?: { data?: { error?: string } } };
  return ax.response?.data?.error || fallback;
}

const BoletosModulo: React.FC<Props> = ({ restauranteId, onMessage }) => {
  const [aba, setAba] = useState<Aba>('resumo');
  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [semanas, setSemanas] = useState<SemanaResumo[]>([]);
  const [totalGeral, setTotalGeral] = useState(0);
  const [metas, setMetas] = useState<Meta[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState(VAZIO);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [metaData, setMetaData] = useState('');
  const [metaValor, setMetaValor] = useState('');

  const previsao = useMemo(() => {
    const efetivo = vencimentoEfetivo(form.dt_recebimento, form.dt_vencimento, form.tipo);
    const semana = grupoSemana(form.dt_recebimento, form.dt_vencimento, form.tipo);
    return { efetivo, semana };
  }, [form]);

  const carregar = useCallback(async () => {
    setLoading(true);
    onMessage?.(null);
    try {
      const params = { restaurante_id: restauranteId };
      const [lista, resumo, listaMetas] = await Promise.all([
        axios.get<Boleto[]>(`${API_URL}/boletos`, { params }),
        axios.get<{ semanas: SemanaResumo[]; total_geral: number }>(`${API_URL}/boletos/resumo`, { params }),
        axios.get<Meta[]>(`${API_URL}/boletos/metas`, { params })
      ]);
      setBoletos(lista.data || []);
      setSemanas(resumo.data?.semanas || []);
      setTotalGeral(Number(resumo.data?.total_geral || 0));
      setMetas(listaMetas.data || []);
    } catch (error) {
      onMessage?.(mensagemErro(error, 'Não foi possível carregar boletos e notas.'));
    } finally {
      setLoading(false);
    }
  }, [onMessage, restauranteId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const salvarLancamento = async (event: React.FormEvent) => {
    event.preventDefault();
    const valor = parseValorBr(form.valor);
    if (!form.descricao.trim()) {
      onMessage?.('Informe a descrição.');
      return;
    }
    if (!form.dt_recebimento) {
      onMessage?.('Informe a data de recebimento.');
      return;
    }
    if (form.tipo === 'Boleto' && !form.dt_vencimento) {
      onMessage?.('Informe a data de vencimento do boleto.');
      return;
    }
    if (valor == null) {
      onMessage?.('Informe um valor válido.');
      return;
    }
    setSalvando(true);
    onMessage?.(null);
    const payload = {
      restaurante_id: restauranteId,
      dt_recebimento: form.dt_recebimento,
      dt_vencimento: form.tipo === 'Boleto' ? form.dt_vencimento : form.dt_vencimento || null,
      descricao: form.descricao.trim(),
      valor,
      tipo: form.tipo
    };
    try {
      if (editandoId) {
        await axios.put(`${API_URL}/boletos/${editandoId}`, payload);
      } else {
        await axios.post(`${API_URL}/boletos`, payload);
      }
      setForm(VAZIO);
      setEditandoId(null);
      await carregar();
    } catch (error) {
      onMessage?.(mensagemErro(error, 'Não foi possível salvar o lançamento.'));
    } finally {
      setSalvando(false);
    }
  };

  const editar = (item: Boleto) => {
    setAba('cadastro');
    setEditandoId(item.id);
    setForm({
      dt_recebimento: item.dt_recebimento || '',
      dt_vencimento: item.dt_vencimento || '',
      descricao: item.descricao,
      valor: String(item.valor).replace('.', ','),
      tipo: item.tipo
    });
  };

  const excluir = async (id: number) => {
    if (!window.confirm('Remover este lançamento?')) return;
    onMessage?.(null);
    try {
      await axios.delete(`${API_URL}/boletos/${id}`);
      if (editandoId === id) {
        setEditandoId(null);
        setForm(VAZIO);
      }
      await carregar();
    } catch (error) {
      onMessage?.(mensagemErro(error, 'Não foi possível remover o lançamento.'));
    }
  };

  const salvarMeta = async (event: React.FormEvent) => {
    event.preventDefault();
    const maximo = parseValorBr(metaValor);
    if (!metaData) {
      onMessage?.('Informe uma data da semana.');
      return;
    }
    if (maximo == null) {
      onMessage?.('Informe o máximo de gasto.');
      return;
    }
    setSalvando(true);
    onMessage?.(null);
    try {
      await axios.post(`${API_URL}/boletos/metas`, {
        restaurante_id: restauranteId,
        data_referencia: metaData,
        maximo_gasto: maximo
      });
      setMetaData('');
      setMetaValor('');
      await carregar();
    } catch (error) {
      onMessage?.(mensagemErro(error, 'Não foi possível salvar a meta.'));
    } finally {
      setSalvando(false);
    }
  };

  const excluirMeta = async (id: number) => {
    if (!window.confirm('Remover esta meta?')) return;
    try {
      await axios.delete(`${API_URL}/boletos/metas/${id}`);
      await carregar();
    } catch (error) {
      onMessage?.(mensagemErro(error, 'Não foi possível remover a meta.'));
    }
  };

  return (
    <section className="boletos">
      <header className="boletos-head">
        <div>
          <h2>Boletos e notas</h2>
          <p>
            Semana de sábado a sexta, pelo vencimento. Sem boleto, o vencimento usado é a data de recebimento mais 7
            dias. O total da semana segue a consulta da planilha e compara com a meta.
          </p>
        </div>
        <div className="boletos-abas" role="tablist">
          <button type="button" className={aba === 'resumo' ? 'active' : ''} onClick={() => setAba('resumo')}>
            Totais da semana
          </button>
          <button type="button" className={aba === 'cadastro' ? 'active' : ''} onClick={() => setAba('cadastro')}>
            Cadastro
          </button>
          <button type="button" className={aba === 'metas' ? 'active' : ''} onClick={() => setAba('metas')}>
            Meta de gasto
          </button>
        </div>
      </header>

      {loading ? (
        <p className="boletos-empty">Carregando…</p>
      ) : aba === 'resumo' ? (
        <>
          <p className="boletos-total">
            Total lançado: <strong>{formatarMoeda(totalGeral)}</strong>
          </p>
          {semanas.length === 0 ? (
            <p className="boletos-empty">Nenhum lançamento ou meta neste restaurante.</p>
          ) : (
            <div className="boletos-table-wrap">
              <table className="boletos-table">
                <thead>
                  <tr>
                    <th>Mês/Semana</th>
                    <th>Total</th>
                    <th>Máximo</th>
                    <th>Saldo</th>
                    <th>Lançamentos</th>
                  </tr>
                </thead>
                <tbody>
                  {semanas.map((semana) => (
                    <tr key={semana.chave} className={semana.saldo != null && semana.saldo < 0 ? 'boletos-acima' : ''}>
                      <td>
                        {formatarDataBr(semana.inicio)} a {formatarDataBr(semana.fim)}
                      </td>
                      <td>{formatarMoeda(semana.total)}</td>
                      <td>{semana.maximo == null ? '—' : formatarMoeda(semana.maximo)}</td>
                      <td>{semana.saldo == null ? '—' : formatarMoeda(semana.saldo)}</td>
                      <td>{semana.quantidade}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : aba === 'cadastro' ? (
        <>
          <form className="boletos-form" onSubmit={salvarLancamento}>
            <label>
              Dt. recebimento
              <input
                type="date"
                value={form.dt_recebimento}
                onChange={(e) => setForm({ ...form, dt_recebimento: e.target.value })}
                required
              />
            </label>
            <label>
              Dt. vencimento
              <input
                type="date"
                value={form.dt_vencimento}
                onChange={(e) => setForm({ ...form, dt_vencimento: e.target.value })}
                required={form.tipo === 'Boleto'}
              />
            </label>
            <label>
              Descrição
              <input
                type="text"
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                required
              />
            </label>
            <label>
              Valor
              <input
                type="text"
                inputMode="decimal"
                value={form.valor}
                onChange={(e) => setForm({ ...form, valor: e.target.value })}
                placeholder="0,00"
                required
              />
            </label>
            <label>
              Tipo de dado
              <select
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoDado })}
              >
                <option value="Boleto">Boleto</option>
                <option value="Sem Boleto">Sem Boleto</option>
              </select>
            </label>
            <div className="boletos-form-actions">
              <button type="submit" className="btn-primary" disabled={salvando}>
                {editandoId ? 'Atualizar' : 'Adicionar'}
              </button>
              {editandoId && (
                <button
                  type="button"
                  className="boletos-btn-ghost"
                  onClick={() => {
                    setEditandoId(null);
                    setForm(VAZIO);
                  }}
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>
          <p className="boletos-hint">
            Vencimento usado: {previsao.efetivo ? formatarDataBr(previsao.efetivo) : '—'}
            {' · '}
            Semana:{' '}
            {previsao.semana
              ? `${formatarDataBr(previsao.semana.inicio)} a ${formatarDataBr(previsao.semana.fim)}`
              : '—'}
          </p>
          {boletos.length === 0 ? (
            <p className="boletos-empty">Nenhum boleto ou nota cadastrado.</p>
          ) : (
            <div className="boletos-table-wrap">
              <table className="boletos-table">
                <thead>
                  <tr>
                    <th>Dt. recebimento</th>
                    <th>Dt. vencimento</th>
                    <th>Descrição</th>
                    <th>Valor</th>
                    <th>Tipo</th>
                    <th>Semana</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {boletos.map((item) => (
                    <tr key={item.id}>
                      <td>{formatarDataBr(item.dt_recebimento)}</td>
                      <td>
                        {item.tipo === 'Sem Boleto'
                          ? formatarDataBr(item.dt_vencimento_efetivo)
                          : formatarDataBr(item.dt_vencimento)}
                      </td>
                      <td>{item.descricao}</td>
                      <td>{formatarMoeda(Number(item.valor))}</td>
                      <td>{item.tipo}</td>
                      <td>
                        {item.semana_inicio
                          ? `${formatarDataBr(item.semana_inicio)} a ${formatarDataBr(item.semana_fim)}`
                          : '—'}
                      </td>
                      <td className="boletos-actions">
                        <button type="button" onClick={() => editar(item)}>
                          Editar
                        </button>
                        <button type="button" onClick={() => excluir(item.id)}>
                          Excluir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <form className="boletos-form" onSubmit={salvarMeta}>
            <label>
              Data na semana
              <input type="date" value={metaData} onChange={(e) => setMetaData(e.target.value)} required />
            </label>
            <label>
              Máximo gasto
              <input
                type="text"
                inputMode="decimal"
                value={metaValor}
                onChange={(e) => setMetaValor(e.target.value)}
                placeholder="0,00"
                required
              />
            </label>
            <div className="boletos-form-actions">
              <button type="submit" className="btn-primary" disabled={salvando}>
                Salvar meta
              </button>
            </div>
          </form>
          <p className="boletos-hint">
            A data define a semana de sábado a sexta, como a coluna de referência da planilha. Salvar de novo na mesma
            semana atualiza o máximo.
          </p>
          {metas.length === 0 ? (
            <p className="boletos-empty">Nenhuma meta cadastrada.</p>
          ) : (
            <div className="boletos-table-wrap">
              <table className="boletos-table">
                <thead>
                  <tr>
                    <th>Semana</th>
                    <th>Data de referência</th>
                    <th>Máximo gasto</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {metas.map((meta) => (
                    <tr key={meta.id}>
                      <td>
                        {formatarDataBr(meta.semana_inicio)} a {formatarDataBr(meta.semana_fim)}
                      </td>
                      <td>{formatarDataBr(meta.data_referencia)}</td>
                      <td>{formatarMoeda(Number(meta.maximo_gasto))}</td>
                      <td className="boletos-actions">
                        <button type="button" onClick={() => excluirMeta(meta.id)}>
                          Excluir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default BoletosModulo;
