import React, { useEffect, useRef, useState } from 'react';

interface Props {
  linha: string;
  /** Botão grande (formulário) ou compacto (lista). */
  grande?: boolean;
}

async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // cai no fallback abaixo
  }
  try {
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Copia a linha digitável (só dígitos) com feedback em texto. */
const CopiarLinha: React.FC<Props> = ({ linha, grande = false }) => {
  const [estado, setEstado] = useState<'ocioso' | 'ok' | 'erro'>('ocioso');
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    []
  );

  const copiar = async () => {
    const ok = await copiarTexto(linha.replace(/\D/g, ''));
    setEstado(ok ? 'ok' : 'erro');
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setEstado('ocioso'), 2500);
  };

  return (
    <>
      <button
        type="button"
        className={grande ? 'boletos-btn-copiar boletos-btn-copiar--grande' : 'boletos-btn-copiar'}
        onClick={() => void copiar()}
        data-boleto-copiar
      >
        {estado === 'ok' ? '✓ Copiado!' : estado === 'erro' ? 'Não foi possível copiar' : 'Copiar linha digitável'}
      </button>
      <span className="boletos-sr-only" role="status" aria-live="polite">
        {estado === 'ok' ? 'Linha digitável copiada' : estado === 'erro' ? 'Falha ao copiar' : ''}
      </span>
    </>
  );
};

export default CopiarLinha;
