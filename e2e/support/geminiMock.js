/**
 * Gemini FALSO para o E2E: servidor HTTP local que imita POST /v1beta/models/<modelo>:generateContent e devolve
 * sempre a mesma leitura de boleto. A API do Google nunca é chamada. A API de teste aponta para ele por
 * GEMINI_BASE_URL (ver playwright.config.js). Datas relativas a hoje.
 */
const http = require('http');
const path = require('path');
const { linha47 } = require(path.join(__dirname, '..', '..', 'backend', 'test', 'helpers', 'linhas.js'));
const { GEMINI_MOCK_PORT, LINHA_GEMINI_MOCK } = require('./env');

const iso = (dias) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('gemini-mock ok');
  }
  req.resume();
  req.on('end', () => {
    const leitura = {
      tipo_documento: 'boleto',
      fornecedor: 'Distribuidora Sol',
      valor: 321.45,
      dt_vencimento: iso(10),
      dt_documento: iso(0),
      linha_digitavel: LINHA_GEMINI_MOCK || linha47(1)
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(leitura) }] } }] }));
  });
});

server.listen(GEMINI_MOCK_PORT, '127.0.0.1', () => console.log(`gemini-mock em http://127.0.0.1:${GEMINI_MOCK_PORT}`));
