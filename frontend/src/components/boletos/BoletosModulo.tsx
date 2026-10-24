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
import { mensagemErro, type ErroApi } from '../../lib/erros';
import PreviewImagem from './PreviewImagem';
import { reduzirImagem, TIPOS_IMAGEM_ACEITOS } from '../../lib/imagem';
import type { Boleto, Meta, SemanaResumo, SugestaoBoleto, TipoDado } from '../../types';
import './BoletosModulo.css';

type Aba = 'resumo' | 'cadastro' | 'metas';
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

type CampoTexto = 'dt_recebimento' | 'dt_vencimento' | 'descricao' | 'valor';
type CampoIa = CampoTexto | 'tipo';

function mensagemLeitura(error: unknown): string {
  const indisponivel = 'Leitura por IA indisponível no momento; preencha manualmente.';
  if (axios.isAxiosError<ErroApi>(error)) {
    const status = error.response?.status;
    const doServidor = error.response?.data?.error;
    if (status === 413) return 'Imagem muito grande. Tire a foto de novo ou escolha uma menor.';
    if (status === 415) return 'Use uma foto JPG, PNG ou WebP.';
    if (status === 503) return indisponivel;
    if (status === 429 || status === 502 || status === 400) {
      return doServidor || (status === 429 ? 'Limite diário de leituras por IA atingido.' : indisponivel);
    }
    if (!error.response) return 'Sem conexão com o servidor. Preencha manualmente ou tente de novo.';
    return doServidor || indisponivel;
  }
  if (error instanceof Error && error.message === 'Imagem muito grande') {
    return 'Imagem muito grande. Tire a foto de novo ou escolha uma menor.';
  }
  return 'Não foi possível ler a imagem. Preencha manualmente.';
}

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

  const formAtual = useRef(form);
  formAtual.current = form;
  const [lendo, setLendo] = useState(false);
  const [camposIa, setCamposIa] = useState<CampoIa[]>([]);
  const [linhaDigitavel, setLinhaDigitavel] = useState<string | null>(null);
  const [linhaCopiada, setLinhaCopiada] = useState(false);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  const [avisoLeitura, setAvisoLeitura] = useState<string | null>(null);
  const leituraAbort = useRef<AbortController | null>(null);

  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [previewAberto, setPreviewAberto] = useState(false);
  const fotoUrlRef = useRef<string | null>(null);
  const botaoVerImagem = useRef<HTMLButtonElement>(null);

  const descartarFoto = useCallback(() => {
    if (fotoUrlRef.current) URL.revokeObjectURL(fotoUrlRef.current);
    fotoUrlRef.current = null;
    setFotoUrl(null);
    setPreviewAberto(false);
  }, []);

  const guardarFoto = (arquivo: Blob) => {
    if (fotoUrlRef.current) URL.revokeObjectURL(fotoUrlRef.current);
    const url = URL.createObjectURL(arquivo);
    fotoUrlRef.current = url;
    setFotoUrl(url);
    setPreviewAberto(false);
  };

  useEffect(
    () => () => {
      if (fotoUrlRef.current) URL.revokeObjectURL(fotoUrlRef.current);
      fotoUrlRef.current = null;
    },
    []
  );

  const fecharPreview = () => {
    setPreviewAberto(false);
    window.setTimeout(() => botaoVerImagem.current?.focus(), 0);
  };

  const limparIa = () => {
    descartarFoto();
    setCamposIa([]);
    setLinhaDigitavel(null);
    setLinhaCopiada(false);
    setErroLeitura(null);
    setAvisoLeitura(null);
  };

  const cancelarLeitura = useCallback(() => {
    leituraAbort.current?.abort();
    leituraAbort.current = null;
    setLendo(false);
  }, []);

  useEffect(() => cancelarLeitura, [cancelarLeitura]);

  useEffect(() => {
    cancelarLeitura();
    descartarFoto();
    setCamposIa([]);
    setLinhaDigitavel(null);
    setErroLeitura(null);
    setAvisoLeitura(null);
  }, [restauranteId, cancelarLeitura, descartarFoto]);

  const alterar = (campo: CampoTexto, valor: string) => {
    setForm((atual) => ({ ...atual, [campo]: valor }));
    setCamposIa((atual) => (atual.includes(campo) ? atual.filter((c) => c !== campo) : atual));
  };

  const lerPorFoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const arquivo = event.target.files?.[0];
    event.target.value = '';
    if (!arquivo) return;
    leituraAbort.current?.abort();
    const controle = new AbortController();
    leituraAbort.current = controle;
    setLendo(true);
    setErroLeitura(null);
    setAvisoLeitura(null);
    try {
      const imagem = await reduzirImagem(arquivo);
      if (controle.signal.aborted) return;
      guardarFoto(imagem);
      const corpo = new FormData();
      corpo.append('restaurante_id', String(restauranteId));
      corpo.append('imagem', imagem, imagem.name);
      const { data } = await axios.post<SugestaoBoleto>(`${API_URL}/boletos/extrair`, corpo, {
        signal: controle.signal
      });
      if (controle.signal.aborted) return;
      aplicarSugestao(data);
    } catch (error: unknown) {
      if (controle.signal.aborted || axios.isCancel(error)) return;
      setErroLeitura(mensagemLeitura(error));
    } finally {
      if (leituraAbort.current === controle) {
        leituraAbort.current = null;
        setLendo(false);
      }
    }
  };

  const aplicarSugestao = (s: SugestaoBoleto) => {
    const marcados: CampoIa[] = [];
    const mantidos: string[] = [];
    const form = formAtual.current; // valor mais recente: o usuário pode ter digitado durante a leitura
    const proximo = { ...form };
    const tipo: TipoDado = s.tipo_sugerido ?? form.tipo;
    if (s.tipo_sugerido && s.tipo_sugerido !== form.tipo) {
      proximo.tipo = s.tipo_sugerido;
      marcados.push('tipo');
    }
    if (tipo === 'Sem Boleto') proximo.dt_vencimento = '';
    const preencher = (campo: CampoTexto, novo: string | null, rotulo: string) => {
      if (novo == null || novo === '') return;
      if (form[campo].trim() !== '') {
        if (form[campo].trim() !== novo) mantidos.push(rotulo);
        return;
      }
      proximo[campo] = novo;
      marcados.push(campo);
    };
    preencher('descricao', s.fornecedor?.trim() || null, 'descrição');
    preencher('valor', s.valor != null ? String(s.valor).replace('.', ',') : null, 'valor');
    if (tipo === 'Boleto') preencher('dt_vencimento', s.dt_vencimento, 'vencimento');
    preencher('dt_recebimento', s.dt_documento, 'data de recebimento');
    if (tipo === 'Sem Boleto' && !proximo.dt_recebimento) proximo.dt_recebimento = hojeIso();
    setForm(proximo);
    setCamposIa((atual) => [...atual.filter((c) => !marcados.includes(c)), ...marcados]);
    setLinhaDigitavel(s.linha_digitavel?.trim() || null);
    setLinhaCopiada(false);
    const vazio = marcados.length === 0 && !s.linha_digitavel;
    setAvisoLeitura(
      vazio
        ? 'Não foi possível identificar dados nesta imagem. Preencha manualmente.'
        : mantidos.length > 0
          ? `Mantidos os valores que você já digitou: ${mantidos.join(', ')}.`
          : null
    );
  };

  const copiarLinha = async () => {
    if (!linhaDigitavel) return;
    try {
      await navigator.clipboard.writeText(linhaDigitavel);
      setLinhaCopiada(true);
    } catch {
      setLinhaCopiada(false);
      setAvisoLeitura('Não foi possível copiar. Selecione o texto e copie manualmente.');
    }
  };

  const selo = (campo: CampoIa) =>
    camposIa.includes(campo) ? (
      <span className="boletos-ia-selo" data-testid={`ia-selo-${campo}`}>
        Sugerido pela IA
      </span>
    ) : null;
  const classeIa = (campo: CampoIa) => (camposIa.includes(campo) ? 'boletos-campo--ia' : undefined);

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
      const pedidos: Promise<unknown>[] = [
        axios.get<Boleto[]>(`${API_URL}/boletos`, { params }),
        axios.get<{ semanas: SemanaResumo[]; total_geral: number }>(`${API_URL}/boletos/resumo`, { params })
      ];
      if (!simples) {
        pedidos.push(axios.get<Meta[]>(`${API_URL}/boletos/metas`, { params }));
      }
      const [lista, resumo, listaMetas] = (await Promise.all(pedidos)) as [
        { data: Boleto[] },
        { data: { semanas: SemanaResumo[] } },
        { data: Meta[] } | undefined
      ];
      setBoletos(lista.data || []);
      setSemanas(resumo.data?.semanas || []);
      setMetas(listaMetas?.data || []);
    } catch (error) {
      onMessage?.(mensagemErro(error, 'Não foi possível carregar boletos e notas.'));
    } finally {
      setLoading(false);
    }
  }, [onMessage, restauranteId, simples]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    setFiltroTabela('ALL');
    setFiltroSemana('');
  }, [restauranteId]);

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
    setCamposIa((atual) => atual.filter((c) => c !== 'tipo'));
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
      limparIa();
      await carregar();
    } catch (error) {
      onMessage?.(mensagemErro(error, 'Não foi possível salvar o lançamento.'));
    } finally {
      setSalvando(false);
    }
  };

  const editar = (item: Boleto) => {
    cancelarLeitura();
    limparIa();
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
        limparIa();
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
      {!editandoId && (
        <div className="boletos-ia" data-testid="ia-painel">
          <div className="boletos-ia-botoes">
            <label
              className={lendo ? 'boletos-ia-btn boletos-ia-btn--off' : 'boletos-ia-btn'}
              data-testid="ia-ler-foto"
            >
              Ler boleto por foto
              <input
                type="file"
                className="boletos-ia-input"
                accept={TIPOS_IMAGEM_ACEITOS.join(',')}
                capture="environment"
                disabled={lendo}
                onChange={lerPorFoto}
                data-testid="ia-input-camera"
              />
            </label>
            <label
              className={lendo ? 'boletos-ia-link boletos-ia-link--off' : 'boletos-ia-link'}
              data-testid="ia-escolher-arquivo"
            >
              Escolher arquivo
              <input
                type="file"
                className="boletos-ia-input"
                accept={TIPOS_IMAGEM_ACEITOS.join(',')}
                disabled={lendo}
                onChange={lerPorFoto}
                data-testid="ia-input-arquivo"
              />
            </label>
          </div>
          {fotoUrl && (
            <div className="boletos-ia-foto">
              <button
                ref={botaoVerImagem}
                type="button"
                className="boletos-btn-ghost boletos-ia-ver"
                onClick={() => setPreviewAberto(true)}
                aria-haspopup="dialog"
                data-testid="ia-ver-imagem"
              >
                Ver imagem
              </button>
              <span className="boletos-ia-foto-nota">Só nesta tela; a imagem não é enviada para guardar.</span>
            </div>
          )}
          {fotoUrl && previewAberto && <PreviewImagem url={fotoUrl} onFechar={fecharPreview} />}
          <div aria-live="polite" role="status" data-testid="ia-status">
            {lendo && (
              <div className="boletos-ia-lendo">
                <span className="boletos-ia-spinner" aria-hidden="true" />
                <span>Lendo o documento… isso leva alguns segundos</span>
                <button
                  type="button"
                  className="boletos-btn-ghost boletos-ia-cancelar"
                  onClick={() => {
                    cancelarLeitura();
                    descartarFoto();
                  }}
                  data-testid="ia-cancelar"
                >
                  Cancelar
                </button>
              </div>
            )}
            {!lendo && avisoLeitura && (
              <p className="boletos-ia-aviso" data-testid="ia-aviso">
                {avisoLeitura}
              </p>
            )}
          </div>
          {erroLeitura && (
            <p className="boletos-ia-erro" role="alert" data-testid="ia-erro">
              {erroLeitura}
            </p>
          )}
          {linhaDigitavel && (
            <div className="boletos-ia-linha" data-testid="ia-linha-digitavel">
              <span className="boletos-ia-linha-rotulo">Linha digitável lida (não é salva)</span>
              <div className="boletos-ia-linha-corpo">
                <input type="text" readOnly value={linhaDigitavel} aria-label="Linha digitável lida" />
                <button type="button" className="boletos-btn-ghost" onClick={() => void copiarLinha()}>
                  {linhaCopiada ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            </div>
          )}
          <p className="boletos-ia-confira" data-testid="ia-confira">
            Confira os dados antes de salvar
          </p>
        </div>
      )}
      <form
        ref={formRef}
        className="boletos-form boletos-form--lancamento"
        onSubmit={salvarLancamento}
        onFocus={guardarCampo}
      >
        <label>
          Tipo de dado <span className="boletos-req">*</span>
          {selo('tipo')}
          <select
            data-boleto-campo="tipo"
            className={classeIa('tipo')}
            value={form.tipo}
            onChange={(e) => mudarTipo(e.target.value as TipoDado)}
          >
            <option value="Boleto">Boleto</option>
            <option value="Sem Boleto">Sem Boleto</option>
          </select>
        </label>
        <label>
          Dt. recebimento <span className="boletos-req">*</span>
          {selo('dt_recebimento')}
          <input
            data-boleto-campo="recebimento"
            className={classeIa('dt_recebimento')}
            type="date"
            value={form.dt_recebimento}
            onChange={(e) => alterar('dt_recebimento', e.target.value)}
            required
          />
        </label>
        {form.tipo === 'Boleto' ? (
          <label>
            Dt. vencimento <span className="boletos-req">*</span>
            {selo('dt_vencimento')}
            <input
              data-boleto-campo="vencimento"
              className={classeIa('dt_vencimento')}
              type="date"
              value={form.dt_vencimento}
              onChange={(e) => alterar('dt_vencimento', e.target.value)}
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
          {selo('descricao')}
          <input
            data-boleto-campo="descricao"
            className={classeIa('descricao')}
            type="text"
            value={form.descricao}
            placeholder="Ex: Fornecedor de Hortifruti"
            onChange={(e) => alterar('descricao', e.target.value)}
            required
          />
        </label>
        <label>
          Valor (R$) <span className="boletos-req">*</span>
          {selo('valor')}
          <input
            data-boleto-campo="valor"
            className={classeIa('valor')}
            type="text"
            inputMode="decimal"
            value={form.valor}
            onChange={(e) => alterar('valor', e.target.value)}
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
              limparIa();
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
          <div className="boletos-abas" role="tablist">
            <button type="button" className={aba === 'resumo' ? 'active' : ''} onClick={() => setAba('resumo')}>
              Totais da semana
            </button>
            <button type="button" className={aba === 'cadastro' ? 'active' : ''} onClick={() => setAba('cadastro')}>
              Cadastro
            </button>
            {!simples && (
              <button type="button" className={aba === 'metas' ? 'active' : ''} onClick={() => setAba('metas')}>
                Meta de gasto
              </button>
            )}
          </div>
      </header>

      {loading ? (
        <p className="boletos-empty">Carregando…</p>
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
              <span>{simples ? 'Somente consulta da meta.' : 'Clique em Editar meta para alterar o teto da semana.'}</span>
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
                            {!simples && (
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
                            )}
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
              {!simples && (
                <>
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
                </>
              )}
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
