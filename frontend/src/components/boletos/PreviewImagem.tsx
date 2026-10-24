import React, { useEffect, useRef, useState } from 'react';

interface Props {
  url: string;
  onFechar: () => void;
}

const FOCAVEIS = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Visualização da foto local (só desta sessão; não é enviada nem salva no servidor). */
export default function PreviewImagem({ url, onFechar }: Props) {
  const [tamanhoReal, setTamanhoReal] = useState(false);
  const dialogoRef = useRef<HTMLDivElement>(null);
  const fecharRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fecharRef.current?.focus();
  }, []);

  const teclado = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onFechar();
      return;
    }
    if (event.key !== 'Tab') return;
    const itens = Array.from(dialogoRef.current?.querySelectorAll<HTMLElement>(FOCAVEIS) ?? []);
    const primeiro = itens[0];
    const ultimo = itens[itens.length - 1];
    if (!primeiro || !ultimo) return;
    const ativo = document.activeElement;
    if (event.shiftKey && (ativo === primeiro || !dialogoRef.current?.contains(ativo))) {
      event.preventDefault();
      ultimo.focus();
    } else if (!event.shiftKey && (ativo === ultimo || !dialogoRef.current?.contains(ativo))) {
      event.preventDefault();
      primeiro.focus();
    }
  };

  return (
    <div
      className="boletos-ia-preview-fundo"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onFechar();
      }}
      onKeyDown={teclado}
    >
      <div
        ref={dialogoRef}
        className="boletos-ia-preview"
        role="dialog"
        aria-modal="true"
        aria-label="Imagem do documento"
        data-testid="ia-preview"
      >
        <div className="boletos-ia-preview-barra">
          <button
            type="button"
            className="boletos-btn-ghost boletos-ia-preview-btn"
            onClick={() => setTamanhoReal((v) => !v)}
            aria-pressed={tamanhoReal}
            data-testid="ia-preview-zoom"
          >
            {tamanhoReal ? 'Ajustar à tela' : 'Tamanho real'}
          </button>
          <button
            ref={fecharRef}
            type="button"
            className="boletos-btn-ghost boletos-ia-preview-btn"
            onClick={onFechar}
            data-testid="ia-preview-fechar"
          >
            Fechar
          </button>
        </div>
        <div className="boletos-ia-preview-area">
          <img
            src={url}
            alt="Foto do boleto ou nota escolhida nesta sessão, para conferência dos campos"
            className={tamanhoReal ? 'boletos-ia-preview-img boletos-ia-preview-img--real' : 'boletos-ia-preview-img'}
          />
        </div>
      </div>
    </div>
  );
}
