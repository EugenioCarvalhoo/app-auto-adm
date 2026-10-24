import { parseDateOnly, VALOR_BOLETO_MAX } from './boleto';
import type { TipoBoleto } from './boletosSemana';

/**
 * Saneamento da leitura por IA. A saída do modelo é dado NÃO confiável: tudo passa por aqui e
 * qualquer campo inválido vira null. Funções puras (sem I/O).
 */

export type TipoDocumento = 'boleto' | 'nota';

/** Forma devolvida por POST /api/boletos/extrair. */
export interface ExtracaoSugerida {
  tipo_documento: TipoDocumento | null;
  tipo_sugerido: TipoBoleto | null;
  fornecedor: string | null;
  valor: number | null;
  dt_vencimento: string | null;
  dt_documento: string | null;
  linha_digitavel: string | null;
}

export const EXTRACAO_VAZIA: ExtracaoSugerida = {
  tipo_documento: null,
  tipo_sugerido: null,
  fornecedor: null,
  valor: null,
  dt_vencimento: null,
  dt_documento: null,
  linha_digitavel: null
};

export const FORNECEDOR_MAX = 120;
const ANO_MIN = 2000;
const ANO_MAX = 2100;

// ---------- Imagem (magic bytes) ----------

export type MimeImagem = 'image/jpeg' | 'image/png' | 'image/webp';

/** Tipo real pelo conteúdo (nunca pelo Content-Type/nome informado pelo cliente). */
export function detectarMimeImagem(buf: Buffer): MimeImagem | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

// ---------- Valor ----------

/** Valor em centavos inteiros (> 0 e dentro de NUMERIC(14,2)); senão null. Aceita número ou texto pt-BR/en. */
export function valorEmCentavos(raw: unknown): number | null {
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string') {
    const t = raw.trim().replace(/\s/g, '').replace(/^R\$/i, '');
    if (!/^\d[\d.,]*$/.test(t)) return null;
    const temVirgula = t.includes(',');
    const norm = temVirgula ? t.replace(/\./g, '').replace(',', '.') : t;
    if ((norm.match(/\./g) || []).length > 1) return null;
    n = Number(norm);
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n <= 0 || n > VALOR_BOLETO_MAX) return null;
  const centavos = Math.round(n * 100);
  return centavos > 0 ? centavos : null;
}

// ---------- Datas ----------

/** Aceita AAAA-MM-DD ou DD/MM/AAAA; data real, ano entre 2000 e 2100; senão null. */
export function sanearData(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  let iso = t;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (br) iso = `${br[3]}-${br[2]}-${br[1]}`;
  const data = parseDateOnly(iso);
  if (!data) return null;
  const ano = Number(data.slice(0, 4));
  return ano >= ANO_MIN && ano <= ANO_MAX ? data : null;
}

// ---------- Fornecedor ----------

/** Texto livre vindo da IA: remove controles/bidi/zero-width, colapsa espaços, limita o tamanho. */
export function sanearFornecedor(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const limpo = raw
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!limpo) return null;
  return limpo.length > FORNECEDOR_MAX ? limpo.slice(0, FORNECEDOR_MAX).trim() : limpo;
}

// ---------- Linha digitável ----------

function mod10(bloco: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = bloco.length - 1; i >= 0; i--) {
    const p = Number(bloco[i]) * peso;
    soma += p > 9 ? p - 9 : p;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

function somaMod11(bloco: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = bloco.length - 1; i >= 0; i--) {
    soma += Number(bloco[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  return soma % 11;
}

/** DV do código de barras bancário (posição 5 do código de 44): resto 0, 10 ou 11 -> 1. */
function dvGeralBancario(barras43: string): number {
  const dv = 11 - somaMod11(barras43);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/** DV de bloco de arrecadação em módulo 11 (resto 0 ou 1 -> 0). */
function dvArrecadacaoMod11(bloco: string): number {
  const r = somaMod11(bloco);
  return r === 0 || r === 1 ? 0 : 11 - r;
}

function validarBancaria(d: string): boolean {
  // 47 dígitos: 3 campos com DV mod 10, DV geral e fator/valor.
  const campos: Array<[string, number]> = [
    [d.slice(0, 9), Number(d[9])],
    [d.slice(10, 20), Number(d[20])],
    [d.slice(21, 31), Number(d[31])]
  ];
  // slice(10,20) tem 10 dígitos e o DV está em d[20]; idem o terceiro (21..30, DV em 31).
  if (!campos.every(([bloco, dv]) => mod10(bloco) === dv)) return false;
  const barras43 = d.slice(0, 4) + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
  return dvGeralBancario(barras43) === Number(d[32]);
}

function validarArrecadacao(d: string): boolean {
  // 48 dígitos: 4 blocos de 11 + DV. 3º dígito: 6/7 -> mod 10; 8/9 -> mod 11.
  const ref = d[2];
  if (ref !== '6' && ref !== '7' && ref !== '8' && ref !== '9') return false;
  const usaMod10 = ref === '6' || ref === '7';
  for (let i = 0; i < 4; i++) {
    const bloco = d.slice(i * 12, i * 12 + 11);
    const dv = Number(d[i * 12 + 11]);
    const esperado = usaMod10 ? mod10(bloco) : dvArrecadacaoMod11(bloco);
    if (esperado !== dv) return false;
  }
  return true;
}

/**
 * Linha digitável de 47 dígitos (boleto bancário) ou 48 (arrecadação/convênio) com todos os
 * dígitos verificadores corretos. Devolve só os dígitos; qualquer outra coisa vira null.
 */
export function sanearLinhaDigitavel(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 100) return null;
  if (/[^\d\s.\-]/.test(raw)) return null;
  const d = raw.replace(/\D/g, '');
  if (d.length === 47) return validarBancaria(d) ? d : null;
  if (d.length === 48 && d[0] === '8') return validarArrecadacao(d) ? d : null;
  return null;
}

// ---------- Conjunto ----------

function sanearTipoDocumento(raw: unknown): TipoDocumento | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if (t === 'boleto') return 'boleto';
  if (t === 'nota') return 'nota';
  return null;
}

/** Aplica o saneamento a cada campo da resposta bruta da IA. Entrada inesperada -> tudo null. */
export function sanearExtracao(raw: unknown): ExtracaoSugerida {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EXTRACAO_VAZIA };
  const o = raw as Record<string, unknown>;

  const centavos = valorEmCentavos(o.valor);
  const linha = sanearLinhaDigitavel(o.linha_digitavel);
  let tipoDocumento = sanearTipoDocumento(o.tipo_documento);
  // Linha digitável válida é evidência forte de boleto, mesmo que o modelo tenha dito outra coisa.
  if (linha) tipoDocumento = 'boleto';

  return {
    tipo_documento: tipoDocumento,
    tipo_sugerido: tipoDocumento === 'boleto' ? 'Boleto' : tipoDocumento === 'nota' ? 'Sem Boleto' : null,
    fornecedor: sanearFornecedor(o.fornecedor),
    valor: centavos === null ? null : centavos / 100,
    dt_vencimento: sanearData(o.dt_vencimento),
    dt_documento: sanearData(o.dt_documento),
    linha_digitavel: linha
  };
}

/** Interpreta o texto devolvido pelo modelo como JSON; qualquer falha -> null. */
export function lerJsonDoModelo(texto: unknown): unknown {
  if (typeof texto !== 'string' || texto.length === 0 || texto.length > 20000) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}
