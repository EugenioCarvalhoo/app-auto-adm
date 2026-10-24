import { fireEvent, render, screen } from '@testing-library/react';
import PreviewImagem from './PreviewImagem';

function renderizar() {
  const onFechar = jest.fn();
  render(<PreviewImagem url="blob:foto-1" onFechar={onFechar} />);
  const dialogo = screen.getByRole('dialog', { name: 'Imagem do documento' });
  const fechar = screen.getByTestId('ia-preview-fechar');
  const zoom = screen.getByTestId('ia-preview-zoom');
  return { onFechar, dialogo, fechar, zoom };
}

describe('PreviewImagem', () => {
  it('abre como diálogo modal com a foto da sessão', () => {
    const { dialogo } = renderizar();

    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('img', { name: /Foto do boleto/ })).toHaveAttribute('src', 'blob:foto-1');
  });

  it('fecha pelo botão Fechar', () => {
    const { onFechar, fechar } = renderizar();

    fireEvent.click(fechar);

    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('fecha com Esc', () => {
    const { onFechar, dialogo } = renderizar();

    fireEvent.keyDown(dialogo, { key: 'Escape' });

    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('fecha ao clicar no fundo, mas não ao clicar dentro do diálogo', () => {
    const { onFechar, dialogo } = renderizar();
    const fundo = dialogo.parentElement as HTMLElement;

    fireEvent.mouseDown(dialogo);
    expect(onFechar).not.toHaveBeenCalled();

    fireEvent.mouseDown(fundo);
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('põe o foco inicial no botão Fechar', () => {
    const { fechar } = renderizar();

    expect(fechar).toHaveFocus();
  });

  it('Tab a partir do último elemento volta ao primeiro (foco preso)', () => {
    const { dialogo, fechar, zoom } = renderizar();
    expect(fechar).toHaveFocus();

    const naoPropagou = fireEvent.keyDown(dialogo, { key: 'Tab' });

    expect(naoPropagou).toBe(false); // preventDefault: o navegador não move o foco para fora
    expect(zoom).toHaveFocus();
  });

  it('Shift+Tab a partir do primeiro elemento vai para o último (foco preso)', () => {
    const { dialogo, fechar, zoom } = renderizar();
    zoom.focus();

    const naoPropagou = fireEvent.keyDown(dialogo, { key: 'Tab', shiftKey: true });

    expect(naoPropagou).toBe(false);
    expect(fechar).toHaveFocus();
  });

  it('Tab com o foco fora do diálogo traz o foco para dentro', () => {
    const { dialogo, zoom } = renderizar();
    const fora = document.createElement('button');
    document.body.appendChild(fora);
    fora.focus();

    fireEvent.keyDown(dialogo, { key: 'Tab' });

    expect(zoom).toHaveFocus();
    fora.remove();
  });

  it('alterna o zoom entre ajustar à tela e tamanho real', () => {
    const { zoom } = renderizar();
    const imagem = screen.getByRole('img', { name: /Foto do boleto/ });

    expect(imagem).not.toHaveClass('boletos-ia-preview-img--real');
    expect(zoom).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(zoom);
    expect(imagem).toHaveClass('boletos-ia-preview-img--real');
    expect(zoom).toHaveAttribute('aria-pressed', 'true');
    expect(zoom).toHaveTextContent('Ajustar à tela');

    fireEvent.click(zoom);
    expect(imagem).not.toHaveClass('boletos-ia-preview-img--real');
    expect(zoom).toHaveTextContent('Tamanho real');
  });
});
