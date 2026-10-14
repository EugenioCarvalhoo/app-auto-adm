import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';
import GridEditavel from './components/GridEditavel';
import Login from './components/Login';
import CadastroRestaurantes from './components/CadastroRestaurantes';
import Relatorios from './components/Relatorios';
import EstoqueShell from './components/estoque/EstoqueShell';
import AdminDashboard from './components/AdminDashboard';
import AdminPermissoesUsuarios from './components/AdminPermissoesUsuarios';
import BoletosModulo from './components/boletos/BoletosModulo';
import {
  estoqueViewInicial,
  permissoesUsuario,
  telaInicialUsuario,
  usuarioTemAlgumModulo
} from './lib/userPermissoes';
import { API_URL } from './config';

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
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

function App() {
  const [gastos, setGastos] = useState([]);
  const [restaurantes, setRestaurantes] = useState([]);
  const [restauranteSelecionado, setRestauranteSelecionado] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [telaAtual, setTelaAtual] = useState(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      return telaInicialUsuario(u);
    } catch {
      return 'gastos';
    }
  });
  const [estoqueView, setEstoqueView] = useState(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      return estoqueViewInicial(u);
    } catch {
      return 'resumo';
    }
  });
  const [msgEstoque, setMsgEstoque] = useState(null);
  const [estoqueMovPresetPeriodo, setEstoqueMovPresetPeriodo] = useState(null);

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
    const telaFinanceira = telaAtual === 'gastos' || telaAtual === 'relatorios' || telaAtual === 'restaurantes';
    if (telaFinanceira && !p.financeiro) {
      setTelaAtual(telaInicialUsuario(user));
      if (p.estoque || p.estoqueSimplificado) setEstoqueView(estoqueViewInicial(user));
    } else if (telaAtual === 'boletos' && !p.boletos) {
      setTelaAtual(telaInicialUsuario(user));
    } else if (telaAtual === 'estoque' && !p.estoque && !p.estoqueSimplificado) {
      setTelaAtual(telaInicialUsuario(user));
    }
  }, [user, telaAtual]);

  useEffect(() => {
    if (telaAtual === 'inicio' && user && !user.is_admin) {
      setTelaAtual(telaInicialUsuario(user));
    }
  }, [telaAtual, user]);

  useEffect(() => {
    if (isAuthenticated && user && !permissoesUsuario(user).financeiro && !user.is_admin) {
      setLoading(false);
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    if (isAuthenticated && restaurantes.length > 0) {
      if (!restauranteSelecionado) {
        setRestauranteSelecionado(restaurantes[0].id);
      }
      if (user && permissoesUsuario(user).financeiro) {
        carregarGastos();
      }
    }
  }, [isAuthenticated, restauranteSelecionado, restaurantes, user]);

  // Usuário somente estoque: se o restaurante atual saiu da lista permitida, voltar ao primeiro
  useEffect(() => {
    if (restaurantes.length === 0 || restauranteSelecionado == null) return;
    const ok = restaurantes.some((r) => r.id === restauranteSelecionado);
    if (!ok) {
      setRestauranteSelecionado(restaurantes[0].id);
    }
  }, [restaurantes, restauranteSelecionado]);

  const verificarAutenticacao = async () => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');

    if (!token) {
      setCheckingAuth(false);
      return;
    }

    try {
      const response = await axios.get(`${API_URL}/verify`);
      const u = response.data.user;
      setUser(u);
      localStorage.setItem('user', JSON.stringify(u));
      setIsAuthenticated(true);
    } catch (err) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } finally {
      setCheckingAuth(false);
    }
  };

  const handleLogin = (userData, token) => {
    setUser(userData);
    setIsAuthenticated(true);
    setTelaAtual(telaInicialUsuario(userData));
    setEstoqueView(estoqueViewInicial(userData));
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setIsAuthenticated(false);
  };

  const carregarRestaurantes = async () => {
    try {
      const response = await axios.get(`${API_URL}/restaurantes`);
      setRestaurantes(response.data);
      setError(null);
    } catch (err) {
      console.error('Erro ao carregar restaurantes:', err);
      setError('Erro ao carregar restaurantes. Verifique se o servidor está rodando.');
    }
  };

  const carregarGastos = async () => {
    if (!restauranteSelecionado) return;
    
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/gastos?restaurante_id=${restauranteSelecionado}`);
      setGastos(response.data);
      setError(null);
    } catch (err) {
      console.error('Erro ao carregar gastos:', err);
      setError('Erro ao carregar gastos. Verifique se o servidor está rodando.');
    } finally {
      setLoading(false);
    }
  };

  const salvarGastos = async (gastosAtualizados, recarregar = true) => {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('[APP] ═══ SALVARGASTOS INICIADO ═══');
    console.log('[APP] Parâmetros:', { 
      quantidade: gastosAtualizados.length, 
      recarregar,
      restauranteSelecionado 
    });
    console.log('[APP] Gastos recebidos:', JSON.parse(JSON.stringify(gastosAtualizados)));
    
    try {
      
      if (!restauranteSelecionado) {
        console.error('[APP] ❌ ERRO: Nenhum restaurante selecionado');
        setError('Selecione um restaurante antes de salvar gastos.');
        return;
      }
      
      // Garantir que todos os gastos tenham restaurante_id e todos os campos necessários
      const gastosComRestaurante = gastosAtualizados.map((gasto, index) => {
        const gastoProcessado = {
          id: gasto.id || null,
          data: gasto.data || '',
          descricao: gasto.descricao || '',
          valor: gasto.valor !== undefined && gasto.valor !== null ? gasto.valor : null,
          observacao: gasto.observacao || '',
          pago: gasto.pago !== undefined ? gasto.pago : false,
          retroativo: gasto.retroativo !== undefined ? gasto.retroativo : false,
          restaurante_id: gasto.restaurante_id || restauranteSelecionado
        };
        console.log(`[APP] Gasto ${index + 1} processado:`, JSON.parse(JSON.stringify(gastoProcessado)));
        return gastoProcessado;
      });
      
      console.log('[APP] Total de gastos processados:', gastosComRestaurante.length);
      
      // Separar novos e existentes
      const novos = gastosComRestaurante.filter(g => !g.id);
      const existentes = gastosComRestaurante.filter(g => g.id);
      
      console.log('[APP] Novos gastos:', novos.length);
      console.log('[APP] Gastos existentes:', existentes.length);

      // Criar novos
      for (let i = 0; i < novos.length; i++) {
        const gasto = novos[i];
        if (gasto.descricao || gasto.data) {
          console.log(`[APP] Criando novo gasto ${i + 1}:`, JSON.parse(JSON.stringify(gasto)));
          const response = await axios.post(`${API_URL}/gastos`, gasto);
          console.log(`[APP] ✅ Novo gasto criado:`, response.data);
        } else {
          console.log(`[APP] ⚠️ Pulando gasto ${i + 1} - sem descrição ou data`);
        }
      }

      // Atualizar existentes
      for (let i = 0; i < existentes.length; i++) {
        const gasto = existentes[i];
        console.log(`[APP] Atualizando gasto ${i + 1} (ID: ${gasto.id}):`, JSON.parse(JSON.stringify(gasto)));
        const response = await axios.put(`${API_URL}/gastos/${gasto.id}`, gasto);
        console.log(`[APP] ✅ Gasto atualizado:`, response.data);
      }

      // Recarregar lista apenas se solicitado (evita re-render durante navegação com Tab)
      if (recarregar) {
        console.log('[APP] 🔄 Recarregando gastos do servidor...');
        await carregarGastos();
        console.log('[APP] ✅ Gastos recarregados');
      } else {
        console.log('[APP] ⚠️ Pulando recarregamento para evitar perda de foco');
        // Atualizar estado local sem recarregar do servidor
        setGastos(prevGastos => {
          const novosGastos = [...prevGastos];
          gastosComRestaurante.forEach(gastoAtualizado => {
            if (gastoAtualizado.id) {
              // Atualizar existente
              const index = novosGastos.findIndex(g => g.id === gastoAtualizado.id);
              if (index !== -1) {
                console.log('[APP] Atualizando gasto local (ID:', gastoAtualizado.id, '):', JSON.parse(JSON.stringify(gastoAtualizado)));
                novosGastos[index] = { ...novosGastos[index], ...gastoAtualizado };
              } else {
                console.log('[APP] ⚠️ Gasto não encontrado localmente para atualizar (ID:', gastoAtualizado.id, ')');
              }
            } else {
              // Adicionar novo (será atualizado quando recarregar)
              console.log('[APP] Adicionando novo gasto local:', JSON.parse(JSON.stringify(gastoAtualizado)));
              novosGastos.push(gastoAtualizado);
            }
          });
          console.log('[APP] Total de gastos após atualização local:', novosGastos.length);
          return novosGastos;
        });
      }
    } catch (err) {
      console.error('[APP] ❌ ERRO ao salvar gastos:', err);
      console.error('[APP] Detalhes do erro:', err.response?.data || err.message);
      setError('Erro ao salvar gastos. Tente novamente.');
    }
  };

  const deletarGasto = async (id) => {
    try {
      await axios.delete(`${API_URL}/gastos/${id}`);
      await carregarGastos();
    } catch (err) {
      console.error('Erro ao deletar gasto:', err);
      setError('Erro ao deletar gasto. Tente novamente.');
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
  const acessoFinanceiro = perms.financeiro;
  const acessoEstoque = perms.estoque;
  const acessoEstoqueSimplificado = perms.estoqueSimplificado;
  const acessoBoletos = perms.boletos;
  const acessoQualquerEstoque = acessoEstoque || acessoEstoqueSimplificado;
  const tituloApp =
    acessoBoletos && !acessoFinanceiro && !acessoQualquerEstoque
      ? 'Boletos e Notas'
      : !acessoFinanceiro && acessoQualquerEstoque
        ? 'Estoque'
        : 'Controle Financeiro - Multi Restaurante';

  if (loading && acessoFinanceiro) {
    return (
      <div className="app">
        <div className="loading">Carregando...</div>
      </div>
    );
  }

  const handleRestauranteChange = (e) => {
    const novoRestauranteId = parseInt(e.target.value);
    setRestauranteSelecionado(novoRestauranteId);
  };

  const handleRestaurantesUpdated = async () => {
    await carregarRestaurantes();
  };

  const restauranteAtual = restaurantes.find((r) => r.id === restauranteSelecionado);

  const hojeIso = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const irParaEstoque = (view = 'resumo', opts = {}) => {
    const viewsOk = ['resumo', 'diario', 'visao', 'categorias', 'produtos', 'movimentacao'];
    let v = viewsOk.includes(view) ? view : 'resumo';
    if (v === 'diario' && !perms.estoqueSimplificado) v = perms.estoque ? 'resumo' : 'diario';
    if (v !== 'diario' && !perms.estoque) v = 'diario';
    setEstoqueView(v);
    if (opts?.periodoHoje && view === 'movimentacao') {
      const h = hojeIso();
      setEstoqueMovPresetPeriodo({
        data_inicio: h,
        data_fim: h,
        token: Date.now()
      });
    } else {
      setEstoqueMovPresetPeriodo(null);
    }
    setTelaAtual('estoque');
    setMsgEstoque(null);
    // Após o painel montar, leva o usuário até o lançamento (feedback ao tocar na aba)
    setTimeout(() => {
      document.getElementById('estoque-lancamento-panel')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }, 0);
  };

  return (
    <div className="app">
      <header className="app-header">
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
            {acessoFinanceiro && (
              <>
                <button
                  type="button"
                  onClick={() => setTelaAtual('gastos')}
                  className={telaAtual === 'gastos' ? 'nav-tab active' : 'nav-tab'}
                >
                  Gastos
                </button>
                <button
                  type="button"
                  onClick={() => setTelaAtual('relatorios')}
                  className={telaAtual === 'relatorios' ? 'nav-tab active' : 'nav-tab'}
                >
                  Relatórios
                </button>
                <button
                  type="button"
                  onClick={() => setTelaAtual('restaurantes')}
                  className={telaAtual === 'restaurantes' ? 'nav-tab active' : 'nav-tab'}
                >
                  Restaurantes
                </button>
              </>
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
            {acessoEstoque && (
              <button
                type="button"
                onClick={() => irParaEstoque('resumo')}
                className={
                  telaAtual === 'estoque' && estoqueView !== 'diario' ? 'nav-tab active' : 'nav-tab'
                }
              >
                Estoque
              </button>
            )}
            {acessoEstoqueSimplificado && (
              <button
                type="button"
                onClick={() => irParaEstoque('diario')}
                className={
                  telaAtual === 'estoque' && estoqueView === 'diario' ? 'nav-tab active' : 'nav-tab'
                }
              >
                Lançamento diário
              </button>
            )}
          </div>
          {(telaAtual === 'gastos' ||
            telaAtual === 'estoque' ||
            telaAtual === 'boletos' ||
            telaAtual === 'inicio' ||
            telaAtual === 'relatorios' ||
            ((acessoQualquerEstoque || acessoBoletos) && !acessoFinanceiro)) &&
            restaurantes.length > 0 && (
            <select
              value={restauranteSelecionado || ''}
              onChange={handleRestauranteChange}
              className="restaurante-select"
            >
              {restaurantes.map(restaurante => (
                <option key={restaurante.id} value={restaurante.id}>
                  {restaurante.nome}
                </option>
              ))}
            </select>
          )}
          {telaAtual === 'gastos' && acessoFinanceiro && (
            <button type="button" onClick={carregarGastos} className="btn-refresh">
              Atualizar
            </button>
          )}
          <button type="button" onClick={handleLogout} className="btn-logout">
            Sair
          </button>
        </div>
      </header>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}
      {msgEstoque && (
        <div className="error-message" role="status">
          {msgEstoque}
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
            gastos={gastos}
            onIrParaGastos={() => setTelaAtual('gastos')}
            onIrParaRelatorios={() => setTelaAtual('relatorios')}
            onIrParaEstoque={(view) => irParaEstoque(view || 'resumo')}
            onIrParaMovimentacaoHoje={() => irParaEstoque('movimentacao', { periodoHoje: true })}
            onIrParaBoletos={() => setTelaAtual('boletos')}
            onIrParaRestaurantes={() => setTelaAtual('restaurantes')}
            onIrParaUsuariosEstoque={() => {
              setError(null);
              setTelaAtual('permissoes');
            }}
          />
        ) : telaAtual === 'estoque' && acessoQualquerEstoque ? (
          restaurantes.length === 0 ? (
            <div className="empty-state">
              <p>Nenhum restaurante disponível. Peça ao administrador para cadastrar um restaurante.</p>
            </div>
          ) : (
            <EstoqueShell
              restauranteId={restauranteSelecionado}
              restaurantes={restaurantes}
              isAdmin={isAdmin}
              modulos={{
                estoque: perms.estoque,
                simplificado: perms.estoqueSimplificado
              }}
              view={estoqueView}
              onViewChange={setEstoqueView}
              onMessage={setMsgEstoque}
              movimentoPeriodoPreset={estoqueMovPresetPeriodo}
            />
          )
        ) : telaAtual === 'boletos' && acessoBoletos ? (
          restaurantes.length === 0 || !restauranteSelecionado ? (
            <div className="empty-state">
              <p>Nenhum restaurante disponível para lançar boletos e notas.</p>
            </div>
          ) : (
            <BoletosModulo
              restauranteId={restauranteSelecionado}
              simples={!isAdmin}
              onMessage={setError}
            />
          )
        ) : telaAtual === 'gastos' && acessoFinanceiro ? (
          restaurantes.length === 0 ? (
            <div className="empty-state">
              <p>Nenhum restaurante cadastrado. Por favor, cadastre um restaurante primeiro.</p>
              <button type="button" onClick={() => setTelaAtual('restaurantes')} className="btn-primary">
                Cadastrar Restaurante
              </button>
            </div>
          ) : (
            <GridEditavel
              gastos={gastos}
              onSave={salvarGastos}
              onDelete={deletarGasto}
              restauranteId={restauranteSelecionado}
            />
          )
        ) : telaAtual === 'relatorios' && acessoFinanceiro ? (
          <Relatorios restauranteId={restauranteSelecionado} />
        ) : telaAtual === 'permissoes' && isAdmin ? (
          <AdminPermissoesUsuarios onError={(msg) => setError(msg)} />
        ) : telaAtual === 'restaurantes' && acessoFinanceiro ? (
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

