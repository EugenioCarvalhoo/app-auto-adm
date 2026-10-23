import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';
import Login from './components/Login';
import CadastroRestaurantes from './components/CadastroRestaurantes';
import AdminDashboard from './components/AdminDashboard';
import AdminOcorrenciasBoletos from './components/AdminOcorrenciasBoletos';
import AdminPermissoesUsuarios from './components/AdminPermissoesUsuarios';
import BoletosModulo from './components/boletos/BoletosModulo';
import { permissoesUsuario, telaInicialUsuario, usuarioTemAlgumModulo } from './lib/userPermissoes';
import { API_URL } from './config';
import type { Restaurante, Tela, Usuario, VerifyResposta } from './types';

const CORES_RESTAURANTE = [
  '#0f766e',
  '#b45309',
  '#1d4ed8',
  '#be123c',
  '#6d28d9',
  '#047857',
  '#c2410c',
  '#0369a1',
  '#a16207',
  '#7c3aed',
  '#0e7490',
  '#9f1239'
];

function corRestaurante(id: number): string {
  const indice = Math.abs(Number(id) || 0) % CORES_RESTAURANTE.length;
  return CORES_RESTAURANTE[indice] ?? '#0f766e';
}

// Configurar axios para incluir token em todas as requisições
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor para tratar erros de autenticação
axios.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    // 401 no próprio login é senha errada: a tela de login mostra o erro, sem recarregar
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      !String(error.config?.url || '').endsWith('/login')
    ) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

function App() {
  const [restaurantes, setRestaurantes] = useState<Restaurante[]>([]);
  const [restauranteSelecionado, setRestauranteSelecionado] = useState<number | null>(null);
  const [restauranteConfirmado, setRestauranteConfirmado] = useState(false);
  const [restaurantePendente, setRestaurantePendente] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<Usuario | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [telaAtual, setTelaAtual] = useState<Tela>(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}') as Partial<Usuario>;
      return telaInicialUsuario({ is_admin: !!u.is_admin });
    } catch {
      return 'boletos';
    }
  });

  useEffect(() => {
    verificarAutenticacao();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      carregarRestaurantes();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!user || user.is_admin) return;
    const p = permissoesUsuario(user);
    if (telaAtual !== 'boletos' || !p.boletos) setTelaAtual(telaInicialUsuario(user));
  }, [user, telaAtual]);

  useEffect(() => {
    if (!isAuthenticated || restaurantes.length === 0 || !user) return;
    const perguntar = !!user.is_admin || restaurantes.length > 1;
    if (perguntar && !restauranteConfirmado) return;
    const primeiro = restaurantes[0];
    if (!restauranteSelecionado && primeiro) {
      setRestauranteSelecionado(primeiro.id);
      setRestauranteConfirmado(true);
    }
  }, [isAuthenticated, restauranteSelecionado, restaurantes, user, restauranteConfirmado]);

  // Se o restaurante atual saiu da lista permitida, voltar ao primeiro
  useEffect(() => {
    if (restaurantes.length === 0 || restauranteSelecionado == null) return;
    const ok = restaurantes.some((r) => r.id === restauranteSelecionado);
    if (!ok) {
      setRestauranteSelecionado(null);
      setRestauranteConfirmado(false);
      setRestaurantePendente(null);
    }
  }, [restaurantes, restauranteSelecionado]);

  const verificarAutenticacao = async () => {
    const token = localStorage.getItem('token');

    if (!token) {
      setCheckingAuth(false);
      return;
    }

    try {
      const response = await axios.get<VerifyResposta>(`${API_URL}/verify`);
      const u = response.data.user;
      setUser(u);
      localStorage.setItem('user', JSON.stringify(u));
      setIsAuthenticated(true);
    } catch {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } finally {
      setCheckingAuth(false);
    }
  };

  const handleLogin = (userData: Usuario) => {
    setUser(userData);
    setIsAuthenticated(true);
    setTelaAtual(telaInicialUsuario(userData));
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setIsAuthenticated(false);
    setRestauranteSelecionado(null);
    setRestauranteConfirmado(false);
    setRestaurantePendente(null);
  };

  const carregarRestaurantes = async () => {
    try {
      const response = await axios.get<Restaurante[]>(`${API_URL}/restaurantes`);
      setRestaurantes(response.data);
      setError(null);
    } catch (err) {
      console.error('Erro ao carregar restaurantes:', err);
      setError('Erro ao carregar restaurantes. Verifique se o servidor está rodando.');
    } finally {
      setLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <div className="app">
        <div className="loading">Verificando autenticação...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  const perms = permissoesUsuario(user);
  const isAdmin = !!user?.is_admin;
  const acessoBoletos = perms.boletos;
  const tituloApp = isAdmin ? 'Controle Financeiro - Multi Restaurante' : 'Boletos e Notas';

  if (loading) {
    return (
      <div className="app">
        <div className="loading">Carregando...</div>
      </div>
    );
  }

  const confirmarRestaurante = () => {
    if (restaurantePendente == null) return;
    setRestauranteSelecionado(restaurantePendente);
    setRestauranteConfirmado(true);
  };

  const handleRestauranteChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const novoRestauranteId = parseInt(e.target.value, 10);
    setRestauranteSelecionado(novoRestauranteId);
  };

  const handleRestaurantesUpdated = async () => {
    await carregarRestaurantes();
  };

  const restauranteAtual = restaurantes.find((r) => r.id === restauranteSelecionado);
  const corAtual = restauranteAtual ? corRestaurante(restauranteAtual.id) : null;
  const perguntarRestaurante = (isAdmin || restaurantes.length > 1) && !restauranteConfirmado && restaurantes.length > 0;

  return (
    <div className="app">
      <header
        className="app-header"
        style={
          corAtual
            ? { boxShadow: `inset 0 7px 0 ${corAtual}, 0 2px 4px rgba(0, 0, 0, 0.1)` }
            : undefined
        }
      >
        <div>
          <h1>{tituloApp}</h1>
          {user && (
            <p className="user-info">Olá, {user.nome}!</p>
          )}
        </div>
        <div className="header-actions">
          <div className="nav-tabs nav-tabs--scroll">
            {isAdmin && (
              <button
                type="button"
                onClick={() => setTelaAtual('inicio')}
                className={telaAtual === 'inicio' ? 'nav-tab active' : 'nav-tab'}
              >
                Início
              </button>
            )}
            {acessoBoletos && (
              <button
                type="button"
                onClick={() => setTelaAtual('boletos')}
                className={telaAtual === 'boletos' ? 'nav-tab active' : 'nav-tab'}
              >
                Boletos e notas
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={() => setTelaAtual('restaurantes')}
                className={telaAtual === 'restaurantes' ? 'nav-tab active' : 'nav-tab'}
              >
                Restaurantes
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setTelaAtual('permissoes');
                  setError(null);
                }}
                className={telaAtual === 'permissoes' ? 'nav-tab active' : 'nav-tab'}
              >
                Usuários
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setTelaAtual('ocorrencias');
                  setError(null);
                }}
                className={telaAtual === 'ocorrencias' ? 'nav-tab active' : 'nav-tab'}
              >
                Ocorrências
              </button>
            )}
          </div>
          {restaurantes.length > 0 && (
            <select
              value={restauranteSelecionado || ''}
              onChange={handleRestauranteChange}
              className="restaurante-select"
              style={corAtual ? { borderColor: corAtual, boxShadow: `inset 4px 0 0 ${corAtual}` } : undefined}
            >
              {restaurantes.map(restaurante => (
                <option key={restaurante.id} value={restaurante.id}>
                  {restaurante.nome}
                </option>
              ))}
            </select>
          )}
          <button type="button" onClick={handleLogout} className="btn-logout">
            Sair
          </button>
        </div>
      </header>

      {restauranteAtual && corAtual && (
        <div className="restaurante-tarja" style={{ backgroundColor: corAtual }}>
          <span>Restaurante atual</span>
          <strong>{restauranteAtual.nome}</strong>
        </div>
      )}

      {perguntarRestaurante && (
        <div className="restaurante-modal" role="dialog" aria-modal="true" aria-labelledby="restaurante-modal-titulo">
          <div className="restaurante-modal-card">
            <h2 id="restaurante-modal-titulo">Em qual restaurante você vai entrar?</h2>
            <p>Confirme a loja antes de lançar. A cor escolhida fica na tarja do topo enquanto você trabalha.</p>
            <ul className="restaurante-modal-lista">
              {restaurantes.map((restaurante) => {
                const cor = corRestaurante(restaurante.id);
                const ativo = restaurantePendente === restaurante.id;
                return (
                  <li key={restaurante.id}>
                    <button
                      type="button"
                      className={ativo ? 'restaurante-opcao is-selected' : 'restaurante-opcao'}
                      style={{ borderLeftColor: cor }}
                      onClick={() => setRestaurantePendente(restaurante.id)}
                    >
                      <i style={{ backgroundColor: cor }} aria-hidden="true" />
                      <span>{restaurante.nome}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <button type="button" className="btn-primary" disabled={restaurantePendente == null} onClick={confirmarRestaurante}>
              Entrar neste restaurante
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}
      <main className="app-main">
        {!usuarioTemAlgumModulo(user) ? (
          <div className="empty-state">
            <p>Seu usuário não tem módulos liberados. Peça ao administrador para configurar em Permissões.</p>
          </div>
        ) : telaAtual === 'inicio' && isAdmin ? (
          <AdminDashboard
            restauranteId={restauranteSelecionado}
            restauranteNome={restauranteAtual?.nome}
            onIrParaBoletos={() => setTelaAtual('boletos')}
            onIrParaRestaurantes={() => setTelaAtual('restaurantes')}
            onIrParaUsuarios={() => {
              setError(null);
              setTelaAtual('permissoes');
            }}
          />
        ) : telaAtual === 'boletos' && acessoBoletos ? (
          restaurantes.length === 0 || !restauranteSelecionado ? (
            <div className="empty-state">
              <p>Nenhum restaurante disponível para lançar boletos e notas.</p>
            </div>
          ) : (
            <BoletosModulo
              restauranteId={restauranteSelecionado}
              restauranteNome={restauranteAtual?.nome}
              simples={!isAdmin}
              podeMarcarPago={perms.pagar}
              podeDesfazerPago={perms.admin}
              onMessage={setError}
            />
          )
        ) : telaAtual === 'permissoes' && isAdmin ? (
          <AdminPermissoesUsuarios onError={(msg: string | null) => setError(msg)} />
        ) : telaAtual === 'ocorrencias' && isAdmin ? (
          <AdminOcorrenciasBoletos />
        ) : telaAtual === 'restaurantes' && isAdmin ? (
          <CadastroRestaurantes onUpdate={handleRestaurantesUpdated} />
        ) : (
          <div className="empty-state">
            <p>Você não tem permissão para acessar esta área.</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;

