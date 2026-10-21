import React from 'react';
import './AdminDashboard.css';

interface Props {
  restauranteId: number | null;
  restauranteNome?: string;
  onIrParaBoletos: () => void;
  onIrParaRestaurantes: () => void;
  onIrParaUsuarios: () => void;
}

const AdminDashboard: React.FC<Props> = ({
  restauranteId,
  restauranteNome,
  onIrParaBoletos,
  onIrParaRestaurantes,
  onIrParaUsuarios
}) => {
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

      <nav className="admin-dashboard-actions-compact" aria-label="Ações rápidas">
        <button type="button" className="admin-dashboard-btn" onClick={onIrParaBoletos}>
          Boletos e notas
        </button>
        <button type="button" className="admin-dashboard-btn admin-dashboard-btn--ghost" onClick={onIrParaRestaurantes}>
          Restaurantes
        </button>
        <button type="button" className="admin-dashboard-btn admin-dashboard-btn--ghost" onClick={onIrParaUsuarios}>
          Usuários e permissões
        </button>
      </nav>
    </div>
  );
};

export default AdminDashboard;
