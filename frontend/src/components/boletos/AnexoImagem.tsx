import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../config';
import { mensagemErro } from '../../lib/erros';

interface Props {
  boletoId: number;
}

/** Miniatura + visualização ampliada do anexo. A rota exige Bearer: busca como blob (nunca <img src> direto). */
const AnexoImagem: React.FC<Props> = ({ boletoId }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const fechar = useCallback(() => {
    setAberto(false);
    setUrl((atual) => {
      if (atual) URL.revokeObjectURL(atual);
      return null;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  useEffect(() => {
    if (!aberto) return undefined;
    const aoTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar();
    };
    window.addEventListener('keydown', aoTecla);
    return () => window.removeEventListener('keydown', aoTecla);
  }, [aberto, fechar]);

  const abrir = async () => {
    setCarregando(true);
    setErro(null);
    try {
      const { data } = await axios.get<Blob>(`${API_URL}/boletos/${boletoId}/anexo`, { responseType: 'blob' });
      setUrl(URL.createObjectURL(data));
      setAberto(true);
    } catch (e) {
      // A resposta é blob: o corpo de erro não vem em `data.error`, então tratamos pelo status.
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      if (status === 503) {
        setErro('O armazenamento de imagens não está disponível agora. Tente mais tarde ou avise o administrador.');
      } else if (status === 404) {
        setErro('Imagem não encontrada.');
      } else {
        setErro(mensagemErro(e, 'Não foi possível carregar a imagem.'));
      }
    } finally {
      setCarregando(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="boletos-btn-anexo"
        onClick={() => void abrir()}
        disabled={carregando}
        data-boleto-anexo={boletoId}
      >
        <span aria-hidden="true">🖼 </span>
        {carregando ? 'Abrindo…' : 'Ver imagem'}
      </button>
      {erro && (
        <span className="boletos-erro-inline" role="alert">
          {erro}
        </span>
      )}
      {aberto && url && (
        <div className="boletos-modal" role="dialog" aria-modal="true" aria-label="Imagem do boleto">
          <div className="boletos-modal-card boletos-modal-card--imagem">
            <img src={url} alt="Imagem anexada ao lançamento" className="boletos-anexo-img" />
            <button type="button" className="boletos-btn-ghost boletos-btn-grande" onClick={fechar}>
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default AnexoImagem;
