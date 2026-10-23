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
import { mensagemErro } from '../../lib/erros';
import { comprimirImagem } from '../../lib/imagem';
import { formatarLinhaDigitavel, somenteDigitos } from '../../lib/linhaDigitavel';
import type {
  Boleto,
  CampoLido,
  ConflitoBoleto,
  ErroLimiteLeitura,
  ExtracaoResposta,
  Meta,
  SemanaResumo,
  TipoDado
} from '../../types';
import AnexoImagem from './AnexoImagem';
import CopiarLinha from './CopiarLinha';
import './BoletosModulo.css';

/** Campo de formulário que a IA pode deixar de ler (os da API, mais o tipo). */
type CampoDestaque = CampoLido | 'tipo';

type Aba = 'resumo' | 'cadastro' | 'metas';
interface Props {
  restauranteId: number;
  restauranteNome?: string;
  simples?: boolean;
  /** Mostra "Marcar como pago" (permissão vem de lib/userPermissoes; o back valida). */
  podeMarcarPago?: boolean;
  /** Mostra "Desfazer pagamento" (só admin; o back valida). */
  podeDesfazerPago?: boolean;
  onMessage?: (msg: string | null) => void;
}

const VAZIO = {
  dt_recebimento: '',
  dt_vencimento: '',
  descricao: '',
  valor: '',
  tipo: 'Boleto' as TipoDado,
  fornecedor: '',
  linha_digitavel: ''
};

interface ImagemPendente {
  blob: Blob;
  hash: string;
}

interface AnexoFalha extends ImagemPendente {
  boletoId: number;
  mensagem: string;
  /** 409 (já tem imagem): reenviar não adianta. */
  semRetentativa: boolean;
}

const MEDIA_CELULAR ='(max-width: 720px)';

/** true em tela de celular (cartões em vez de tabela). Sem matchMedia (testes) => desktop. */
function useTelaCelular(): boolean {
  const consulta = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(MEDIA_CELULAR).matches
      : false;
  const [celular, setCelular] = useState<boolean>(consulta);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(MEDIA_CELULAR);
    const aoMudar = () => setCelular(mq.matches);
    aoMudar();
    mq.addEventListener('change', aoMudar);
    return () => mq.removeEventListener('change', aoMudar);
  }, []);
  return celular;
}

function conflitoDe(error: unknown): ConflitoBoleto | null {
  if (axios.isAxiosError<ConflitoBoleto>(error) && error.response?.status === 409) {
    return error.response.data || null;
  }
  return null;
}

function formatarPagoEm(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
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

const BoletosModulo: React.FC<Props> = ({
  restauranteId,
  restauranteNome,
  simples = false,
  podeMarcarPago = false,
  podeDesfazerPago = false,
  onMessage
}) => {
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
  const celular = useTelaCelular();
  // Leitura por imagem
  const [lendo, setLendo] = useState(false);
  const [erroIa, setErroIa] = useState<string | null>(null);
  const [avisosIa, setAvisosIa] = useState<string[]>([]);
  const [naoLidos, setNaoLidos] = useState<CampoDestaque[]>([]);
  const [previaUrl, setPreviaUrl] = useState<string | null>(null);
  const [lidoPorIa, setLidoPorIa] = useState(false);
  const [repetida, setRepetida] = useState<Boleto | true | null>(null);
  /** Teto diário atingido: a leitura por IA fica desabilitada até recarregar (nada é persistido). */
  const [limiteDiario, setLimiteDiario] = useState(false);
  const arquivoPendente = useRef<Blob | null>(null);
  /** Imagem comprimida (os mesmos bytes enviados à extração) + hash, até o cadastro ser confirmado. */
  const imagemLida = useRef<ImagemPendente | null>(null);
  /** Boleto já criado cuja imagem não subiu: mantém o Blob em memória para reenviar. */
  const [anexoFalha, setAnexoFalha] = useState<AnexoFalha | null>(null);
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  // Parecidos / pagamento
  const [similares, setSimilares] = useState<Boleto[] | null>(null);
  const [pagandoId, setPagandoId] = useState<number | null>(null);
  const [desfazendo, setDesfazendo] = useState<Boleto | null>(null);
  const [motivo, setMotivo] = useState('');
  const [erroMotivo, setErroMotivo] = useState<string | null>(null);
  const [anexoEdicao, setAnexoEdicao] = useState<number | null>(null);
  const inputCamera = useRef<HTMLInputElement>(null);
  const inputGaleria = useRef<HTMLInputElement>(null);
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

  const limparLeitura = () => {
    setErroIa(null);
    setAvisosIa([]);
    setNaoLidos([]);
    setLidoPorIa(false);
    setRepetida(null);
    setPreviaUrl((atual) => {
      if (atual) URL.revokeObjectURL(atual);
      return null;
    });
    arquivoPendente.current = null;
    imagemLida.current = null;
  };

  /** Grava a imagem após o 201 do cadastro. Em falha o boleto já existe: guarda o Blob para reenviar. */
  const enviarAnexo = async (boletoId: number, imagem: ImagemPendente): Promise<boolean> => {
    setEnviandoAnexo(true);
    try {
      const corpo = new FormData();
      corpo.append('imagem', imagem.blob, 'boleto.jpg');
      corpo.append('hash_sha256', imagem.hash);
      await axios.post(`${API_URL}/boletos/${boletoId}/anexo`, corpo);
      setAnexoFalha(null);
      return true;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      setAnexoFalha({
        ...imagem,
        boletoId,
        semRetentativa: status === 409,
        mensagem: mensagemErro(error, 'Não foi possível enviar a imagem.')
      });
      return false;
    } finally {
      setEnviandoAnexo(false);
    }
  };

  const reenviarAnexo = async () => {
    if (!anexoFalha) return;
    const { boletoId, blob, hash } = anexoFalha;
    if (await enviarAnexo(boletoId, { blob, hash })) await carregar();
  };

  useEffect(
    () => () => {
      if (previaUrl) URL.revokeObjectURL(previaUrl);
    },
    [previaUrl]
  );

  const limparFormulario = () => {
    setForm(VAZIO);
    setEditandoId(null);
    setAnexoEdicao(null);
    limparLeitura();
  };

  const editarCampo = (campo: CampoDestaque, patch: Partial<typeof VAZIO>) => {
    setForm((atual) => ({ ...atual, ...patch }));
    setNaoLidos((atual) => (atual.includes(campo) ? atual.filter((c) => c !== campo) : atual));
  };

  const enviarLancamento = async (confirmarSimilar: boolean) => {
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
      tipo: form.tipo,
      fornecedor: form.fornecedor.trim() || null,
      linha_digitavel: form.linha_digitavel || null,
      ...(confirmarSimilar ? { confirmar_similar: true } : {})
    };
    const imagem = editandoId ? null : imagemLida.current;
    try {
      let novoId: number | null = null;
      if (editandoId) {
        await axios.put(`${API_URL}/boletos/${editandoId}`, payload);
      } else {
        const { data: criado } = await axios.post<Boleto>(`${API_URL}/boletos`, payload);
        novoId = typeof criado?.id === 'number' ? criado.id : null;
      }
      setSimilares(null);
      limparFormulario();
      // A imagem só é gravada depois que o cadastro foi confirmado (201).
      if (imagem && novoId != null) await enviarAnexo(novoId, imagem);
      await carregar();
    } catch (error) {
      const conflito = conflitoDe(error);
      if (conflito?.codigo === 'BOLETO_SIMILAR') {
        setSimilares(conflito.boletos || []);
      } else {
        setSimilares(null);
        onMessage?.(mensagemErro(error, 'Não foi possível salvar o lançamento.'));
      }
    } finally {
      setSalvando(false);
    }
  };

  const salvarLancamento = (event: React.FormEvent) => {
    event.preventDefault();
    void enviarLancamento(false);
  };

  const editar = (item: Boleto) => {
    setAba('cadastro');
    limparLeitura();
    setEditandoId(item.id);
    setAnexoEdicao(item.tem_anexo ? item.id : null);
    setForm({
      dt_recebimento: item.dt_recebimento || '',
      dt_vencimento: item.tipo === 'Boleto' ? item.dt_vencimento || '' : '',
      descricao: item.descricao,
      valor: String(item.valor).replace('.', ','),
      tipo: item.tipo,
      fornecedor: item.fornecedor || '',
      linha_digitavel: item.linha_digitavel || ''
    });
    window.setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
  };

  // ----- Leitura por imagem (só celular) -----

  const lerImagem = async (arquivo: Blob, forcar: boolean) => {
    setLendo(true);
    setErroIa(null);
    setRepetida(null);
    arquivoPendente.current = arquivo;
    onMessage?.(null);
    try {
      const corpo = new FormData();
      corpo.append('imagem', arquivo, 'boleto.jpg');
      corpo.append('restaurante_id', String(restauranteId));
      if (forcar) corpo.append('forcar_repetida', 'true');
      const { data } = await axios.post<ExtracaoResposta>(`${API_URL}/boletos/extrair`, corpo);
      if (data.aviso_imagem_repetida) {
        arquivoPendente.current = arquivo;
        setRepetida(data.aviso_imagem_repetida);
        return;
      }
      arquivoPendente.current = null;
      imagemLida.current = { blob: arquivo, hash: data.hash_sha256 };
      const tipo: TipoDado = data.tipo_sugerido ?? 'Boleto';
      setEditandoId(null);
      setAnexoEdicao(null);
      setForm({
        tipo,
        fornecedor: data.fornecedor ?? '',
        descricao: data.fornecedor ?? '',
        valor: data.valor == null ? '' : String(data.valor).replace('.', ','),
        dt_vencimento: tipo === 'Boleto' ? data.dt_vencimento ?? '' : '',
        dt_recebimento: data.dt_recebimento ?? '',
        linha_digitavel: data.linha_digitavel ? somenteDigitos(data.linha_digitavel) : ''
      });
      const destaque: CampoDestaque[] = [...data.campos_nao_lidos];
      if (data.tipo_sugerido == null) destaque.push('tipo');
      setNaoLidos(destaque);
      setAvisosIa(data.avisos || []);
      setLidoPorIa(true);
      setPreviaUrl((atual) => {
        if (atual) URL.revokeObjectURL(atual);
        return URL.createObjectURL(arquivo);
      });
      window.setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    } catch (error) {
      let msg = mensagemErro(error, 'Não foi possível ler a imagem. Tente de novo ou preencha manualmente.');
      if (axios.isAxiosError<ErroLimiteLeitura>(error) && error.response?.status === 429) {
        if (error.response.data?.codigo === 'LIMITE_DIARIO') {
          // Sem "tentar de novo": só amanhã. O cadastro manual segue disponível.
          arquivoPendente.current = null;
          setLimiteDiario(true);
          setErroIa(`${msg}. Preencha o cadastro manualmente.`);
          return;
        }
        const espera = Number(error.response.headers?.['retry-after']);
        if (Number.isFinite(espera) && espera > 0) msg = `${msg} Tente novamente em ${espera} s.`;
      }
      setErroIa(msg);
    } finally {
      setLendo(false);
    }
  };

  const aoEscolherImagem = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const arquivo = event.target.files?.[0];
    event.target.value = '';
    if (!arquivo) return;
    limparLeitura();
    setLendo(true);
    try {
      const comprimida = await comprimirImagem(arquivo);
      await lerImagem(comprimida, false);
    } catch (error) {
      setErroIa(error instanceof Error ? error.message : 'Não foi possível preparar a imagem.');
      setLendo(false);
    }
  };

  // ----- Pagamento -----

  const marcarPago = async (item: Boleto) => {
    setPagandoId(item.id);
    onMessage?.(null);
    try {
      await axios.post(`${API_URL}/boletos/${item.id}/pago`);
      await carregar();
    } catch (error) {
      onMessage?.(mensagemErro(error, 'Não foi possível marcar como pago.'));
    } finally {
      setPagandoId(null);
    }
  };

  const confirmarDesfazer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!desfazendo) return;
    const texto = motivo.trim();
    if (texto.length < 5 || texto.length > 500) {
      setErroMotivo('Informe o motivo com 5 a 500 caracteres.');
      return;
    }
    setPagandoId(desfazendo.id);
    setErroMotivo(null);
    try {
      await axios.delete(`${API_URL}/boletos/${desfazendo.id}/pago`, { data: { motivo: texto } });
      setDesfazendo(null);
      setMotivo('');
      await carregar();
    } catch (error) {
      setErroMotivo(mensagemErro(error, 'Não foi possível desfazer o pagamento.'));
    } finally {
      setPagandoId(null);
    }
  };

  const excluir = async (id: number) => {
    if (!window.confirm('Remover este lançamento?')) return;
    onMessage?.(null);
    try {
      await axios.delete(`${API_URL}/boletos/${id}`);
      if (editandoId === id) limparFormulario();
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

  const destacado = (campo: CampoDestaque) => naoLidos.includes(campo);
  const classeCampo = (campo: CampoDestaque) => (destacado(campo) ? 'boletos-campo--nao-lido' : undefined);
  const avisoNaoLido = (campo: CampoDestaque) =>
    destacado(campo) ? <span className="boletos-nao-lido">⚠ Não lido: confira ou preencha</span> : null;

  const painelLeitura = !editandoId && (
    <div className="boletos-ia">
      <div className="boletos-ia-touch">
        <button
          type="button"
          className="boletos-ia-btn"
          disabled={lendo || salvando || limiteDiario}
          onClick={() => inputCamera.current?.click()}
          data-boleto-ia="camera"
        >
          <span aria-hidden="true">📷 </span>Ler com IA (fotografar)
        </button>
        <button
          type="button"
          className="boletos-btn-ghost boletos-btn-grande"
          disabled={lendo || salvando || limiteDiario}
          onClick={() => inputGaleria.current?.click()}
          data-boleto-ia="galeria"
        >
          Escolher da galeria
        </button>
        <input
          ref={inputCamera}
          type="file"
          accept="image/*"
          capture="environment"
          className="boletos-sr-only"
          tabIndex={-1}
          aria-label="Fotografar boleto"
          onChange={(e) => void aoEscolherImagem(e)}
        />
        <input
          ref={inputGaleria}
          type="file"
          accept="image/*"
          className="boletos-sr-only"
          tabIndex={-1}
          aria-label="Escolher imagem do boleto"
          onChange={(e) => void aoEscolherImagem(e)}
        />
      </div>
      <p className="boletos-ia-desktop">A leitura do boleto por foto está disponível no celular.</p>

      {lendo && (
        <p className="boletos-ia-status" role="status">
          Lendo a imagem… isso pode levar alguns segundos.
        </p>
      )}
      {erroIa && (
        <div className="boletos-ia-erro" role="alert">
          <p>{erroIa}</p>
          {arquivoPendente.current && !limiteDiario && (
            <button
              type="button"
              className="boletos-btn-ghost boletos-btn-grande"
              disabled={lendo}
              onClick={() => arquivoPendente.current && void lerImagem(arquivoPendente.current, false)}
            >
              Tentar de novo
            </button>
          )}
        </div>
      )}
      {repetida && (
        <div className="boletos-ia-erro" role="alert">
          <p>
            Esta imagem já foi cadastrada neste restaurante
            {repetida !== true && repetida.fornecedor ? ` (${repetida.fornecedor}` : ''}
            {repetida !== true && repetida.fornecedor ? `, ${formatarMoeda(Number(repetida.valor))})` : ''}.
          </p>
          <div className="boletos-ia-erro-acoes">
            <button
              type="button"
              className="boletos-btn-ghost boletos-btn-grande"
              onClick={() => arquivoPendente.current && void lerImagem(arquivoPendente.current, true)}
            >
              Ler mesmo assim
            </button>
            <button type="button" className="boletos-btn-ghost boletos-btn-grande" onClick={limparLeitura}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {lidoPorIa && (
        <div className="boletos-ia-resultado">
          <p className="boletos-ia-aviso" role="status">
            Dados lidos por IA. Confira cada campo antes de salvar: nada é salvo automaticamente.
          </p>
          {avisosIa.length > 0 && (
            <ul className="boletos-ia-avisos">
              {avisosIa.map((aviso) => (
                <li key={aviso}>⚠ {aviso}</li>
              ))}
            </ul>
          )}
          {previaUrl && <img src={previaUrl} alt="Pré-visualização da imagem enviada" className="boletos-previa" />}
        </div>
      )}
    </div>
  );

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
      {painelLeitura}
      {anexoFalha && (
        <div className="boletos-ia-erro" role="alert" data-boleto-anexo-falha={anexoFalha.boletoId}>
          <p>
            O lançamento foi salvo, mas a imagem não foi anexada: {anexoFalha.mensagem}
            {anexoFalha.semRetentativa ? '' : ' Você pode tentar enviar a imagem de novo.'}
          </p>
          <div className="boletos-ia-erro-acoes">
            {!anexoFalha.semRetentativa && (
              <button
                type="button"
                className="boletos-btn-ghost boletos-btn-grande"
                disabled={enviandoAnexo}
                onClick={() => void reenviarAnexo()}
              >
                {enviandoAnexo ? 'Enviando…' : 'Enviar imagem novamente'}
              </button>
            )}
            <button
              type="button"
              className="boletos-btn-ghost boletos-btn-grande"
              disabled={enviandoAnexo}
              onClick={() => setAnexoFalha(null)}
            >
              {anexoFalha.semRetentativa ? 'Fechar' : 'Descartar imagem'}
            </button>
          </div>
        </div>
      )}
      {anexoEdicao != null && (
        <div className="boletos-anexo-linha">
          <AnexoImagem boletoId={anexoEdicao} />
        </div>
      )}
      <form
        ref={formRef}
        className="boletos-form boletos-form--lancamento"
        onSubmit={salvarLancamento}
        onFocus={guardarCampo}
      >
        <label className={classeCampo('tipo')}>
          Tipo de dado <span className="boletos-req">*</span>
          <select
            data-boleto-campo="tipo"
            value={form.tipo}
            onChange={(e) => {
              mudarTipo(e.target.value as TipoDado);
              setNaoLidos((atual) => atual.filter((c) => c !== 'tipo'));
            }}
          >
            <option value="Boleto">Boleto</option>
            <option value="Sem Boleto">Sem Boleto</option>
          </select>
          {destacado('tipo') && <span className="boletos-nao-lido">⚠ Imagem não identificada como boleto: escolha o tipo</span>}
        </label>
        <label className={classeCampo('dt_recebimento')}>
          Dt. recebimento <span className="boletos-req">*</span>
          <input
            data-boleto-campo="recebimento"
            type="date"
            value={form.dt_recebimento}
            onChange={(e) => editarCampo('dt_recebimento', { dt_recebimento: e.target.value })}
            required
          />
          {avisoNaoLido('dt_recebimento')}
        </label>
        {form.tipo === 'Boleto' ? (
          <label className={classeCampo('dt_vencimento')}>
            Dt. vencimento <span className="boletos-req">*</span>
            <input
              data-boleto-campo="vencimento"
              type="date"
              value={form.dt_vencimento}
              onChange={(e) => editarCampo('dt_vencimento', { dt_vencimento: e.target.value })}
              required
            />
            {avisoNaoLido('dt_vencimento')}
          </label>
        ) : (
          <p className="boletos-avista">
            À vista: a data entra com hoje e pode ser alterada. O vencimento usado é essa data mais 7 dias.
          </p>
        )}
        <label className={classeCampo('fornecedor')}>
          Fornecedor
          <input
            data-boleto-campo="fornecedor"
            type="text"
            autoComplete="organization"
            value={form.fornecedor}
            placeholder="Ex: Hortifruti Sol"
            onChange={(e) => editarCampo('fornecedor', { fornecedor: e.target.value })}
          />
          {avisoNaoLido('fornecedor')}
        </label>
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
        <label className={classeCampo('valor')}>
          Valor (R$) <span className="boletos-req">*</span>
          <input
            data-boleto-campo="valor"
            type="text"
            inputMode="decimal"
            value={form.valor}
            onChange={(e) => editarCampo('valor', { valor: e.target.value })}
            placeholder="0,00"
            required
          />
          {avisoNaoLido('valor')}
        </label>
        {form.tipo === 'Boleto' && (
          <div className={`boletos-linha-bloco ${destacado('linha_digitavel') ? 'boletos-campo--nao-lido' : ''}`}>
            <label className="boletos-linha-label">
              Linha digitável
              <input
                data-boleto-campo="linha_digitavel"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={formatarLinhaDigitavel(form.linha_digitavel)}
                placeholder="Somente números"
                onChange={(e) =>
                  editarCampo('linha_digitavel', { linha_digitavel: somenteDigitos(e.target.value) })
                }
              />
              {avisoNaoLido('linha_digitavel')}
            </label>
            {form.linha_digitavel.length > 0 && <CopiarLinha linha={form.linha_digitavel} grande />}
          </div>
        )}
        <div className="boletos-form-rodape">
          <button type="submit" className="boletos-btn-adicionar" data-boleto-salvar disabled={salvando || lendo || enviandoAnexo}>
            {salvando ? 'Salvando…' : editandoId ? 'Atualizar' : 'Adicionar'}
          </button>
          {(editandoId || lidoPorIa) && (
            <button
              type="button"
              className="boletos-btn-ghost boletos-btn-cancelar"
              disabled={salvando}
              onClick={limparFormulario}
            >
              Cancelar
            </button>
          )}
        </div>
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

  const seloPago = (item: Boleto) =>
    item.pago ? (
      <span className="boletos-selo boletos-selo--pago">
        <span aria-hidden="true">✓ </span>Pago{item.pago_em ? ` em ${formatarPagoEm(item.pago_em)}` : ''}
      </span>
    ) : (
      <span className="boletos-selo boletos-selo--aberto">Em aberto</span>
    );

  // Boleto pago só o admin altera (podeDesfazerPago vem de perms.admin); o back valida.
  const bloqueadoPago = (item: Boleto) => item.pago && !podeDesfazerPago;

  const acoesItem = (item: Boleto) => (
    <>
      <button
        type="button"
        className="boletos-btn-edit"
        disabled={bloqueadoPago(item)}
        onClick={() => editar(item)}
      >
        Editar
      </button>
      {(!simples || lancamentoDentroDeUmDia(item.created_at)) && (
        <button
          type="button"
          className="boletos-btn-del"
          disabled={bloqueadoPago(item)}
          onClick={() => excluir(item.id)}
        >
          Excluir
        </button>
      )}
      {bloqueadoPago(item) && (
        <span className="boletos-hint boletos-pago-aviso">Pago: só o administrador altera</span>
      )}
      {podeMarcarPago && !item.pago && (
        <button
          type="button"
          className="boletos-btn-pagar"
          disabled={pagandoId === item.id}
          onClick={() => void marcarPago(item)}
        >
          {pagandoId === item.id ? 'Salvando…' : 'Marcar como pago'}
        </button>
      )}
      {podeDesfazerPago && item.pago && (
        <button
          type="button"
          className="boletos-btn-ghost"
          disabled={pagandoId === item.id}
          onClick={() => {
            setMotivo('');
            setErroMotivo(null);
            setDesfazendo(item);
          }}
        >
          Desfazer pagamento
        </button>
      )}
      {item.tem_anexo && <AnexoImagem boletoId={item.id} />}
      {item.linha_digitavel && <CopiarLinha linha={item.linha_digitavel} />}
    </>
  );

  const fornecedorExtra = (item: Boleto) =>
    item.fornecedor && item.fornecedor !== item.descricao ? (
      <small className="boletos-fornecedor">{item.fornecedor}</small>
    ) : null;

  const tabelaRegistros = (itens: Boleto[], vazio: string) =>
    itens.length === 0 ? (
      <p className="boletos-empty">{vazio}</p>
    ) : celular ? (
      <ul className="boletos-cartoes">
        {itens.map((item) => (
          <li key={item.id} className="boletos-cartao">
            <div className="boletos-cartao-topo">
              <span className="boletos-cartao-valor">{formatarMoeda(Number(item.valor))}</span>
              <span className={item.tipo === 'Sem Boleto' ? 'boletos-pill boletos-pill--vista' : 'boletos-pill'}>
                {item.tipo}
              </span>
            </div>
            <p className="boletos-cartao-desc">
              {item.descricao}
              {fornecedorExtra(item)}
            </p>
            <p className="boletos-cartao-meta">
              Recebimento: {formatarDataBr(item.dt_recebimento) || '—'} · Vencimento:{' '}
              {formatarDataBr(item.tipo === 'Sem Boleto' ? item.dt_vencimento_efetivo : item.dt_vencimento) || '—'}
            </p>
            <p className="boletos-cartao-meta">
              Semana:{' '}
              {item.semana_inicio
                ? `${formatarDataBr(item.semana_inicio)} a ${formatarDataBr(item.semana_fim)}`
                : '—'}
            </p>
            {item.linha_digitavel && (
              <p className="boletos-cartao-linha">{formatarLinhaDigitavel(item.linha_digitavel)}</p>
            )}
            <div className="boletos-cartao-situacao">{seloPago(item)}</div>
            <div className="boletos-actions boletos-cartao-acoes">{acoesItem(item)}</div>
          </li>
        ))}
      </ul>
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
              <th>Situação</th>
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
                <td className="boletos-desc">
                  {item.descricao}
                  {fornecedorExtra(item)}
                </td>
                <td className="boletos-valor">{formatarMoeda(Number(item.valor))}</td>
                <td>
                  <span className={item.tipo === 'Sem Boleto' ? 'boletos-pill boletos-pill--vista' : 'boletos-pill'}>
                    {item.tipo === 'Sem Boleto' ? 'Sem Boleto' : 'Boleto'}
                  </span>
                </td>
                <td>{seloPago(item)}</td>
                <td>
                  {item.semana_inicio
                    ? `${formatarDataBr(item.semana_inicio)} a ${formatarDataBr(item.semana_fim)}`
                    : '—'}
                </td>
                <td className="boletos-actions">{acoesItem(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  const modalSimilares = similares && (
    <div className="boletos-modal" role="dialog" aria-modal="true" aria-label="Lançamento parecido encontrado">
      <div className="boletos-modal-card">
        <h3>Já existe um lançamento parecido</h3>
        <p>Mesmo fornecedor e mesma data. Confira antes de cadastrar de novo:</p>
        <ul className="boletos-similares">
          {similares.map((b) => (
            <li key={b.id}>
              <strong>{b.fornecedor || b.descricao}</strong> · {formatarMoeda(Number(b.valor))}
              <br />
              <small>
                Recebimento {formatarDataBr(b.dt_recebimento) || '—'} · Vencimento{' '}
                {formatarDataBr(b.dt_vencimento_efetivo) || '—'}
                {b.pago ? ' · Pago' : ''}
              </small>
            </li>
          ))}
        </ul>
        <div className="boletos-modal-acoes">
          <button
            type="button"
            className="boletos-btn-ghost boletos-btn-grande"
            disabled={salvando}
            onClick={() => setSimilares(null)}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="boletos-btn-adicionar"
            disabled={salvando}
            onClick={() => void enviarLancamento(true)}
          >
            {salvando ? 'Salvando…' : 'Cadastrar mesmo assim'}
          </button>
        </div>
      </div>
    </div>
  );

  const modalDesfazer = desfazendo && (
    <div className="boletos-modal" role="dialog" aria-modal="true" aria-label="Desfazer pagamento">
      <form className="boletos-modal-card" onSubmit={(e) => void confirmarDesfazer(e)}>
        <h3>Desfazer pagamento</h3>
        <p>
          {desfazendo.fornecedor || desfazendo.descricao} · {formatarMoeda(Number(desfazendo.valor))}
        </p>
        <label className="boletos-motivo">
          Motivo (obrigatório, 5 a 500 caracteres)
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            maxLength={500}
            required
          />
        </label>
        {erroMotivo && (
          <p className="boletos-erro-inline" role="alert">
            {erroMotivo}
          </p>
        )}
        <div className="boletos-modal-acoes">
          <button
            type="button"
            className="boletos-btn-ghost boletos-btn-grande"
            disabled={pagandoId === desfazendo.id}
            onClick={() => setDesfazendo(null)}
          >
            Cancelar
          </button>
          <button type="submit" className="boletos-btn-adicionar" disabled={pagandoId === desfazendo.id}>
            {pagandoId === desfazendo.id ? 'Salvando…' : 'Desfazer pagamento'}
          </button>
        </div>
      </form>
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

      {modalSimilares}
      {modalDesfazer}
    </section>
  );
};

export default BoletosModulo;
