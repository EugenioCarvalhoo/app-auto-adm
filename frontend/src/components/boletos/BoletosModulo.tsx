import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { API_URL } from '../../config';
import {
  formatarDataBr,
  formatarMoeda,
  grupoSemana,
  hojeIso,
  intervaloSemana,
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
  simples?: boolean;
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

function focarProximoCampo() {
  const campos = Array.from(document.querySelectorAll<HTMLElement>('[data-boleto-campo]')).filter(
    (el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0
  );
  if (campos.length === 0) return;
  const ativo = document.activeElement as HTMLElement | null;
  const indice = campos.findIndex((el) => el === ativo);
  const proximo = indice < 0 ? campos[0] : campos[indice + 1];
  if (proximo) {
    proximo.focus();
    return;
  }
  document.querySelector<HTMLElement>('[data-boleto-salvar]')?.focus();
}

const BoletosModulo: React.FC<Props> = ({ restauranteId, simples = false, onMessage }) => {
  const [aba, setAba] = useState<Aba>('cadastro');
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
  const [filtroSemana, setFiltroSemana] = useState('');
  const [filtroRecebimento, setFiltroRecebimento] = useState('');

  const semanaAtual = useMemo(() => intervaloSemana(hojeIso()), []);

  const previsao = useMemo(() => {
    const recebimento = form.tipo === 'Sem Boleto' ? form.dt_recebimento || hojeIso() : form.dt_recebimento;
    const efetivo = vencimentoEfetivo(recebimento, form.dt_vencimento, form.tipo);
    const semana = grupoSemana(recebimento, form.dt_vencimento, form.tipo);
    return { recebimento, efetivo, semana };
  }, [form]);

  const carregar = useCallback(async () => {
    setLoading(true);
    onMessage?.(null);
    try {
      const params = { restaurante_id: restauranteId };
      if (simples) {
        const lista = await axios.get<Boleto[]>(`${API_URL}/boletos`, { params });
        setBoletos(lista.data || []);
      } else {
        const [lista, resumo, listaMetas] = await Promise.all([
          axios.get<Boleto[]>(`${API_URL}/boletos`, { params }),
          axios.get<{ semanas: SemanaResumo[]; total_geral: number }>(`${API_URL}/boletos/resumo`, { params }),
          axios.get<Meta[]>(`${API_URL}/boletos/metas`, { params })
        ]);
        setBoletos(lista.data || []);
        setSemanas(resumo.data?.semanas || []);
        setTotalGeral(Number(resumo.data?.total_geral || 0));
        setMetas(listaMetas.data || []);
      }
    } catch (error) {
      onMessage?.(mensagemErro(error, 'Não foi possível carregar boletos e notas.'));
    } finally {
      setLoading(false);
    }
  }, [onMessage, restauranteId, simples]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const opcoesSemana = useMemo(() => {
    const mapa = new Map<string, string>();
    boletos.forEach((item) => {
      if (item.semana_inicio && item.semana_fim) mapa.set(item.semana_inicio, item.semana_fim);
    });
    return [...mapa.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [boletos]);

  const boletosFiltrados = useMemo(() => {
    return boletos.filter((item) => {
      if (filtroSemana && item.semana_inicio !== filtroSemana) return false;
      if (filtroRecebimento && item.dt_recebimento !== filtroRecebimento) return false;
      return true;
    });
  }, [boletos, filtroRecebimento, filtroSemana]);

  const boletosSemanaAtual = useMemo(() => {
    if (!semanaAtual) return [];
    return boletos.filter((item) => {
      const recebimento = item.dt_recebimento || '';
      return recebimento >= semanaAtual.inicio && recebimento <= semanaAtual.fim;
    });
  }, [boletos, semanaAtual]);

  const mudarTipo = (tipo: TipoDado) => {
    if (tipo === 'Sem Boleto') {
      setForm((atual) => ({
        ...atual,
        tipo,
        dt_vencimento: '',
        dt_recebimento: editandoId ? atual.dt_recebimento || hojeIso() : hojeIso()
      }));
      return;
    }
    setForm((atual) => ({ ...atual, tipo }));
  };

  const salvarLancamento = async (event: React.FormEvent) => {
    event.preventDefault();
    const valor = parseValorBr(form.valor);
    const recebimento = form.tipo === 'Sem Boleto' ? form.dt_recebimento || hojeIso() : form.dt_recebimento;
    if (!form.descricao.trim()) {
      onMessage?.('Informe a descrição.');
      return;
    }
    if (form.tipo === 'Boleto' && !recebimento) {
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
      dt_recebimento: form.tipo === 'Sem Boleto' && !editandoId ? hojeIso() : recebimento,
      dt_vencimento: form.tipo === 'Boleto' ? form.dt_vencimento : null,
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
      dt_vencimento: item.tipo === 'Boleto' ? item.dt_vencimento || '' : '',
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

  const somaValores = (itens: Boleto[]) =>
    Math.round(itens.reduce((acc, item) => acc + Number(item.valor || 0), 0) * 100) / 100;

  const formulario = (
    <aside className="boletos-cadastro-card">
      <div className="boletos-cadastro-head">
        <h3>Cadastro de Item</h3>
        <span className="boletos-modo">{editandoId ? 'Modo: Editar' : 'Modo: Adicionar'}</span>
      </div>
      <form className="boletos-form boletos-form--lancamento" onSubmit={salvarLancamento}>
        <label>
          Tipo de dado <span className="boletos-req">*</span>
          <select data-boleto-campo="tipo" value={form.tipo} onChange={(e) => mudarTipo(e.target.value as TipoDado)}>
            <option value="Boleto">Boleto</option>
            <option value="Sem Boleto">Sem Boleto</option>
          </select>
        </label>
        {form.tipo === 'Boleto' ? (
          <>
            <label>
              Dt. recebimento <span className="boletos-req">*</span>
              <input
                data-boleto-campo="recebimento"
                type="date"
                value={form.dt_recebimento}
                onChange={(e) => setForm({ ...form, dt_recebimento: e.target.value })}
                required
              />
            </label>
            <label>
              Dt. vencimento <span className="boletos-req">*</span>
              <input
                data-boleto-campo="vencimento"
                type="date"
                value={form.dt_vencimento}
                onChange={(e) => setForm({ ...form, dt_vencimento: e.target.value })}
                required
              />
            </label>
          </>
        ) : (
          <p className="boletos-avista">
            À vista: a data de recebimento fica {formatarDataBr(previsao.recebimento)} automaticamente.
          </p>
        )}
        <label>
          Descrição <span className="boletos-req">*</span>
          <input
            data-boleto-campo="descricao"
            type="text"
            value={form.descricao}
            placeholder="Ex: Fornecedor de Hortifruti"
            onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            required
          />
        </label>
        <label>
          Valor (R$) <span className="boletos-req">*</span>
          <input
            data-boleto-campo="valor"
            type="text"
            inputMode="decimal"
            value={form.valor}
            onChange={(e) => setForm({ ...form, valor: e.target.value })}
            placeholder="0,00"
            required
          />
        </label>
        <button type="submit" className="boletos-btn-adicionar" data-boleto-salvar disabled={salvando}>
          {editandoId ? 'Atualizar' : 'Adicionar'}
        </button>
        {editandoId && (
          <button
            type="button"
            className="boletos-btn-ghost boletos-btn-cancelar"
            onClick={() => {
              setEditandoId(null);
              setForm(VAZIO);
            }}
          >
            Cancelar
          </button>
        )}
      </form>
      <p className="boletos-preview">
        Vencimento usado: {previsao.efetivo ? formatarDataBr(previsao.efetivo) : '—'}
      </p>
      <p className="boletos-preview">
        Semana:{' '}
        {previsao.semana
          ? `${formatarDataBr(previsao.semana.inicio)} a ${formatarDataBr(previsao.semana.fim)}`
          : '—'}
      </p>
    </aside>
  );

  const tabelaRegistros = (itens: Boleto[], vazio: string) =>
    itens.length === 0 ? (
      <p className="boletos-empty">{vazio}</p>
    ) : (
      <div className="boletos-table-wrap boletos-table-wrap--plain">
        <table className="boletos-table boletos-table--registros">
          <thead>
            <tr>
              <th>Dt. recebimento</th>
              <th>Dt. vencimento</th>
              <th>Descrição</th>
              <th>Valor</th>
              <th>Tipo</th>
              <th>Semana</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => (
              <tr key={item.id}>
                <td>{formatarDataBr(item.dt_recebimento)}</td>
                <td>
                  {formatarDataBr(item.tipo === 'Sem Boleto' ? item.dt_vencimento_efetivo : item.dt_vencimento)}
                </td>
                <td className="boletos-desc">{item.descricao}</td>
                <td className="boletos-valor">{formatarMoeda(Number(item.valor))}</td>
                <td>
                  <span className={item.tipo === 'Sem Boleto' ? 'boletos-pill boletos-pill--vista' : 'boletos-pill'}>
                    {item.tipo === 'Sem Boleto' ? 'Sem Boleto' : 'Boleto'}
                  </span>
                </td>
                <td>
                  {item.semana_inicio
                    ? `${formatarDataBr(item.semana_inicio)} a ${formatarDataBr(item.semana_fim)}`
                    : '—'}
                </td>
                <td className="boletos-actions">
                  <button type="button" className="boletos-btn-edit" onClick={() => editar(item)}>
                    Editar
                  </button>
                  <button type="button" className="boletos-btn-del" onClick={() => excluir(item.id)}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  const mostrarNext = simples || aba === 'cadastro';

  return (
    <section className="boletos">
      <header className="boletos-head">
        <div>
          <h2>Boletos e Notas</h2>
          <p>
            Semana de sábado a sexta, pelo vencimento. Sem boleto, o vencimento usado é a data de recebimento mais 7
            dias.
          </p>
        </div>
        {!simples && (
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
        )}
      </header>

      {loading ? (
        <p className="boletos-empty">Carregando…</p>
      ) : simples ? (
        <div className="boletos-lancamento">
          {formulario}
          <section className="boletos-registros">
            <div className="boletos-registros-head">
              <h3>Registros Cadastrados</h3>
              <p>
                Total da semana: <strong>{formatarMoeda(somaValores(boletosSemanaAtual))}</strong>
              </p>
            </div>
            <p className="boletos-hint">
              Semana atual:{' '}
              {semanaAtual ? `${formatarDataBr(semanaAtual.inicio)} a ${formatarDataBr(semanaAtual.fim)}` : '—'}
            </p>
            {tabelaRegistros(boletosSemanaAtual, 'Nenhum lançamento recebido nesta semana.')}
          </section>
        </div>
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
        <div className="boletos-lancamento">
          {formulario}
          <section className="boletos-registros">
            <div className="boletos-registros-head">
              <h3>Registros Cadastrados</h3>
              <p>
                {filtroSemana || filtroRecebimento ? 'Total filtrado' : 'Total da semana'}:{' '}
                <strong>
                  {formatarMoeda(
                    somaValores(
                      filtroSemana || filtroRecebimento
                        ? boletosFiltrados
                        : boletos.filter((item) => item.semana_inicio === semanaAtual?.inicio)
                    )
                  )}
                </strong>
              </p>
            </div>
            <div className="boletos-filtros">
              <label>
                Semana
                <select value={filtroSemana} onChange={(e) => setFiltroSemana(e.target.value)}>
                  <option value="">Todas</option>
                  {opcoesSemana.map(([inicio, fim]) => (
                    <option key={inicio} value={inicio}>
                      {formatarDataBr(inicio)} a {formatarDataBr(fim)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Data de recebimento
                <input type="date" value={filtroRecebimento} onChange={(e) => setFiltroRecebimento(e.target.value)} />
              </label>
              {(filtroSemana || filtroRecebimento) && (
                <button
                  type="button"
                  className="boletos-btn-ghost"
                  onClick={() => {
                    setFiltroSemana('');
                    setFiltroRecebimento('');
                  }}
                >
                  Limpar filtros
                </button>
              )}
            </div>
            {tabelaRegistros(boletosFiltrados, 'Nenhum lançamento com esse filtro.')}
          </section>
        </div>
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
            A data define a semana de sábado a sexta. Salvar de novo na mesma semana atualiza o máximo.
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

      {mostrarNext &&
        !loading &&
        createPortal(
          <button type="button" className="boletos-next" onClick={focarProximoCampo} aria-label="Next">
            Next
          </button>,
          document.body
        )}
    </section>
  );
};

export default BoletosModulo;
