import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { mensagemErro } from '../lib/erros';
import { formatarLinhaDigitavel } from '../lib/linhaDigitavel';
import type { OcorrenciaBoleto } from '../types';
import './AdminPermissoesUsuarios.css';

function formatarQuando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** Admin: tentativas de cadastrar linha digitável já existente, ainda não vistas. */
const AdminOcorrenciasBoletos: React.FC = () => {
  const [lista, setLista] = useState<OcorrenciaBoleto[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [marcandoId, setMarcandoId] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const { data } = await axios.get<OcorrenciaBoleto[]>(`${API_URL}/admin/boletos-ocorrencias`);
      setLista(data || []);
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível carregar as ocorrências.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const marcarVista = async (id: number) => {
    setMarcandoId(id);
    setErro(null);
    try {
      await axios.post(`${API_URL}/admin/boletos-ocorrencias/${id}/visto`);
      setLista((atual) => atual.filter((o) => o.id !== id));
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível marcar como vista.'));
    } finally {
      setMarcandoId(null);
    }
  };

  return (
    <div className="admin-perm">
      <h1 className="admin-perm-title">Ocorrências de boletos</h1>
      <p className="admin-perm-hint">
        Tentativas de cadastrar uma linha digitável que já existia. Confira e marque como vista.
      </p>

      {erro && (
        <div className="admin-perm-banner admin-perm-banner--err" role="alert">
          {erro}{' '}
          <button type="button" className="admin-perm-retry" onClick={() => void carregar()}>
            Tentar de novo
          </button>
        </div>
      )}

      {loading ? (
        <p className="admin-perm-empty">Carregando…</p>
      ) : lista.length === 0 && !erro ? (
        <p className="admin-perm-empty">Nenhuma ocorrência pendente.</p>
      ) : (
        <ul className="admin-perm-ocorrencias">
          {lista.map((o) => (
            <li key={o.id} className="admin-perm-ocorrencia">
              <div className="admin-perm-ocorrencia-info">
                <strong>{o.usuario_nome || o.usuario_username || 'Usuário removido'}</strong>
                <span>Restaurante: {o.restaurante_nome || '—'}</span>
                <span>Quando: {formatarQuando(o.created_at)}</span>
                {o.linha_digitavel && (
                  <span className="admin-perm-ocorrencia-linha">{formatarLinhaDigitavel(o.linha_digitavel)}</span>
                )}
                {(o.boleto_existente_restaurante_nome || o.boleto_existente_fornecedor) && (
                  <span>
                    Já cadastrada em: {o.boleto_existente_restaurante_nome || '—'}
                    {o.boleto_existente_fornecedor ? ` (${o.boleto_existente_fornecedor})` : ''}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="admin-perm-criar admin-perm-visto"
                disabled={marcandoId === o.id}
                onClick={() => void marcarVista(o.id)}
              >
                {marcandoId === o.id ? 'Salvando…' : 'Marcar como vista'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AdminOcorrenciasBoletos;
