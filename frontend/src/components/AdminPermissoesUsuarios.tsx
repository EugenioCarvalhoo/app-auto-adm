import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import './AdminPermissoesUsuarios.css';

interface Restaurante {
  id: number;
  nome: string;
}

export interface UsuarioPermissaoRow {
  id: number;
  username: string;
  nome: string;
  is_admin: boolean;
  modulo_financeiro: boolean;
  modulo_estoque: boolean;
  modulo_estoque_simplificado: boolean;
  modulo_boletos: boolean;
  restaurante_ids: number[];
}

type ModuloKey = 'modulo_financeiro' | 'modulo_estoque' | 'modulo_estoque_simplificado' | 'modulo_boletos';

interface Props {
  onError?: (msg: string | null) => void;
}

const AdminPermissoesUsuarios: React.FC<Props> = ({ onError }) => {
  const [lista, setLista] = useState<UsuarioPermissaoRow[]>([]);
  const [restaurantes, setRestaurantes] = useState<Restaurante[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    onError?.(null);
    setBanner(null);
    try {
      const [uRes, rRes] = await Promise.all([
        axios.get<UsuarioPermissaoRow[]>(`${API_URL}/admin/usuarios-permissoes`),
        axios.get<Restaurante[]>(`${API_URL}/restaurantes`)
      ]);
      setLista(uRes.data || []);
      setRestaurantes(rRes.data || []);
    } catch (e) {
      console.error(e);
      const msg = 'Não foi possível carregar usuários e permissões.';
      setBanner({ type: 'err', text: msg });
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const atualizarLocal = (id: number, patch: Partial<UsuarioPermissaoRow>) => {
    setLista((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  };

  const salvarUsuario = async (usuario: UsuarioPermissaoRow) => {
    setSavingId(usuario.id);
    setBanner(null);
    try {
      const { data } = await axios.put<UsuarioPermissaoRow>(
        `${API_URL}/admin/usuarios-permissoes/${usuario.id}`,
        {
          modulo_financeiro: usuario.modulo_financeiro,
          modulo_estoque: usuario.modulo_estoque,
          modulo_estoque_simplificado: usuario.modulo_estoque_simplificado,
          modulo_boletos: usuario.modulo_boletos,
          restaurante_ids: usuario.restaurante_ids
        }
      );
      atualizarLocal(usuario.id, data);
      setBanner({ type: 'ok', text: `Permissões de ${usuario.username} atualizadas.` });
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } };
      const msg = ax.response?.data?.error || 'Erro ao salvar permissões.';
      setBanner({ type: 'err', text: msg });
      await carregar();
    } finally {
      setSavingId(null);
    }
  };

  const toggleModulo = async (usuario: UsuarioPermissaoRow, campo: ModuloKey) => {
    if (usuario.is_admin) return;
    const novo = { ...usuario, [campo]: !usuario[campo] };
    atualizarLocal(usuario.id, { [campo]: !usuario[campo] });
    await salvarUsuario(novo);
  };

  const toggleRestaurante = async (usuario: UsuarioPermissaoRow, restId: number) => {
    if (usuario.is_admin) return;
    const ids = usuario.restaurante_ids.includes(restId)
      ? usuario.restaurante_ids.filter((x) => x !== restId)
      : [...usuario.restaurante_ids, restId];
    const novo = { ...usuario, restaurante_ids: ids };
    atualizarLocal(usuario.id, { restaurante_ids: ids });
    await salvarUsuario(novo);
  };

  const precisaRestaurantes = (u: UsuarioPermissaoRow) =>
    !u.is_admin &&
    !u.modulo_financeiro &&
    (u.modulo_estoque || u.modulo_estoque_simplificado || u.modulo_boletos);

  return (
    <div className="admin-perm">
      <h1 className="admin-perm-title">Permissões de usuários</h1>
      <p className="admin-perm-hint">
        Marque os módulos que cada usuário pode acessar. Quem não tem o financeiro e usa estoque ou boletos
        precisa de restaurantes liberados na linha expandida abaixo.
      </p>

      {banner && (
        <div
          className={`admin-perm-banner admin-perm-banner--${banner.type === 'ok' ? 'ok' : 'err'}`}
          role="status"
        >
          {banner.text}
        </div>
      )}

      <div className="admin-perm-grid-wrap">
        {loading ? (
          <p className="admin-perm-empty">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="admin-perm-empty">Nenhum usuário cadastrado.</p>
        ) : (
          <table className="admin-perm-grid">
            <thead>
              <tr>
                <th>Usuário</th>
                <th className="admin-perm-th-check">Financeiro</th>
                <th className="admin-perm-th-check">Estoque</th>
                <th className="admin-perm-th-check">Estoque simplificado</th>
                <th className="admin-perm-th-check">Boletos e notas</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((u) => (
                <React.Fragment key={u.id}>
                  <tr className={u.is_admin ? 'admin-perm-row--admin' : ''}>
                    <td>
                      <div className="admin-perm-user-login">{u.username}</div>
                      <div className="admin-perm-user-nome">
                        {u.nome}
                        {u.is_admin ? ' · administrador' : ''}
                        {savingId === u.id ? ' · salvando…' : ''}
                      </div>
                    </td>
                    <td className="admin-perm-td-check">
                      <label className="admin-perm-check">
                        <input
                          type="checkbox"
                          checked={u.is_admin || u.modulo_financeiro}
                          disabled={u.is_admin || savingId === u.id}
                          onChange={() => toggleModulo(u, 'modulo_financeiro')}
                        />
                      </label>
                    </td>
                    <td className="admin-perm-td-check">
                      <label className="admin-perm-check">
                        <input
                          type="checkbox"
                          checked={u.is_admin || u.modulo_estoque}
                          disabled={u.is_admin || savingId === u.id}
                          onChange={() => toggleModulo(u, 'modulo_estoque')}
                        />
                      </label>
                    </td>
                    <td className="admin-perm-td-check">
                      <label className="admin-perm-check">
                        <input
                          type="checkbox"
                          checked={u.is_admin || u.modulo_estoque_simplificado}
                          disabled={u.is_admin || savingId === u.id}
                          onChange={() => toggleModulo(u, 'modulo_estoque_simplificado')}
                        />
                      </label>
                    </td>
                    <td className="admin-perm-td-check">
                      <label className="admin-perm-check">
                        <input
                          type="checkbox"
                          checked={u.is_admin || !!u.modulo_boletos}
                          disabled={u.is_admin || savingId === u.id}
                          onChange={() => toggleModulo(u, 'modulo_boletos')}
                        />
                      </label>
                    </td>
                  </tr>
                  {precisaRestaurantes(u) && (
                    <tr className="admin-perm-rest-row">
                      <td colSpan={5}>
                        <fieldset className="admin-perm-rest-fieldset">
                          <legend className="admin-perm-rest-legend">Restaurantes liberados</legend>
                          {restaurantes.length === 0 ? (
                            <span className="admin-perm-user-nome">Cadastre restaurantes primeiro.</span>
                          ) : (
                            <ul className="admin-perm-rest-list">
                              {restaurantes.map((r) => (
                                <li key={r.id}>
                                  <label>
                                    <input
                                      type="checkbox"
                                      checked={u.restaurante_ids.includes(r.id)}
                                      disabled={savingId === u.id}
                                      onChange={() => toggleRestaurante(u, r.id)}
                                    />
                                    <span>{r.nome}</span>
                                  </label>
                                </li>
                              ))}
                            </ul>
                          )}
                        </fieldset>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default AdminPermissoesUsuarios;
