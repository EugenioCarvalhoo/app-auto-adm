import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { mensagemErro } from '../lib/erros';
import type { Restaurante, RestauranteForm } from '../types';
import './CadastroRestaurantes.css';

interface Props {
  onUpdate?: () => void | Promise<void>;
}

const FORM_VAZIO: RestauranteForm = {
  nome: '',
  endereco: '',
  telefone: '',
  email: '',
  cnpj: '',
  observacoes: ''
};

const CadastroRestaurantes: React.FC<Props> = ({ onUpdate }) => {
  const [restaurantes, setRestaurantes] = useState<Restaurante[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<Restaurante | null>(null);
  const [formData, setFormData] = useState<RestauranteForm>(FORM_VAZIO);

  useEffect(() => {
    carregarRestaurantes();
  }, []);

  const carregarRestaurantes = async () => {
    try {
      setLoading(true);
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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const limparFormulario = () => {
    setFormData(FORM_VAZIO);
    setEditando(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.nome || formData.nome.trim() === '') {
      setError('Nome é obrigatório');
      return;
    }

    try {
      setError(null);
      if (editando) {
        // Atualizar
        await axios.put(`${API_URL}/restaurantes/${editando.id}`, formData);
      } else {
        // Criar novo
        await axios.post(`${API_URL}/restaurantes`, formData);
      }
      limparFormulario();
      await carregarRestaurantes();
      if (onUpdate) {
        onUpdate();
      }
    } catch (err) {
      console.error('Erro ao salvar restaurante:', err);
      setError(mensagemErro(err, 'Erro ao salvar restaurante'));
    }
  };

  const handleEditar = (restaurante: Restaurante) => {
    setEditando(restaurante);
    setFormData({
      nome: restaurante.nome || '',
      endereco: restaurante.endereco || '',
      telefone: restaurante.telefone || '',
      email: restaurante.email || '',
      cnpj: restaurante.cnpj || '',
      observacoes: restaurante.observacoes || ''
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeletar = async (id: number) => {
    if (!window.confirm('Tem certeza que deseja desativar este restaurante?')) {
      return;
    }

    try {
      await axios.delete(`${API_URL}/restaurantes/${id}`);
      await carregarRestaurantes();
      if (onUpdate) {
        onUpdate();
      }
    } catch (err) {
      console.error('Erro ao deletar restaurante:', err);
      setError(mensagemErro(err, 'Erro ao deletar restaurante'));
    }
  };

  if (loading) {
    return (
      <div className="cadastro-restaurantes">
        <div className="loading">Carregando restaurantes...</div>
      </div>
    );
  }

  return (
    <div className="cadastro-restaurantes">
      <h2>Cadastro de Restaurantes</h2>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="restaurante-form">
        <div className="form-group">
          <label htmlFor="nome">
            Nome <span className="required">*</span>
          </label>
          <input
            type="text"
            id="nome"
            name="nome"
            value={formData.nome}
            onChange={handleInputChange}
            placeholder="Nome do restaurante"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="endereco">Endereço</label>
          <input
            type="text"
            id="endereco"
            name="endereco"
            value={formData.endereco}
            onChange={handleInputChange}
            placeholder="Endereço completo"
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="telefone">Telefone</label>
            <input
              type="text"
              id="telefone"
              name="telefone"
              value={formData.telefone}
              onChange={handleInputChange}
              placeholder="(00) 00000-0000"
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">E-mail</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              placeholder="email@exemplo.com"
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="cnpj">CNPJ</label>
            <input
              type="text"
              id="cnpj"
              name="cnpj"
              value={formData.cnpj}
              onChange={handleInputChange}
              placeholder="00.000.000/0000-00"
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="observacoes">Observações</label>
          <textarea
            id="observacoes"
            name="observacoes"
            value={formData.observacoes}
            onChange={handleInputChange}
            placeholder="Observações adicionais"
            rows={3}
          />
        </div>

        <div className="form-actions">
          <button type="submit" className="btn-primary">
            {editando ? 'Atualizar' : 'Cadastrar'} Restaurante
          </button>
          {editando && (
            <button type="button" onClick={limparFormulario} className="btn-secondary">
              Cancelar
            </button>
          )}
        </div>
      </form>

      <div className="restaurantes-list">
        <h3>Restaurantes Cadastrados</h3>
        {restaurantes.length === 0 ? (
          <p className="empty-message">Nenhum restaurante cadastrado ainda.</p>
        ) : (
          <div className="restaurantes-grid">
            {restaurantes.map(restaurante => (
              <div key={restaurante.id} className="restaurante-card">
                <div className="restaurante-header">
                  <h4>{restaurante.nome}</h4>
                  <div className="restaurante-actions">
                    <button
                      onClick={() => handleEditar(restaurante)}
                      className="btn-edit"
                      title="Editar"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDeletar(restaurante.id)}
                      className="btn-delete"
                      title="Desativar"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
                <div className="restaurante-details">
                  {restaurante.endereco && (
                    <p><strong>Endereço:</strong> {restaurante.endereco}</p>
                  )}
                  {restaurante.telefone && (
                    <p><strong>Telefone:</strong> {restaurante.telefone}</p>
                  )}
                  {restaurante.email && (
                    <p><strong>E-mail:</strong> {restaurante.email}</p>
                  )}
                  {restaurante.cnpj && (
                    <p><strong>CNPJ:</strong> {restaurante.cnpj}</p>
                  )}
                  {restaurante.observacoes && (
                    <p><strong>Observações:</strong> {restaurante.observacoes}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CadastroRestaurantes;
