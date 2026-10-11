import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import type { EstoqueAgrupadoResponse, ResumoMovimentosResponse } from './estoque/estoqueTypes';
import './AdminDashboard.css';

interface GastoRow {
  id?: number;
  valor?: string | number | null;
  pago?: boolean;
  data?: string;
}

interface Props {
  restauranteId: number | null;
  restauranteNome?: string;
  gastos: GastoRow[];
  onIrParaGastos: () => void;
  onIrParaRelatorios: () => void;
  onIrParaEstoque: (view?: 'resumo' | 'diario' | 'visao' | 'categorias' | 'produtos' | 'movimentacao') => void;
  onIrParaMovimentacaoHoje?: () => void;
  onIrParaBoletos?: () => void;
  onIrParaRestaurantes: () => void;
  onIrParaUsuariosEstoque?: () => void;
}

function parseValor(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
}

function inicioFimMesAtual(): { ini: string; fim: string } {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ini = `${y}-${pad(m + 1)}-01`;
  const ultimo = new Date(y, m + 1, 0).getDate();
  const fim = `${y}-${pad(m + 1)}-${pad(ultimo)}`;
  return { ini, fim };
}

const AdminDashboard: React.FC<Props> = ({
  restauranteId,
  restauranteNome,
  gastos,
  onIrParaGastos,
  onIrParaRelatorios,
  onIrParaEstoque,
  onIrParaMovimentacaoHoje,
  onIrParaBoletos,
  onIrParaRestaurantes,
  onIrParaUsuariosEstoque
}) => {
  const [loadingEstoque, setLoadingEstoque] = useState(true);
  const [numCategorias, setNumCategorias] = useState(0);
  const [numProdutos, setNumProdutos] = useState(0);
  const [loadingMovHoje, setLoadingMovHoje] = useState(true);
  const [entradasHoje, setEntradasHoje] = useState(0);
  const [saidasHoje, setSaidasHoje] = useState(0);

  const dataHojeIso = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);

  const carregarResumoEstoque = useCallback(async () => {
    if (!restauranteId) {
      setNumCategorias(0);
      setNumProdutos(0);
      setLoadingEstoque(false);
      return;
    }
    setLoadingEstoque(true);
    try {
      const { data } = await axios.get<EstoqueAgrupadoResponse>(
        `${API_URL}/estoque/agrupado?restaurante_id=${restauranteId}`
      );
      const cats = data.categorias || [];
      setNumCategorias(cats.length);
      let prod = 0;
      cats.forEach((c) => {
        prod += c.produtos?.length || 0;
      });
      setNumProdutos(prod);
    } catch {
      setNumCategorias(0);
      setNumProdutos(0);
    } finally {
      setLoadingEstoque(false);
    }
  }, [restauranteId]);

  useEffect(() => {
    carregarResumoEstoque();
  }, [carregarResumoEstoque]);

  const carregarMovimentosHoje = useCallback(async () => {
    if (!restauranteId) {
      setEntradasHoje(0);
      setSaidasHoje(0);
      setLoadingMovHoje(false);
      return;
    }
    setLoadingMovHoje(true);
    try {
      const { data } = await axios.get<ResumoMovimentosResponse>(`${API_URL}/estoque/movimentos/resumo`, {
        params: {
          restaurante_id: restauranteId,
          data_inicio: dataHojeIso,
          data_fim: dataHojeIso
        }
      });
      const entradas = Number(data?.totais?.entradas || 0);
      const saidasTotais = Number(data?.totais?.saidas || 0);
      const saidasDoDia = Array.isArray(data?.saidas_por_dia) ? data.saidas_por_dia[0]?.saidas : undefined;
      setEntradasHoje(entradas);
      setSaidasHoje(Number(saidasDoDia ?? saidasTotais ?? 0));
    } catch {
      setEntradasHoje(0);
      setSaidasHoje(0);
    } finally {
      setLoadingMovHoje(false);
    }
  }, [restauranteId, dataHojeIso]);

  useEffect(() => {
    carregarMovimentosHoje();
  }, [carregarMovimentosHoje]);

  const { ini, fim } = useMemo(() => inicioFimMesAtual(), []);

  const resumoGastosMes = useMemo(() => {
    let total = 0;
    let pendente = 0;
    let count = 0;
    gastos.forEach((g) => {
      const d = g.data || '';
      if (d >= ini && d <= fim) {
        count += 1;
        const val = parseValor(g.valor);
        total += val;
        if (!g.pago) pendente += val;
      }
    });
    return { total, pendente, count };
  }, [gastos, ini, fim]);

  if (!restauranteId) {
    return (
      <div className="admin-dashboard admin-dashboard--empty">
        <p>Selecione um restaurante no topo.</p>
        <button type="button" className="admin-dashboard-btn admin-dashboard-btn--primary" onClick={onIrParaRestaurantes}>
          Restaurantes
        </button>
      </div>
    );
  }

  return (
    <div className="admin-dashboard admin-dashboard--compact">
      <header className="admin-dashboard-header admin-dashboard-header--compact">
        <h1 className="admin-dashboard-title">Início</h1>
        {restauranteNome && <p className="admin-dashboard-sub">{restauranteNome}</p>}
      </header>

      <section className="admin-dashboard-strip" aria-label="Resumo do mês">
        <p className="admin-dashboard-strip-line">
          <strong>Gastos (mês):</strong>{' '}
          {resumoGastosMes.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} total ·{' '}
          {resumoGastosMes.pendente.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} a pagar ·{' '}
          {resumoGastosMes.count} lanç.
        </p>
        <p className="admin-dashboard-strip-line">
          <strong>Estoque:</strong>{' '}
          {loadingEstoque ? '…' : `${numCategorias} categorias · ${numProdutos} produtos`}
        </p>
        <button
          type="button"
          className="admin-dashboard-strip-line admin-dashboard-strip-link"
          onClick={onIrParaMovimentacaoHoje}
          disabled={loadingMovHoje || !onIrParaMovimentacaoHoje}
          title="Abrir movimentação filtrada no dia de hoje"
        >
          <strong>Movimento hoje:</strong>{' '}
          {loadingMovHoje ? '…' : `${entradasHoje} entradas · ${saidasHoje} saídas`}
        </button>
      </section>

      <nav className="admin-dashboard-actions-compact" aria-label="Ações rápidas">
        <button type="button" className="admin-dashboard-btn" onClick={onIrParaGastos}>
          Gastos
        </button>
        {onIrParaBoletos && (
          <button type="button" className="admin-dashboard-btn admin-dashboard-btn--ghost" onClick={onIrParaBoletos}>
            Boletos e notas
          </button>
        )}
        <button type="button" className="admin-dashboard-btn admin-dashboard-btn--ghost" onClick={onIrParaRelatorios}>
          Relatórios
        </button>
        <button type="button" className="admin-dashboard-btn admin-dashboard-btn--ghost" onClick={() => onIrParaEstoque('resumo')}>
          Visão geral estoque
        </button>
        <button type="button" className="admin-dashboard-btn admin-dashboard-btn--ghost" onClick={() => onIrParaEstoque('visao')}>
          Entrada e saída
        </button>
        <button type="button" className="admin-dashboard-btn admin-dashboard-btn--ghost" onClick={() => onIrParaEstoque('movimentacao')}>
          Movimentação
        </button>
        <button type="button" className="admin-dashboard-btn admin-dashboard-btn--ghost" onClick={() => onIrParaEstoque('categorias')}>
          Categorias
        </button>
        <button type="button" className="admin-dashboard-btn admin-dashboard-btn--ghost" onClick={() => onIrParaEstoque('produtos')}>
          Produtos
        </button>
        <button type="button" className="admin-dashboard-btn admin-dashboard-btn--ghost" onClick={onIrParaRestaurantes}>
          Restaurantes
        </button>
        {onIrParaUsuariosEstoque && (
          <button type="button" className="admin-dashboard-btn admin-dashboard-btn--ghost" onClick={onIrParaUsuariosEstoque}>
            Usuários e permissões
          </button>
        )}
      </nav>
    </div>
  );
};

export default AdminDashboard;
