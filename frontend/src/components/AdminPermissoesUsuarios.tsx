import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { mensagemErro } from '../lib/erros';
import type { Restaurante as RestauranteApi, Usuario } from '../types';
import './AdminPermissoesUsuarios.css';

/** Só o necessário da lista de restaurantes nesta tela. */
type Restaurante = Pick<RestauranteApi, 'id' | 'nome'>;

export type UsuarioPermissaoRow = Usuario;

type ModuloKey = 'modulo_boletos' | 'pode_marcar_pago';

interface Props {
  onError?: (msg: string | null) => void;
}

const NOVO_VAZIO = {
  username: '',
  password: '',
  nome: '',
  modulo_boletos: false,
  pode_marcar_pago: false,
  restaurante_ids: [] as number[]
};

const AdminPermissoesUsuarios: React.FC<Props> = ({ onError }) => {
  const [lista, setLista] = useState<UsuarioPermissaoRow[]>([]);
  const [restaurantes, setRestaurantes] = useState<Restaurante[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [criando, setCriando] = useState(false);
  const [novo, setNovo] = useState(NOVO_VAZIO);
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
          modulo_boletos: usuario.modulo_boletos,
          pode_marcar_pago: !!usuario.pode_marcar_pago,
          restaurante_ids: usuario.restaurante_ids
        }
      );
      atualizarLocal(usuario.id, data);
      setBanner({ type: 'ok', text: `Permissões de ${usuario.username} atualizadas.` });
    } catch (e) {
      const msg = mensagemErro(e, 'Erro ao salvar permissões.');
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

  // Todo usuário não-admin precisa de restaurantes liberados pelo admin.
  const precisaRestaurantes = (u: UsuarioPermissaoRow) => !u.is_admin;

  const novoPrecisaRestaurante = true;

  const alternarModuloNovo = (campo: ModuloKey) => {
    setNovo((atual) => ({ ...atual, [campo]: !atual[campo] }));
  };

  const alternarRestauranteNovo = (restId: number) => {
    setNovo((atual) => ({
      ...atual,
      restaurante_ids: atual.restaurante_ids.includes(restId)
        ? atual.restaurante_ids.filter((id) => id !== restId)
        : [...atual.restaurante_ids, restId]
    }));
  };

  const criarUsuario = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!novo.modulo_boletos) {
      setBanner({ type: 'err', text: 'Marque ao menos um módulo para o usuário.' });
      return;
    }
    if (novoPrecisaRestaurante && novo.restaurante_ids.length === 0) {
      setBanner({ type: 'err', text: 'Marque ao menos um restaurante para o usuário.' });
      return;
    }
    setCriando(true);
    setBanner(null);
    try {
      await axios.post(`${API_URL}/admin/usuarios-permissoes`, {
        username: novo.username.trim(),
        password: novo.password,
        nome: novo.nome.trim(),
        modulo_boletos: novo.modulo_boletos,
        pode_marcar_pago: novo.modulo_boletos && novo.pode_marcar_pago,
        restaurante_ids: novoPrecisaRestaurante ? novo.restaurante_ids : []
      });
      setNovo(NOVO_VAZIO);
      await carregar();
      setBanner({ type: 'ok', text: 'Usuário criado. Ele já pode entrar com o login e a senha definidos.' });
    } catch (e) {
      setBanner({ type: 'err', text: mensagemErro(e, 'Erro ao criar usuário.') });
    } finally {
      setCriando(false);
    }
  };

  const removerUsuario = async (usuario: UsuarioPermissaoRow) => {
    if (usuario.is_admin) return;
    if (!window.confirm(`Remover o usuário ${usuario.username}? Esta ação não pode ser desfeita.`)) return;
    setSavingId(usuario.id);
    setBanner(null);
    try {
      await axios.delete(`${API_URL}/admin/usuarios-permissoes/${usuario.id}`);
      await carregar();
      setBanner({ type: 'ok', text: `Usuário ${usuario.username} removido.` });
    } catch (e) {
      setBanner({ type: 'err', text: mensagemErro(e, 'Erro ao remover usuário.') });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="admin-perm">
      <h1 className="admin-perm-title">Usuários e permissões</h1>
      <p className="admin-perm-hint">
        Cadastre o login e libere o módulo de boletos e notas. Todo usuário que não é administrador só
        acessa os restaurantes liberados aqui.
      </p>

      {banner && (
        <div
          className={`admin-perm-banner admin-perm-banner--${banner.type === 'ok' ? 'ok' : 'err'}`}
          role="status"
        >
          {banner.text}
        </div>
      )}

      <form className="admin-perm-novo" onSubmit={criarUsuario}>
        <h2>Novo usuário</h2>
        <div className="admin-perm-novo-grid">
          <label>
            Login
            <input
              value={novo.username}
              onChange={(e) => setNovo({ ...novo, username: e.target.value })}
              autoComplete="off"
              required
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={novo.password}
              onChange={(e) => setNovo({ ...novo, password: e.target.value })}
              autoComplete="new-password"
              minLength={4}
              required
            />
          </label>
          <label>
            Nome
            <input
              value={novo.nome}
              onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
              required
            />
          </label>
        </div>
        <fieldset className="admin-perm-rest-fieldset">
          <legend className="admin-perm-rest-legend">Módulos</legend>
          <ul className="admin-perm-rest-list">
            <li>
              <label>
                <input
                  type="checkbox"
                  checked={novo.modulo_boletos}
                  onChange={() => alternarModuloNovo('modulo_boletos')}
                />
                <span>Boletos e notas</span>
              </label>
            </li>
            <li>
              <label>
                <input
                  type="checkbox"
                  checked={novo.pode_marcar_pago}
                  disabled={!novo.modulo_boletos}
                  onChange={() => alternarModuloNovo('pode_marcar_pago')}
                />
                <span>Pode marcar boleto como pago</span>
              </label>
            </li>
          </ul>
        </fieldset>
        {novoPrecisaRestaurante && (
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
                        checked={novo.restaurante_ids.includes(r.id)}
                        onChange={() => alternarRestauranteNovo(r.id)}
                      />
                      <span>{r.nome}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        )}
        <button type="submit" className="admin-perm-criar" disabled={criando || loading}>
          {criando ? 'Salvando…' : 'Cadastrar usuário'}
        </button>
      </form>

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
                <th className="admin-perm-th-check">Boletos e notas</th>
                <th className="admin-perm-th-check">Pode marcar boleto como pago</th>
                <th className="admin-perm-th-acao">Ações</th>
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
                          checked={u.is_admin || !!u.modulo_boletos}
                          disabled={u.is_admin || savingId === u.id}
                          onChange={() => toggleModulo(u, 'modulo_boletos')}
                        />
                      </label>
                    </td>
                    <td className="admin-perm-td-check">
                      <label className="admin-perm-check">
                        <input
                          type="checkbox"
                          aria-label={`Pode marcar boleto como pago: ${u.username}`}
                          checked={u.is_admin || !!u.pode_marcar_pago}
                          disabled={u.is_admin || !u.modulo_boletos || savingId === u.id}
                          onChange={() => toggleModulo(u, 'pode_marcar_pago')}
                        />
                      </label>
                    </td>
                    <td className="admin-perm-td-acao">
                      {!u.is_admin && (
                        <button
                          type="button"
                          className="admin-perm-remover"
                          disabled={savingId === u.id}
                          onClick={() => removerUsuario(u)}
                        >
                          Remover
                        </button>
                      )}
                    </td>
                  </tr>
                  {precisaRestaurantes(u) && (
                    <tr className="admin-perm-rest-row">
                      <td colSpan={4}>
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
