/**
 * Geradores de linhas digitáveis VÁLIDAS para os testes, com cálculo de DV independente
 * do código de produção (para o teste não ficar circular).
 */
function mod10(base) {
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    const p = Number(base[i]) * peso;
    soma += p > 9 ? Math.floor(p / 10) + (p % 10) : p;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

function resto11(base) {
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += Number(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  return soma % 11;
}

const pad = (n, tam) => String(n).padStart(tam, '0').slice(-tam);

/** Linha de 47 dígitos válida; `seed` varia o conteúdo (campo livre e valor). */
function linha47(seed = 1) {
  const livre = pad(seed * 7919 + 13, 25);
  const fatorValor = '9999' + pad(seed * 31 + 1050, 10); // 14 dígitos
  const c1base = '3419' + livre.slice(0, 5);
  const c2base = livre.slice(5, 15);
  const c3base = livre.slice(15, 25);
  const barras43 = '3419' + fatorValor + livre;
  let dv = 11 - resto11(barras43);
  if (dv === 0 || dv === 10 || dv === 11) dv = 1;
  return c1base + mod10(c1base) + c2base + mod10(c2base) + c3base + mod10(c3base) + String(dv) + fatorValor;
}

/** Linha de 48 dígitos válida (arrecadação). modulo: 10 (id 6) ou 11 (id 8). */
function linha48(seed = 1, modulo = 10) {
  const id = modulo === 10 ? '6' : '8';
  const corpo = '8' + '1' + id + '1' + pad(seed * 104729 + 7, 40); // 44 dígitos
  let out = '';
  for (let i = 0; i < 4; i++) {
    const base = corpo.slice(i * 11, i * 11 + 11);
    let dv;
    if (modulo === 10) dv = mod10(base);
    else {
      const r = resto11(base);
      dv = r === 0 || r === 1 ? 0 : 11 - r;
    }
    out += base + String(dv);
  }
  return out;
}

/** Troca o último dígito da linha por outro, quebrando o DV. */
function corromper(linha) {
  const ultimo = Number(linha[linha.length - 1]);
  return linha.slice(0, -1) + String((ultimo + 1) % 10);
}

/** Troca o segundo dígito (DV do campo 1 deixa de bater). */
function corromperCampo1(linha) {
  const d = (Number(linha[1]) + 1) % 10;
  return linha[0] + String(d) + linha.slice(2);
}

module.exports = { linha47, linha48, corromper, corromperCampo1 };
