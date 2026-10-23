import React, { useState } from 'react';
import axios from 'axios';
import './Login.css';
import { API_URL } from '../config';
import { mensagemErro } from '../lib/erros';
import type { LoginResposta, Usuario } from '../types';

interface Props {
  onLogin: (user: Usuario, token: string) => void;
}

const Login: React.FC<Props> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const body = { username, password };
    const loginUrl = `${API_URL}/login`;

    try {
      const response = await axios.post<LoginResposta>(loginUrl, body);

      // Salvar token no localStorage
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));

      // Notificar componente pai
      onLogin(response.data.user, response.data.token);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 405) {
        const apiHealth = `${API_URL}/health`;
        const rootHealth = String(API_URL).replace(/\/api$/i, '') + '/health';
        setError(
          `Login 405: o servidor recusou POST em ${loginUrl}. ` +
            `Neste build a base da API é: ${API_URL}. Se a base não for o host da API (…financialmanagementapp…/api), faça build com REACT_APP_API_URL ou use o mapeamento automático Easypanel em config.js. ` +
            `Se a base estiver certa, no Easypanel encaminhe POST /api/* ao Node :5000. Teste JSON: ${apiHealth} e ${rootHealth}.`
        );
      } else {
        setError(mensagemErro(err, 'Erro ao fazer login. Verifique suas credenciais.'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1 className="login-title">Controle Financeiro</h1>
        <h2 className="login-subtitle">Sistema de Gestão de Gastos</h2>
        
        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-error">{error}</div>}
          
          <div className="form-group">
            <label htmlFor="username">Usuário</label>
            <input
              type="text"
              id="username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Digite seu usuário"
              required
              autoFocus
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Senha</label>
            <input
              type="password"
              id="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Digite sua senha"
              required
              disabled={loading}
            />
          </div>

          <button 
            type="submit" 
            className="login-button"
            disabled={loading}
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;

