import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  semana_chave: string | null;
  created_at?: string | null;
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
  restauranteNome?: string;
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

function lancamentoDentroDeUmDia(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  const criado = new Date(createdAt).getTime();
  if (!Number.isFinite(criado)) return false;
  return Date.now() - criado <= 24 * 60 * 60 * 1000;
}

function dentroDoIntervalo(data: string | null, de: string, ate: string) {
  if (!de && !ate) return true;
  if (!data) return false;
  if (de && data < de) return false;
  if (ate && data > ate) return false;
  return true;
}

function progressoMeta(gasto: number, meta: number | null): number | null {
  if (meta == null || meta <= 0) return null;
  return (gasto / meta) * 100;
}

function textoPercentual(valor: number, casas = 1): string {
  return `${valor.toFixed(casas).replace('.', ',')}%`;
}

function mensagemErro(error: unknown, fallback: string): string {
  const ax = error as { response?: { data?: { error?: string } } };
  return ax.response?.data?.error || fallback;
}

const BoletosModulo: React.FC<Props> = ({ restauranteId, restauranteNome, simples = false, onMessage }) => {
  const [aba, setAba] = useState<Aba>('cadastro');
  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [semanas, setSemanas] = useState<SemanaResumo[]>([]);
  const [metas, setMetas] = useState<Meta[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState(VAZIO);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [metaData, setMetaData] = useState('');
  const [metaValor, setMetaValor] = useState('');
  const [filtroSemana, setFiltroSemana] = useState('');
  const [filtroRecebimentoDe, setFiltroRecebimentoDe] = useState('');
  const [filtroRecebimentoAte, setFiltroRecebimentoAte] = useState('');
  const [filtroPagamentoDe, setFiltroPagamentoDe] = useState('');
  const [filtroPagamentoAte, setFiltroPagamentoAte] = useState('');
  const [filtroTabela, setFiltroTabela] = useState('ALL');
  const [editandoMetaChave, setEditandoMetaChave] = useState<string | null>(null);
  const [metaCardValor, setMetaCardValor] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const ultimoCampo = useRef<HTMLElement | null>(null);

  const guardarCampo = (event: React.FocusEvent<HTMLFormElement>) => {
    const alvo = event.target;
    if (alvo instanceof HTMLElement && alvo.matches('[data-boleto-campo]')) {
      ultimoCampo.current = alvo;
    }
  };

  const focarProximoCampo = () => {
    const raiz = formRef.current;
    if (!raiz) return;
    const campos = Array.from(raiz.querySelectorAll<HTMLElement>('[data-boleto-campo]')).filter(
      (el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0
    );
    if (campos.length === 0) return;
    const focado = document.activeElement;
    const ativo =
      focado instanceof HTMLElement && campos.includes(focado) ? focado : ultimoCampo.current;
    const indice = ativo ? campos.indexOf(ativo) : -1;
    const proximo = indice < 0 ? campos[0] : campos[indice + 1];
    if (proximo) {
      ultimoCampo.current = proximo;
      proximo.focus();
      proximo.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }
    raiz.querySelector<HTMLElement>('[data-boleto-salvar]')?.focus();
  };

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
    if (semanaAtual) mapa.set(semanaAtual.inicio, semanaAtual.fim);
    const opcoes: [string, string][] = [];
    mapa.forEach((fim, inicio) => {
      opcoes.push([inicio, fim]);
    });
    return opcoes.sort((a, b) => b[0].localeCompare(a[0]));
  }, [boletos, semanaAtual]);

  const temFiltroData =
    Boolean(filtroRecebimentoDe || filtroRecebimentoAte || filtroPagamentoDe || filtroPagamentoAte);
  const temFiltro = Boolean(filtroSemana) || temFiltroData;

  const boletosFiltrados = useMemo(() => {
    return boletos.filter((item) => {
      if (filtroSemana && item.semana_inicio !== filtroSemana) return false;
      if (!dentroDoIntervalo(item.dt_recebimento, filtroRecebimentoDe, filtroRecebimentoAte)) return false;
      const pagamento = item.dt_vencimento_efetivo || item.dt_vencimento;
      if (!dentroDoIntervalo(pagamento, filtroPagamentoDe, filtroPagamentoAte)) return false;
      return true;
    });
  }, [
    boletos,
    filtroPagamentoAte,
    filtroPagamentoDe,
    filtroRecebimentoAte,
    filtroRecebimentoDe,
    filtroSemana
  ]);

  const macro = useMemo(() => {
    const total = boletos.reduce((acc, item) => acc + Number(item.valor || 0), 0);
    const deBoleto = boletos.filter((item) => item.tipo === 'Boleto');
    const semBoleto = boletos.filter((item) => item.tipo !== 'Boleto');
    const soma = (itens: Boleto[]) => itens.reduce((acc, item) => acc + Number(item.valor || 0), 0);
    const totalBoletos = soma(deBoleto);
    const totalSemBoleto = soma(semBoleto);
    return {
      total,
      quantidade: boletos.length,
      totalBoletos,
      quantidadeBoletos: deBoleto.length,
      totalSemBoleto,
      quantidadeSemBoleto: semBoleto.length,
      ticket: boletos.length ? total / boletos.length : 0,
      parteBoletos: total ? (totalBoletos / total) * 100 : 0,
      parteSemBoleto: total ? (totalSemBoleto / total) * 100 : 0
    };
  }, [boletos]);

  const lancamentosTabela = useMemo(() => {
    if (filtroTabela === 'ALL') return boletos;
    return boletos.filter((item) => item.semana_chave === filtroTabela);
  }, [boletos, filtroTabela]);

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
    if (!recebimento) {
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
      dt_recebimento: recebimento,
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
    window.setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
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

  const salvarMetaCard = async (semana: SemanaResumo) => {
    const maximo = parseValorBr(metaCardValor);
    if (maximo == null) {
      onMessage?.('Informe o máximo de gasto.');
      return;
    }
    setSalvando(true);
    onMessage?.(null);
    try {
      await axios.post(`${API_URL}/boletos/metas`, {
        restaurante_id: restauranteId,
        data_referencia: semana.inicio,
        maximo_gasto: maximo
      });
      setEditandoMetaChave(null);
      setMetaCardValor('');
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
    <aside
      ref={cardRef}
      className={editandoId ? 'boletos-cadastro-card boletos-cadastro-card--editando' : 'boletos-cadastro-card'}
    >
      <div className="boletos-cadastro-head">
        <div className="boletos-cadastro-titulo">
          <h3>Cadastro de Item</h3>
          <span className="boletos-modo">{editandoId ? 'Modo: Editar' : 'Modo: Adicionar'}</span>
        </div>
        <button
          type="button"
          className="boletos-next"
          aria-label="Próximo campo"
          onMouseDown={(event) => event.preventDefault()}
          onClick={focarProximoCampo}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v12" />
            <path d="M6 13l6 6 6-6" />
          </svg>
        </button>
      </div>
      <form
        ref={formRef}
        className="boletos-form boletos-form--lancamento"
        onSubmit={salvarLancamento}
        onFocus={guardarCampo}
      >
        <label>
          Tipo de dado <span className="boletos-req">*</span>
          <select data-boleto-campo="tipo" value={form.tipo} onChange={(e) => mudarTipo(e.target.value as TipoDado)}>
            <option value="Boleto">Boleto</option>
            <option value="Sem Boleto">Sem Boleto</option>
          </select>
        </label>
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
        {form.tipo === 'Boleto' ? (
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
        ) : (
          <p className="boletos-avista">
            À vista: a data entra com hoje e pode ser alterada. O vencimento usado é essa data mais 7 dias.
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
                  {(!simples || lancamentoDentroDeUmDia(item.created_at)) && (
                    <button type="button" className="boletos-btn-del" onClick={() => excluir(item.id)}>
                      Excluir
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

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
                {filtroSemana ? 'Total da semana' : 'Total'}:{' '}
                <strong>{formatarMoeda(somaValores(boletosFiltrados))}</strong>
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
            </div>
            {tabelaRegistros(boletosFiltrados, 'Nenhum lançamento nesta semana.')}
          </section>
        </div>
      ) : aba === 'resumo' ? (
        <div className="boletos-dash">
          <header className="boletos-dash-head">
            <div>
              <h3>Dashboard financeiro e metas</h3>
              <p>
                {restauranteNome || `Restaurante ${restauranteId}`} · visão geral e acompanhamento semanal
              </p>
            </div>
            <span>Dados do restaurante selecionado</span>
          </header>

          <div className="boletos-dash-metrics">
            <article>
              <span>Total geral ({macro.quantidade} lançamentos)</span>
              <strong>{formatarMoeda(macro.total)}</strong>
              <small>100% do volume financeiro</small>
            </article>
            <article className="boletos-dash-metrics--boleto">
              <span>Total em boletos ({macro.quantidadeBoletos} un.)</span>
              <strong>{formatarMoeda(macro.totalBoletos)}</strong>
              <small>{textoPercentual(macro.parteBoletos, 2)} do total</small>
            </article>
            <article className="boletos-dash-metrics--vista">
              <span>Total sem boleto ({macro.quantidadeSemBoleto} un.)</span>
              <strong>{formatarMoeda(macro.totalSemBoleto)}</strong>
              <small>{textoPercentual(macro.parteSemBoleto, 2)} do total</small>
            </article>
            <article className="boletos-dash-metrics--ticket">
              <span>Ticket médio por lançamento</span>
              <strong>{formatarMoeda(macro.ticket)}</strong>
              <small>Média de valor por item</small>
            </article>
          </div>

          <section className="boletos-dash-panel">
            <div className="boletos-dash-panel-head">
              <div>
                <h3>Comparativo de semanas e metas</h3>
                <p>Visão simultânea de todos os períodos de vencimento</p>
              </div>
              <span>Clique em Editar meta para alterar o teto da semana.</span>
            </div>
            {semanas.length === 0 ? (
              <p className="boletos-dash-empty">Nenhum lançamento ou meta neste restaurante.</p>
            ) : (
              <div className="boletos-dash-cards">
                {semanas.map((semana, indice) => {
                  const progresso = progressoMeta(semana.total, semana.maximo);
                  const estourou = progresso != null && progresso > 100;
                  const atencao = progresso != null && progresso > 80 && progresso <= 100;
                  return (
                    <article key={semana.chave} className="boletos-dash-card">
                      <div className="boletos-dash-card-head">
                        <div>
                          <span className="boletos-dash-chip">Semana {indice + 1}</span>
                          <h4>
                            {formatarDataBr(semana.inicio)} a {formatarDataBr(semana.fim)}
                          </h4>
                        </div>
                        <span>{semana.quantidade} itens</span>
                      </div>
                      <div className="boletos-dash-linhas">
                        <p>
                          <span>Gasto real</span>
                          <strong>{formatarMoeda(semana.total)}</strong>
                        </p>
                        <p>
                          <span>Meta</span>
                          <span className="boletos-dash-meta">
                            {editandoMetaChave === semana.chave ? (
                              <input
                                type="text"
                                inputMode="decimal"
                                value={metaCardValor}
                                onChange={(e) => setMetaCardValor(e.target.value)}
                                placeholder="0,00"
                              />
                            ) : (
                              <strong>
                                {semana.maximo == null ? '—' : formatarMoeda(semana.maximo)}
                              </strong>
                            )}
                            <button
                              type="button"
                              disabled={salvando}
                              onClick={() => {
                                if (editandoMetaChave === semana.chave) {
                                  void salvarMetaCard(semana);
                                  return;
                                }
                                setEditandoMetaChave(semana.chave);
                                setMetaCardValor(
                                  semana.maximo == null ? '' : String(semana.maximo).replace('.', ',')
                                );
                              }}
                            >
                              {editandoMetaChave === semana.chave ? 'Salvar' : 'Editar meta'}
                            </button>
                          </span>
                        </p>
                        <p>
                          <span>Saldo</span>
                          <strong
                            className={
                              semana.saldo == null ? '' : semana.saldo < 0 ? 'boletos-dash-neg' : 'boletos-dash-pos'
                            }
                          >
                            {semana.saldo == null ? '—' : formatarMoeda(semana.saldo)}
                          </strong>
                        </p>
                      </div>
                      <div className="boletos-dash-progresso">
                        <p>
                          <span>Progresso</span>
                          <span className={estourou ? 'boletos-dash-neg' : 'boletos-dash-ok'}>
                            {progresso == null ? '—' : textoPercentual(progresso)}
                          </span>
                        </p>
                        <div>
                          <i
                            className={estourou ? 'is-over' : atencao ? 'is-warn' : ''}
                            style={{ width: `${Math.min(progresso || 0, 100)}%` }}
                          />
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="boletos-dash-table">
            <div className="boletos-dash-panel-head">
              <div>
                <h3>Detalhamento dos lançamentos</h3>
                <p>Filtre os pagamentos por semana para conferir os itens</p>
              </div>
              <label>
                Filtrar tabela
                <select value={filtroTabela} onChange={(e) => setFiltroTabela(e.target.value)}>
                  <option value="ALL">Todas as semanas</option>
                  {semanas.map((semana, indice) => (
                    <option key={semana.chave} value={semana.chave}>
                      Semana {indice + 1} ({formatarDataBr(semana.inicio)} a {formatarDataBr(semana.fim)})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="boletos-table-wrap boletos-table-wrap--plain">
              <table className="boletos-table boletos-dash-grid">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Descrição</th>
                    <th>Tipo</th>
                    <th>Vencimento efetivo</th>
                    <th>Valor (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {lancamentosTabela.length === 0 ? (
                    <tr>
                      <td colSpan={5}>Nenhum lançamento encontrado para este filtro.</td>
                    </tr>
                  ) : (
                    lancamentosTabela.map((item) => (
                      <tr key={item.id}>
                        <td>{item.id}</td>
                        <td className="boletos-desc">{item.descricao}</td>
                        <td>
                          <span
                            className={
                              item.tipo === 'Sem Boleto' ? 'boletos-pill boletos-pill--vista' : 'boletos-pill'
                            }
                          >
                            {item.tipo}
                          </span>
                        </td>
                        <td>{formatarDataBr(item.dt_vencimento_efetivo) || '—'}</td>
                        <td className="boletos-valor">{formatarMoeda(Number(item.valor))}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : aba === 'cadastro' ? (
        <div className="boletos-lancamento">
          {formulario}
          <section className="boletos-registros">
            <div className="boletos-registros-head">
              <h3>Registros Cadastrados</h3>
              <p>
                {filtroSemana || temFiltroData ? 'Total filtrado' : 'Total'}:{' '}
                <strong>{formatarMoeda(somaValores(boletosFiltrados))}</strong>
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
              <div className="boletos-filtro-range">
                <span>Data de recebimento</span>
                <div className="boletos-filtro-range-campos">
                  <label>
                    De
                    <input
                      type="date"
                      value={filtroRecebimentoDe}
                      onChange={(e) => setFiltroRecebimentoDe(e.target.value)}
                    />
                  </label>
                  <label>
                    Até
                    <input
                      type="date"
                      value={filtroRecebimentoAte}
                      onChange={(e) => setFiltroRecebimentoAte(e.target.value)}
                    />
                  </label>
                </div>
              </div>
              <div className="boletos-filtro-range">
                <span>Data de pagamento</span>
                <div className="boletos-filtro-range-campos">
                  <label>
                    De
                    <input
                      type="date"
                      value={filtroPagamentoDe}
                      onChange={(e) => setFiltroPagamentoDe(e.target.value)}
                    />
                  </label>
                  <label>
                    Até
                    <input
                      type="date"
                      value={filtroPagamentoAte}
                      onChange={(e) => setFiltroPagamentoAte(e.target.value)}
                    />
                  </label>
                </div>
              </div>
              {temFiltro && (
                <button
                  type="button"
                  className="boletos-btn-ghost"
                  onClick={() => {
                    setFiltroSemana('');
                    setFiltroRecebimentoDe('');
                    setFiltroRecebimentoAte('');
                    setFiltroPagamentoDe('');
                    setFiltroPagamentoAte('');
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

    </section>
  );
};

export default BoletosModulo;
