/**
 * Cadastro por imagem (Gemini), lançamento parecido, pagamento, permissão pode_marcar_pago e ocorrências.
 * O Gemini NUNCA é chamado: nos testes "mockados" POST /api/boletos/extrair é interceptado (page.route); nos testes
 * "reais" a API fala com o Gemini FALSO local (support/geminiMock.js) e grava no MinIO de teste (pulam sem MinIO).
 * Fluxo da imagem: extrair (devolve hash_sha256) -> POST /boletos -> POST /boletos/:id/anexo.
 */
const path = require('path');
const crypto = require('crypto');
const {
  test, expect, entrar, escolherRestaurante, abaNav, abrirCadastro, abrirResumo, tokenDe, lancar, rows, dataIso,
  minioPronto, objetoNoMinio, contarObjetos, limparBucket
} = require('../support/fixtures');
const { API_URL, LIMITE_DIARIO_E2E } = require('../support/env');
const { linha47 } = require(path.join(__dirname, '..', '..', 'backend', 'test', 'helpers', 'linhas.js'));

const LINHA = linha47(1);
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

const HASH_MOCK = 'a1'.repeat(32);

const extracao = (extra = {}) => ({
  hash_sha256: HASH_MOCK,
  tipo_documento: 'boleto',
  tipo_sugerido: 'Boleto',
  fornecedor: 'Distribuidora Sol',
  valor: 321.45,
  dt_vencimento: dataIso(10),
  dt_recebimento: dataIso(0),
  linha_digitavel: LINHA,
  campos_nao_lidos: [],
  avisos: [],
  ...extra
});

/** Intercepta a leitura por IA (inclui o preflight CORS: a API está em outra origem). Devolve as requisições vistas. */
async function mockExtrair(page, resposta) {
  const vistas = [];
  await page.route('**/api/boletos/extrair', async (route) => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': req.headers()['origin'] || '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'POST,OPTIONS'
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    vistas.push(req.postData() || '');
    const { status = 200, body, headers = {} } = typeof resposta === 'function' ? resposta(vistas.length) : resposta;
    return route.fulfill({ status, headers: { ...cors, ...headers }, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return vistas;
}

const escolherFoto = (page) =>
  page
    .locator('input[aria-label="Escolher imagem do boleto"]')
    .setInputFiles({ name: 'boleto.png', mimeType: 'image/png', buffer: PNG_1X1 });

/** CORS para respostas fabricadas de /boletos/:id/anexo (a API está em outra origem). */
const corsDe = (route) => ({
  'access-control-allow-origin': route.request().headers()['origin'] || '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'POST,GET,OPTIONS'
});

/**
 * Intercepta POST /boletos/:id/anexo. `responder(n, req)` devolve { status, body } para fabricar a resposta, ou null
 * para deixar passar para a API real. O preflight sempre passa para a API real. Devolve a lista de chamadas vistas.
 */
async function mockAnexo(page, responder) {
  const chamadas = [];
  await page.route('**/api/boletos/*/anexo', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    const id = Number(req.url().match(/boletos\/(\d+)\/anexo/)[1]);
    const existiaNoBanco = (await rows('SELECT 1 FROM boletos_notas WHERE id = $1', [id])).length === 1;
    chamadas.push({ id, existiaNoBanco, corpo: req.postDataBuffer() || Buffer.alloc(0) });
    const r = responder(chamadas.length, req);
    if (!r) return route.fallback();
    return route.fulfill({ status: r.status, headers: corsDe(route), contentType: 'application/json', body: JSON.stringify(r.body) });
  });
  return chamadas;
}

/** Esgota o teto diário de leituras por IA do usuário (a API de teste roda com EXTRAIR_LIMITE_DIARIO = LIMITE_DIARIO_E2E). */
const esgotarTetoDiario = (usuarioId) =>
  rows(
    `INSERT INTO boletos_extracoes_uso (usuario_id, dia, total) VALUES ($1, (now() AT TIME ZONE 'America/Sao_Paulo')::date, $2)
     ON CONFLICT (usuario_id, dia) DO UPDATE SET total = EXCLUDED.total`,
    [usuarioId, LIMITE_DIARIO_E2E]
  );

const semRolagemHorizontal = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1);

test.describe('celular (375x667, toque): leitura por imagem', () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ page }) => {
    await entrar(page, 'gerenteA');
    await abrirCadastro(page);
  });

  test('mostra "Ler com IA" e a galeria, e esconde o aviso de desktop', async ({ page }) => {
    await expect(page.locator('[data-boleto-ia="camera"]')).toBeVisible();
    await expect(page.locator('[data-boleto-ia="camera"]')).toContainText('Ler com IA');
    await expect(page.locator('[data-boleto-ia="galeria"]')).toBeVisible();
    await expect(page.locator('.boletos-ia-desktop')).toBeHidden();
    expect(await semRolagemHorizontal(page)).toBe(true);
  });

  test('pré-preenche o formulário, não salva sozinho, e o salvar cria o boleto e SÓ DEPOIS envia a imagem com o hash lido', async ({ page }) => {
    const vistas = await mockExtrair(page, { body: extracao() });
    const anexos = await mockAnexo(page, () => ({ status: 201, body: { ok: true } }));
    await escolherFoto(page);

    const form = page.locator('form.boletos-form--lancamento');
    await expect(page.getByText(/Dados lidos por IA/)).toBeVisible();
    await expect(form.locator('[data-boleto-campo="fornecedor"]')).toHaveValue('Distribuidora Sol');
    await expect(form.locator('[data-boleto-campo="valor"]')).toHaveValue('321,45');
    await expect(form.locator('[data-boleto-campo="vencimento"]')).toHaveValue(dataIso(10));
    await expect(form.locator('[data-boleto-campo="linha_digitavel"]')).toHaveValue(/^\d{5}\.\d{5} /);
    await expect(page.locator('.boletos-nao-lido')).toHaveCount(0);
    expect(vistas).toHaveLength(1);

    // nada foi salvo só por ler: nem boleto, nem anexo, nem chamada de anexo
    expect(await rows("SELECT 1 FROM boletos_notas WHERE fornecedor = 'Distribuidora Sol'")).toHaveLength(0);
    expect(await rows('SELECT 1 FROM boletos_anexos')).toHaveLength(0);
    expect(anexos).toHaveLength(0);

    await form.locator('[data-boleto-salvar]').click();
    const cartao = page.locator('.boletos-cartao', { hasText: 'Distribuidora Sol' });
    await expect(cartao).toBeVisible();
    await expect(cartao.locator('[data-boleto-copiar]')).toBeVisible();

    const [b] = await rows("SELECT id, restaurante_id, usuario_id, valor, linha_digitavel, fornecedor FROM boletos_notas WHERE fornecedor = 'Distribuidora Sol'");
    expect(b).toMatchObject({ restaurante_id: 1, usuario_id: 2, linha_digitavel: LINHA });
    expect(Number(b.valor)).toBe(321.45);
    // a imagem foi enviada uma vez, para o boleto recém-criado (que já existia no banco), com o hash da leitura
    await expect.poll(() => anexos.length).toBe(1);
    expect(anexos[0]).toMatchObject({ id: b.id, existiaNoBanco: true });
    const corpo = anexos[0].corpo.toString('latin1');
    expect(corpo).toContain('name="hash_sha256"');
    expect(corpo).toContain(HASH_MOCK);
    expect(corpo).toContain('name="imagem"');
    await expect(page.locator('[data-boleto-anexo-falha]')).toHaveCount(0);
    expect(await semRolagemHorizontal(page)).toBe(true);
  });

  test('falha 503 do anexo: o boleto fica salvo, a tela avisa e "Enviar imagem novamente" tenta de novo (mock)', async ({ page }) => {
    await mockExtrair(page, { body: extracao() });
    const anexos = await mockAnexo(page, (n) =>
      n === 1 ? { status: 503, body: { error: 'Armazenamento de imagens não configurado' } } : { status: 201, body: { ok: true } }
    );
    await escolherFoto(page);
    await expect(page.getByText(/Dados lidos por IA/)).toBeVisible();
    await page.locator('[data-boleto-salvar]').click();

    const alerta = page.locator('[data-boleto-anexo-falha]');
    await expect(alerta).toBeVisible();
    const [b] = await rows("SELECT id FROM boletos_notas WHERE fornecedor = 'Distribuidora Sol'");
    await expect(page.locator(`[data-boleto-anexo-falha="${b.id}"]`)).toBeVisible();
    await expect(alerta).toContainText('O lançamento foi salvo, mas a imagem não foi anexada');
    await expect(alerta).toContainText('Armazenamento de imagens não configurado');
    await expect(page.locator('.boletos-cartao', { hasText: 'Distribuidora Sol' })).toBeVisible();
    await expect(alerta.getByRole('button', { name: 'Descartar imagem' })).toBeVisible();
    expect(await semRolagemHorizontal(page)).toBe(true);

    await alerta.getByRole('button', { name: 'Enviar imagem novamente' }).click();
    await expect(alerta).toHaveCount(0);
    expect(anexos).toHaveLength(2);
    expect(anexos.every((c) => c.id === b.id && c.corpo.toString('latin1').includes(HASH_MOCK))).toBe(true);
    // reenviar a imagem não duplica o lançamento
    expect(await rows("SELECT 1 FROM boletos_notas WHERE fornecedor = 'Distribuidora Sol'")).toHaveLength(1);
  });

  test('falha do anexo + "Descartar imagem": o boleto permanece sem imagem e nada mais é enviado (mock)', async ({ page }) => {
    await mockExtrair(page, { body: extracao() });
    const anexos = await mockAnexo(page, () => ({ status: 503, body: { error: 'Armazenamento de imagens não configurado' } }));
    await escolherFoto(page);
    await page.locator('[data-boleto-salvar]').click();

    const alerta = page.locator('[data-boleto-anexo-falha]');
    await expect(alerta).toBeVisible();
    await alerta.getByRole('button', { name: 'Descartar imagem' }).click();
    await expect(alerta).toHaveCount(0);
    expect(anexos).toHaveLength(1);
    expect(await rows("SELECT 1 FROM boletos_notas WHERE fornecedor = 'Distribuidora Sol'")).toHaveLength(1);
    expect(await rows('SELECT 1 FROM boletos_anexos')).toHaveLength(0);
    await expect(page.locator('.boletos-cartao', { hasText: 'Distribuidora Sol' }).locator('[data-boleto-anexo]')).toHaveCount(0);
  });

  test('anexo 409 (já tem imagem): sem "Enviar imagem novamente", só "Fechar" (mock)', async ({ page }) => {
    await mockExtrair(page, { body: extracao() });
    await mockAnexo(page, () => ({ status: 409, body: { error: 'Este lançamento já tem imagem.' } }));
    await escolherFoto(page);
    await page.locator('[data-boleto-salvar]').click();

    const alerta = page.locator('[data-boleto-anexo-falha]');
    await expect(alerta).toContainText('Este lançamento já tem imagem.');
    await expect(alerta.getByRole('button', { name: 'Enviar imagem novamente' })).toHaveCount(0);
    await alerta.getByRole('button', { name: 'Fechar' }).click();
    await expect(alerta).toHaveCount(0);
  });

  test('o cadastro manual (sem ler imagem) nunca chama /anexo', async ({ page }) => {
    const anexos = await mockAnexo(page, () => ({ status: 201, body: {} }));
    await lancar(page, { descricao: 'Manual Sem Foto', valor: '12,00', vencimento: dataIso(5) });
    await expect(page.locator('.boletos-cartao', { hasText: 'Manual Sem Foto' })).toBeVisible();
    expect(anexos).toHaveLength(0);
    expect(await rows('SELECT 1 FROM boletos_anexos')).toHaveLength(0);
  });

  test('teto diário (429 LIMITE_DIARIO, API real): desabilita câmera e galeria, sem "Tentar de novo", e o cadastro manual segue', async ({ page }) => {
    await esgotarTetoDiario(2);
    const anexos = await mockAnexo(page, () => ({ status: 201, body: {} }));
    await escolherFoto(page);

    await expect(page.locator('.boletos-ia-erro')).toContainText('Limite diário de leituras por IA atingido');
    await expect(page.locator('.boletos-ia-erro')).toContainText('Preencha o cadastro manualmente');
    await expect(page.locator('[data-boleto-ia="camera"]')).toBeDisabled();
    await expect(page.locator('[data-boleto-ia="galeria"]')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toHaveCount(0);
    await expect(page.getByText(/Dados lidos por IA/)).toHaveCount(0);
    expect(await semRolagemHorizontal(page)).toBe(true);
    // o servidor não passou do teto
    expect((await rows('SELECT total FROM boletos_extracoes_uso WHERE usuario_id = 2'))[0].total).toBe(LIMITE_DIARIO_E2E);

    // cadastro manual continua funcionando, sem imagem
    await lancar(page, { descricao: 'Manual Depois do Teto', valor: '30,00', vencimento: dataIso(6) });
    await expect(page.locator('.boletos-cartao', { hasText: 'Manual Depois do Teto' })).toBeVisible();
    expect(anexos).toHaveLength(0);
  });

  test('teto diário: depois de recarregar a tela os botões voltam, mas a próxima leitura é negada de novo pelo servidor', async ({ page }) => {
    await esgotarTetoDiario(2);
    await escolherFoto(page);
    await expect(page.locator('[data-boleto-ia="camera"]')).toBeDisabled();

    await page.reload();
    await abrirCadastro(page);
    await expect(page.locator('[data-boleto-ia="camera"]')).toBeEnabled();
    await escolherFoto(page);
    await expect(page.locator('.boletos-ia-erro')).toContainText('Limite diário');
    await expect(page.locator('[data-boleto-ia="camera"]')).toBeDisabled();
    expect((await rows('SELECT total FROM boletos_extracoes_uso WHERE usuario_id = 2'))[0].total).toBe(LIMITE_DIARIO_E2E);
  });

  test('429 do rate limit por minuto (sem o código LIMITE_DIARIO) continua permitindo "Tentar de novo" e não desabilita os botões', async ({ page }) => {
    await mockExtrair(page, { status: 429, headers: { 'retry-after': '30' }, body: { error: 'Muitas leituras de imagem em pouco tempo.' } });
    await escolherFoto(page);
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
    await expect(page.locator('[data-boleto-ia="camera"]')).toBeEnabled();
    await expect(page.locator('[data-boleto-ia="galeria"]')).toBeEnabled();
  });

  test('destaca os campos não lidos e o destaque some ao preencher', async ({ page }) => {
    await mockExtrair(page, {
      body: extracao({ fornecedor: null, valor: null, campos_nao_lidos: ['fornecedor', 'valor'] })
    });
    await escolherFoto(page);

    await expect(page.getByText(/Dados lidos por IA/)).toBeVisible();
    await expect(page.locator('.boletos-nao-lido')).toHaveCount(2);
    await expect(page.locator('label.boletos-campo--nao-lido')).toHaveCount(2);

    await page.locator('[data-boleto-campo="valor"]').fill('10,00');
    await expect(page.locator('.boletos-nao-lido')).toHaveCount(1);
    await page.locator('[data-boleto-campo="fornecedor"]').fill('Quem Eu Quiser');
    await expect(page.locator('.boletos-nao-lido')).toHaveCount(0);
  });

  test('tipo_sugerido null: avisa e pede para escolher o tipo; escolher remove o aviso', async ({ page }) => {
    await mockExtrair(page, {
      body: extracao({ tipo_sugerido: null, tipo_documento: 'outro', linha_digitavel: null, avisos: ['Imagem não identificada como boleto.'] })
    });
    await escolherFoto(page);

    await expect(page.getByText('Imagem não identificada como boleto: escolha o tipo')).toBeVisible();
    await expect(page.locator('.boletos-ia-avisos')).toContainText('Imagem não identificada como boleto.');
    await page.locator('[data-boleto-campo="tipo"]').selectOption('Sem Boleto');
    await expect(page.getByText('Imagem não identificada como boleto: escolha o tipo')).toHaveCount(0);
    await expect(page.locator('[data-boleto-campo="linha_digitavel"]')).toHaveCount(0);
  });

  test('nota: sugere "Sem Boleto" e esconde vencimento e linha digitável', async ({ page }) => {
    await mockExtrair(page, {
      body: extracao({ tipo_documento: 'nota', tipo_sugerido: 'Sem Boleto', dt_vencimento: null, dt_recebimento: null, linha_digitavel: null })
    });
    await escolherFoto(page);
    await expect(page.locator('[data-boleto-campo="tipo"]')).toHaveValue('Sem Boleto');
    await expect(page.locator('[data-boleto-campo="vencimento"]')).toHaveCount(0);
    await expect(page.locator('[data-boleto-campo="linha_digitavel"]')).toHaveCount(0);
  });

  test('imagem repetida: avisa e "Ler mesmo assim" reenvia com forcar_repetida', async ({ page }) => {
    const vistas = await mockExtrair(page, (n) =>
      n === 1
        ? { body: extracao({ tipo_sugerido: null, aviso_imagem_repetida: true, avisos: ['Esta imagem já foi cadastrada.'] }) }
        : { body: extracao() }
    );
    await escolherFoto(page);
    await expect(page.getByText(/já foi cadastrada neste restaurante/)).toBeVisible();
    await expect(page.getByText(/Dados lidos por IA/)).toHaveCount(0);

    await page.getByRole('button', { name: 'Ler mesmo assim' }).click();
    await expect(page.getByText(/Dados lidos por IA/)).toBeVisible();
    expect(vistas).toHaveLength(2);
    expect(vistas[0]).not.toContain('forcar_repetida');
    expect(vistas[1]).toContain('forcar_repetida');
  });

  test('falha da IA (502): mostra o erro, não preenche e oferece tentar de novo', async ({ page }) => {
    await mockExtrair(page, { status: 502, body: { error: 'Não foi possível ler a imagem agora. Tente novamente ou preencha manualmente.' } });
    await escolherFoto(page);
    await expect(page.locator('.boletos-ia-erro')).toContainText('Não foi possível ler a imagem agora');
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
    await expect(page.locator('[data-boleto-campo="valor"]')).toHaveValue('');
  });

  test('limite de leituras (429): mostra a mensagem do servidor e deixa tentar de novo', async ({ page }) => {
    // O Retry-After não aparece aqui de propósito: sem Access-Control-Expose-Headers o navegador não o entrega
    // ao JS em produção (front e API em hosts diferentes). Ver bug reportado em backend/test/boletosExtrair.test.js.
    await mockExtrair(page, { status: 429, headers: { 'retry-after': '30' }, body: { error: 'Muitas leituras de imagem em pouco tempo.' } });
    await escolherFoto(page);
    await expect(page.locator('.boletos-ia-erro')).toContainText('Muitas leituras de imagem em pouco tempo.');
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  });

  test('lançamento parecido (409 do servidor): modal; cancelar não grava; "cadastrar mesmo assim" grava', async ({ page }) => {
    await rows(
      `INSERT INTO boletos_notas (restaurante_id, usuario_id, dt_recebimento, dt_vencimento, descricao, valor, tipo, fornecedor, fornecedor_norm)
       VALUES (1, 2, $1, $2, 'Padaria Sol', 20, 'Boleto', 'Padaria Sol', 'padaria sol')`,
      [dataIso(0), dataIso(6)]
    );
    const form = page.locator('form.boletos-form--lancamento');
    await form.locator('[data-boleto-campo="recebimento"]').fill(dataIso(0));
    await form.locator('[data-boleto-campo="vencimento"]').fill(dataIso(9));
    await form.locator('[data-boleto-campo="fornecedor"]').fill('PADARIA  sol');
    await form.locator('[data-boleto-campo="descricao"]').fill('Pães do dia');
    await form.locator('[data-boleto-campo="valor"]').fill('35,00');
    await form.locator('[data-boleto-salvar]').click();

    const modal = page.locator('.boletos-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Já existe um lançamento parecido');
    await expect(modal).toContainText('Padaria Sol');

    await modal.getByRole('button', { name: 'Cancelar' }).click();
    await expect(modal).toHaveCount(0);
    expect(await rows("SELECT 1 FROM boletos_notas WHERE descricao = 'Pães do dia'")).toHaveLength(0);
    // o formulário continua preenchido
    await expect(form.locator('[data-boleto-campo="descricao"]')).toHaveValue('Pães do dia');

    await form.locator('[data-boleto-salvar]').click();
    await modal.getByRole('button', { name: 'Cadastrar mesmo assim' }).click();
    await expect(modal).toHaveCount(0);
    await expect(page.locator('.boletos-cartao', { hasText: 'Pães do dia' })).toBeVisible();
    const [b] = await rows("SELECT fornecedor, restaurante_id FROM boletos_notas WHERE descricao = 'Pães do dia'");
    expect(b).toMatchObject({ fornecedor: 'PADARIA sol', restaurante_id: 1 });
  });

  test('linha digitável de outro restaurante: erro genérico na tela, sem vazar dados, e a ocorrência fica para o admin', async ({ page }) => {
    await rows(
      `INSERT INTO boletos_notas (restaurante_id, usuario_id, dt_recebimento, dt_vencimento, descricao, valor, tipo, fornecedor, linha_digitavel)
       VALUES (2, 3, $1, $2, 'Segredo do B', 90, 'Boleto', 'Fornecedor Secreto B', $3)`,
      [dataIso(0), dataIso(6), LINHA]
    );
    const form = page.locator('form.boletos-form--lancamento');
    await form.locator('[data-boleto-campo="recebimento"]').fill(dataIso(0));
    await form.locator('[data-boleto-campo="vencimento"]').fill(dataIso(9));
    await form.locator('[data-boleto-campo="descricao"]').fill('Tentativa');
    await form.locator('[data-boleto-campo="valor"]').fill('35,00');
    await form.locator('[data-boleto-campo="linha_digitavel"]').fill(LINHA);
    await form.locator('[data-boleto-salvar]').click();

    await expect(page.getByText('Esta linha digitável já está cadastrada.')).toBeVisible();
    await expect(page.getByText(/Segredo|Secreto|Restaurante B/)).toHaveCount(0);
    expect(await rows("SELECT 1 FROM boletos_notas WHERE descricao = 'Tentativa'")).toHaveLength(0);
    const oc = await rows('SELECT usuario_id, restaurante_id, linha_digitavel, visto_em FROM boletos_ocorrencias');
    expect(oc).toEqual([{ usuario_id: 2, restaurante_id: 1, linha_digitavel: LINHA, visto_em: null }]);
  });

  test('cartões com linha digitável longa e botão de copiar não geram rolagem horizontal', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await rows(
      `INSERT INTO boletos_notas (restaurante_id, usuario_id, dt_recebimento, dt_vencimento, descricao, valor, tipo, fornecedor, linha_digitavel)
       VALUES (1, 2, $1, $2, 'Descricao muito comprida de um fornecedor com nome enorme', 1234567.89, 'Boleto',
               'Distribuidora Internacional de Alimentos e Bebidas Ltda', $3)`,
      [dataIso(0), dataIso(6), LINHA]
    );
    await page.reload();
    await abrirCadastro(page);

    const cartao = page.locator('.boletos-cartao', { hasText: 'Distribuidora Internacional' });
    await expect(cartao).toBeVisible();
    expect(await semRolagemHorizontal(page)).toBe(true);

    await cartao.locator('[data-boleto-copiar]').click();
    await expect(cartao.locator('[data-boleto-copiar]')).toContainText('Copiado');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LINHA);

    await abrirResumo(page);
    expect(await semRolagemHorizontal(page)).toBe(true);
  });

  test('"Ver imagem" abre a imagem do boleto em um modal e fecha', async ({ page }) => {
    await rows(
      `INSERT INTO boletos_anexos (boleto_id, restaurante_id, usuario_id, storage_chave, mime, tamanho_bytes, hash_sha256)
       VALUES (10, 1, 2, '1/' || repeat('b', 32) || '.png', 'image/png', 70, repeat('e', 64))`
    );
    await page.route('**/api/boletos/10/anexo', (route) => {
      const origin = route.request().headers()['origin'] || '*';
      const cors = { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization,content-type' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      return route.fulfill({ status: 200, headers: cors, contentType: 'image/png', body: PNG_1X1 });
    });
    await page.reload();
    await abrirCadastro(page);

    await page.locator('[data-boleto-anexo="10"]').click();
    const modal = page.locator('.boletos-modal');
    await expect(modal.locator('img')).toBeVisible();
    await modal.getByRole('button', { name: 'Fechar' }).click();
    await expect(modal).toHaveCount(0);
  });
});

/**
 * Imagem REAL de ponta a ponta: navegador -> API real -> Gemini FALSO local -> MinIO de teste. Pula sem MinIO.
 * O hash enviado ao /anexo é o devolvido pelo /extrair (SHA-256 da imagem comprimida pelo navegador).
 */
async function pularSemMinio() {
  const pronto = await minioPronto();
  test.skip(!pronto, 'MinIO de teste indisponível (veja e2e/README.md)');
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

test.describe('celular (375x667): imagem real (API + MinIO)', () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

  test.beforeAll(pularSemMinio);
  test.beforeEach(async ({ page }) => {
    await limparBucket();
    await entrar(page, 'gerenteA');
    await abrirCadastro(page);
  });
  test.afterAll(async () => {
    if (await minioPronto()) await limparBucket();
  });

  test('ler -> salvar -> a imagem vai ao MinIO com os mesmos bytes do hash, e "Ver imagem" a exibe', async ({ page }) => {
    await escolherFoto(page);
    const form = page.locator('form.boletos-form--lancamento');
    await expect(page.getByText(/Dados lidos por IA/)).toBeVisible();
    await expect(form.locator('[data-boleto-campo="fornecedor"]')).toHaveValue('Distribuidora Sol');
    expect(await rows('SELECT 1 FROM boletos_anexos')).toHaveLength(0);
    expect(await contarObjetos(1)).toBe(0);

    await form.locator('[data-boleto-salvar]').click();
    const cartao = page.locator('.boletos-cartao', { hasText: 'Distribuidora Sol' });
    await expect(cartao).toBeVisible();
    await expect(cartao.locator('[data-boleto-anexo]')).toBeVisible();
    await expect(page.locator('[data-boleto-anexo-falha]')).toHaveCount(0);

    const [b] = await rows("SELECT id FROM boletos_notas WHERE fornecedor = 'Distribuidora Sol'");
    const [a] = await rows('SELECT * FROM boletos_anexos WHERE boleto_id = $1', [b.id]);
    expect(a).toMatchObject({ restaurante_id: 1, usuario_id: 2 });
    expect(['image/jpeg', 'image/png', 'image/webp']).toContain(a.mime);
    expect(a.storage_chave).toMatch(/^1\/[a-f0-9]{32}\.(jpg|png|webp)$/);
    const bytes = await objetoNoMinio(a.storage_chave);
    expect(bytes).not.toBeNull();
    expect(bytes.length).toBe(a.tamanho_bytes);
    expect(sha256(bytes)).toBe(a.hash_sha256);

    await cartao.locator('[data-boleto-anexo]').click();
    const modal = page.locator('.boletos-modal');
    await expect(modal.locator('img')).toBeVisible();
    expect(await modal.locator('img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
    await modal.getByRole('button', { name: 'Fechar' }).click();
    await expect(modal).toHaveCount(0);
    expect(await semRolagemHorizontal(page)).toBe(true);
  });

  test('falha 503 no anexo (1ª tentativa) e depois "Enviar imagem novamente" grava no MinIO; o boleto não duplica', async ({ page }) => {
    const anexos = await mockAnexo(page, (n) => (n === 1 ? { status: 503, body: { error: 'Armazenamento de imagens não configurado' } } : null));
    await escolherFoto(page);
    await expect(page.getByText(/Dados lidos por IA/)).toBeVisible();
    await page.locator('[data-boleto-salvar]').click();

    const alerta = page.locator('[data-boleto-anexo-falha]');
    await expect(alerta).toContainText('O lançamento foi salvo, mas a imagem não foi anexada');
    expect(await rows('SELECT 1 FROM boletos_anexos')).toHaveLength(0);
    expect(await contarObjetos(1)).toBe(0);
    const [b] = await rows("SELECT id FROM boletos_notas WHERE fornecedor = 'Distribuidora Sol'");

    await alerta.getByRole('button', { name: 'Enviar imagem novamente' }).click();
    await expect(alerta).toHaveCount(0);
    expect(anexos).toHaveLength(2);
    const [a] = await rows('SELECT storage_chave, hash_sha256 FROM boletos_anexos WHERE boleto_id = $1', [b.id]);
    expect(sha256(await objetoNoMinio(a.storage_chave))).toBe(a.hash_sha256);
    expect(await rows("SELECT 1 FROM boletos_notas WHERE fornecedor = 'Distribuidora Sol'")).toHaveLength(1);
    await expect(page.locator('.boletos-cartao', { hasText: 'Distribuidora Sol' }).locator('[data-boleto-anexo]')).toBeVisible();
  });

  test('hash adulterado no envio: a API recusa (400), nada vai ao MinIO e "Enviar imagem novamente" reenvia com o hash correto', async ({ page }) => {
    // Adultera o hash no corpo do multipart da 1ª tentativa: a API real responde 400 e o front mostra o erro.
    let n = 0;
    await page.route('**/api/boletos/*/anexo', async (route) => {
      const req = route.request();
      if (req.method() !== 'POST') return route.fallback();
      n += 1;
      if (n > 1) return route.fallback();
      const corpo = req.postDataBuffer().toString('latin1').replace(/[a-f0-9]{64}/, 'f'.repeat(64));
      return route.continue({ postData: Buffer.from(corpo, 'latin1') });
    });
    await escolherFoto(page);
    await page.locator('[data-boleto-salvar]').click();

    const alerta = page.locator('[data-boleto-anexo-falha]');
    await expect(alerta).toContainText('não confere');
    expect(await rows('SELECT 1 FROM boletos_anexos')).toHaveLength(0);
    expect(await contarObjetos(1)).toBe(0);
    expect(await rows("SELECT 1 FROM boletos_notas WHERE fornecedor = 'Distribuidora Sol'")).toHaveLength(1);
    // "Enviar imagem novamente" reenvia com o hash CORRETO guardado no front
    await alerta.getByRole('button', { name: 'Enviar imagem novamente' }).click();
    await expect(alerta).toHaveCount(0);
    expect(await rows('SELECT 1 FROM boletos_anexos')).toHaveLength(1);
    expect(await contarObjetos(1)).toBe(1);
  });
});

test.describe('desktop: imagem real (API + MinIO)', () => {
  test.beforeAll(pularSemMinio);
  test.beforeEach(async () => limparBucket());
  test.afterAll(async () => {
    if (await minioPronto()) await limparBucket();
  });

  const anexarPelaApi = async (request, usuario, boletoId, buffer) => {
    const token = await tokenDe(request, usuario);
    return request.post(`${API_URL}/boletos/${boletoId}/anexo`, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: { hash_sha256: sha256(buffer), imagem: { name: 'b.png', mimeType: 'image/png', buffer } }
    });
  };

  test('"Ver imagem" do boleto exibe a imagem guardada no MinIO; o usuário do outro restaurante não acessa', async ({ page, request }) => {
    expect((await anexarPelaApi(request, 'gerenteA', 10, PNG_1X1)).status()).toBe(201);
    const [a] = await rows('SELECT storage_chave FROM boletos_anexos WHERE boleto_id = 10');
    expect((await objetoNoMinio(a.storage_chave)).equals(PNG_1X1)).toBe(true);

    // IDOR direto na API: B não lê nem anexa no boleto do A, e o bucket não muda
    const tokenB = await tokenDe(request, 'gerenteB');
    const get = await request.get(`${API_URL}/boletos/10/anexo`, { headers: { Authorization: `Bearer ${tokenB}` } });
    expect(get.status()).toBe(403);
    const antes = await contarObjetos(1);
    expect((await anexarPelaApi(request, 'gerenteB', 10, PNG_1X1)).status()).toBe(403);
    expect(await contarObjetos(1)).toBe(antes);

    await entrar(page, 'gerenteA');
    await abrirCadastro(page);
    await page.locator('[data-boleto-anexo="10"]').click();
    const modal = page.locator('.boletos-modal');
    await expect(modal.locator('img')).toBeVisible();
    expect(await modal.locator('img').evaluate((img) => img.naturalWidth)).toBe(1);
    await modal.getByRole('button', { name: 'Fechar' }).click();
    await expect(modal).toHaveCount(0);
  });

  test('objeto sumiu do MinIO: "Ver imagem" mostra "Imagem não encontrada." e o resto da tela segue', async ({ page, request }) => {
    expect((await anexarPelaApi(request, 'gerenteA', 10, PNG_1X1)).status()).toBe(201);
    await limparBucket();
    await entrar(page, 'gerenteA');
    await abrirCadastro(page);
    await page.locator('[data-boleto-anexo="10"]').click();
    await expect(page.getByText('Imagem não encontrada.')).toBeVisible();
    await expect(page.locator('tr', { hasText: 'Fornecedor A' })).toBeVisible();
  });

  test('boleto pago + gerente: a API recusa anexar (403) e o admin consegue; nada de objeto órfão', async ({ request }) => {
    await rows('UPDATE boletos_notas SET pago = true, pago_em = now(), pago_por_usuario_id = 1 WHERE id = 10');
    expect((await anexarPelaApi(request, 'gerenteA', 10, PNG_1X1)).status()).toBe(403);
    expect(await contarObjetos(1)).toBe(0);
    expect((await anexarPelaApi(request, 'admin', 10, PNG_1X1)).status()).toBe(201);
    expect(await contarObjetos(1)).toBe(1);
  });
});

test.describe('desktop: leitura por imagem indisponível', () => {
  test('esconde os botões de IA e mostra só o aviso de que a leitura é no celular', async ({ page }) => {
    await entrar(page, 'gerenteA');
    await abrirCadastro(page);
    await expect(page.locator('[data-boleto-ia="camera"]')).toBeHidden();
    await expect(page.locator('[data-boleto-ia="galeria"]')).toBeHidden();
    await expect(page.locator('.boletos-ia-desktop')).toBeVisible();
    await expect(page.locator('.boletos-ia-desktop')).toContainText('disponível no celular');
  });
});

test.describe('pagamento de boletos', () => {
  test('sem a permissão o usuário não vê "Marcar como pago", mas vê a situação "Em aberto"', async ({ page }) => {
    await entrar(page, 'gerenteA');
    await abrirCadastro(page);
    const linha = page.locator('tr', { hasText: 'Fornecedor A' });
    await expect(linha).toContainText('Em aberto');
    await expect(linha.getByRole('button', { name: 'Marcar como pago' })).toHaveCount(0);
    await expect(page.locator('.boletos-selo--pago')).toHaveCount(0);
  });

  test('com a permissão (e vínculo) marca como pago: selo na tela e gravado no banco com quem pagou', async ({ page }) => {
    await rows('UPDATE usuarios SET pode_marcar_pago = true WHERE id = 2');
    await entrar(page, 'gerenteA');
    await abrirCadastro(page);
    const linha = page.locator('tr', { hasText: 'Fornecedor A' });
    await linha.getByRole('button', { name: 'Marcar como pago' }).click();

    await expect(linha.locator('.boletos-selo--pago')).toBeVisible();
    await expect(linha.getByRole('button', { name: 'Marcar como pago' })).toHaveCount(0);
    // quem só pode marcar não consegue desfazer
    await expect(linha.getByRole('button', { name: 'Desfazer pagamento' })).toHaveCount(0);
    const [b] = await rows('SELECT pago, pago_em, pago_por_usuario_id FROM boletos_notas WHERE id = 10');
    expect(b.pago).toBe(true);
    expect(b.pago_em).not.toBeNull();
    expect(b.pago_por_usuario_id).toBe(2);
  });

  test('o usuário do restaurante B, mesmo com a permissão, não vê nem consegue pagar o boleto do A', async ({ page, request }) => {
    await rows('UPDATE usuarios SET pode_marcar_pago = true WHERE id = 3');
    await entrar(page, 'gerenteB');
    await abrirCadastro(page);
    await expect(page.locator('tr', { hasText: 'Fornecedor A' })).toHaveCount(0);
    await expect(page.locator('tr', { hasText: 'Fornecedor B' }).getByRole('button', { name: 'Marcar como pago' })).toBeVisible();

    const token = await tokenDe(request, 'gerenteB');
    const r = await request.post(`${API_URL}/boletos/10/pago`, { headers: { Authorization: `Bearer ${token}` } });
    expect(r.status()).toBe(403);
    const [b] = await rows('SELECT pago FROM boletos_notas WHERE id = 10');
    expect(b.pago).toBe(false);
  });

  test('admin desfaz o pagamento: motivo é obrigatório (mínimo 5) e fica registrado', async ({ page }) => {
    await rows('UPDATE boletos_notas SET pago = true, pago_em = now(), pago_por_usuario_id = 2 WHERE id = 10');
    await entrar(page, 'admin');
    await escolherRestaurante(page, 'Restaurante A');
    await abaNav(page, 'Boletos e notas').click();
    await abrirCadastro(page);

    const linha = page.locator('tr', { hasText: 'Fornecedor A' });
    await expect(linha.locator('.boletos-selo--pago')).toBeVisible();
    await linha.getByRole('button', { name: 'Desfazer pagamento' }).click();

    const modal = page.locator('.boletos-modal');
    await expect(modal).toBeVisible();
    await modal.locator('textarea').fill('abc');
    await modal.getByRole('button', { name: 'Desfazer pagamento' }).click();
    await expect(modal.getByRole('alert')).toContainText('5 a 500');
    expect((await rows('SELECT pago FROM boletos_notas WHERE id = 10'))[0].pago).toBe(true);

    await modal.locator('textarea').fill('Pago em duplicidade');
    await modal.getByRole('button', { name: 'Desfazer pagamento' }).click();
    await expect(modal).toHaveCount(0);
    await expect(linha.locator('.boletos-selo--pago')).toHaveCount(0);
    await expect(linha).toContainText('Em aberto');

    const [b] = await rows(
      'SELECT pago, pago_em, pagamento_desfeito_por_usuario_id, pagamento_desfeito_motivo FROM boletos_notas WHERE id = 10'
    );
    expect(b).toMatchObject({ pago: false, pago_em: null, pagamento_desfeito_por_usuario_id: 1, pagamento_desfeito_motivo: 'Pago em duplicidade' });
  });

  test('admin marca como pago sem precisar da flag', async ({ page }) => {
    await entrar(page, 'admin');
    await escolherRestaurante(page, 'Restaurante B');
    await abaNav(page, 'Boletos e notas').click();
    await abrirCadastro(page);
    const linha = page.locator('tr', { hasText: 'Fornecedor B' });
    await linha.getByRole('button', { name: 'Marcar como pago' }).click();
    await expect(linha.locator('.boletos-selo--pago')).toBeVisible();
    expect((await rows('SELECT pago, pago_por_usuario_id FROM boletos_notas WHERE id = 20'))[0]).toEqual({ pago: true, pago_por_usuario_id: 1 });
  });
});

/** Boleto pago é travado para não-admin: botões desabilitados, aviso e 403 direto na API. Desktop e celular. */
const VIEWPORTS_TRAVA = [
  { nome: 'desktop', opcoes: {}, item: (page) => page.locator('tr', { hasText: 'Fornecedor A' }) },
  {
    nome: 'celular 375x667',
    opcoes: { viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true },
    item: (page) => page.locator('.boletos-cartao', { hasText: 'Fornecedor A' })
  }
];

for (const { nome, opcoes, item } of VIEWPORTS_TRAVA) {
  test.describe(`boleto pago travado para não-admin (${nome})`, () => {
    test.use(opcoes);

    test.beforeEach(async () => {
      await rows('UPDATE boletos_notas SET pago = true, pago_em = now(), pago_por_usuario_id = 1 WHERE id = 10');
    });

    test('Editar/Excluir desabilitados com o aviso; a API recusa PUT e DELETE (403) e o banco não muda', async ({ page, request }) => {
      await entrar(page, 'gerenteA');
      await abrirCadastro(page);

      const linha = item(page);
      await expect(linha.locator('.boletos-selo--pago')).toBeVisible();
      await expect(linha.getByRole('button', { name: 'Editar' })).toBeDisabled();
      await expect(linha.getByRole('button', { name: 'Excluir' })).toBeDisabled();
      await expect(linha.getByText('Pago: só o administrador altera')).toBeVisible();
      // quem não é admin também não desfaz
      await expect(linha.getByRole('button', { name: 'Desfazer pagamento' })).toHaveCount(0);
      if (nome !== 'desktop') {
        expect(await semRolagemHorizontal(page)).toBe(true);
      }

      // o front não é a barreira: direto na API o servidor recusa
      const token = await tokenDe(request, 'gerenteA');
      const headers = { Authorization: `Bearer ${token}` };
      const put = await request.put(`${API_URL}/boletos/10`, { headers, data: { descricao: 'Alterado por fora' } });
      expect(put.status()).toBe(403);
      expect((await put.json()).error).toMatch(/Boleto pago: peça ao administrador/);
      const del = await request.delete(`${API_URL}/boletos/10`, { headers });
      expect(del.status()).toBe(403);
      expect((await del.json()).error).toMatch(/Boleto pago: peça ao administrador/);

      const [b] = await rows('SELECT descricao, deleted_at, pago FROM boletos_notas WHERE id = 10');
      expect(b).toEqual({ descricao: 'Fornecedor A', deleted_at: null, pago: true });
    });

    test('o admin vê Editar/Excluir habilitados no mesmo boleto pago, sem o aviso', async ({ page }) => {
      await entrar(page, 'admin');
      await escolherRestaurante(page, 'Restaurante A');
      await abaNav(page, 'Boletos e notas').click();
      await abrirCadastro(page);

      const linha = item(page);
      await expect(linha.locator('.boletos-selo--pago')).toBeVisible();
      await expect(linha.getByRole('button', { name: 'Editar' })).toBeEnabled();
      await expect(linha.getByRole('button', { name: 'Excluir' })).toBeEnabled();
      await expect(linha.getByText('Pago: só o administrador altera')).toHaveCount(0);
    });
  });
}

test.describe('admin: permissão "pode marcar como pago"', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, 'admin');
    await escolherRestaurante(page, 'Restaurante A');
    await abaNav(page, 'Usuários').click();
  });

  test('marcar e desmarcar a permissão de um usuário grava no banco', async ({ page }) => {
    const caixa = page.getByLabel('Pode marcar boleto como pago: gerenteA');
    await expect(caixa).not.toBeChecked();
    await caixa.check();
    await expect.poll(async () => (await rows('SELECT pode_marcar_pago FROM usuarios WHERE id = 2'))[0].pode_marcar_pago).toBe(true);
    await expect(caixa).toBeChecked();

    await caixa.uncheck();
    await expect.poll(async () => (await rows('SELECT pode_marcar_pago FROM usuarios WHERE id = 2'))[0].pode_marcar_pago).toBe(false);
  });

  test('o admin aparece com a permissão marcada e travada', async ({ page }) => {
    const caixa = page.getByLabel('Pode marcar boleto como pago: admin');
    await expect(caixa).toBeChecked();
    await expect(caixa).toBeDisabled();
  });

  test('novo usuário: a opção só habilita com "Boletos e notas" e vai para o banco', async ({ page }) => {
    const form = page.locator('form.admin-perm-novo');
    const pagar = form.getByLabel('Pode marcar boleto como pago');
    await expect(pagar).toBeDisabled();
    await form.getByLabel('Boletos e notas').check();
    await expect(pagar).toBeEnabled();
    await pagar.check();

    await form.getByLabel('Login').fill('caixa.novo');
    await form.getByLabel('Senha').fill('segredo123');
    await form.getByLabel('Nome').fill('Caixa Novo');
    await form.getByLabel('Restaurante A').check();
    await form.getByRole('button', { name: 'Cadastrar usuário' }).click();
    await expect(page.locator('.admin-perm-banner--ok')).toBeVisible();

    const [u] = await rows("SELECT modulo_boletos, pode_marcar_pago FROM usuarios WHERE username = 'caixa.novo'");
    expect(u).toEqual({ modulo_boletos: true, pode_marcar_pago: true });
  });
});

test.describe('admin: ocorrências de boletos', () => {
  test('lista a tentativa de linha duplicada e marca como vista', async ({ page, request }) => {
    const criar = async (usuario, corpo) => {
      const token = await tokenDe(request, usuario);
      return request.post(`${API_URL}/boletos`, { headers: { Authorization: `Bearer ${token}` }, data: corpo });
    };
    const base = { descricao: 'Boleto com linha', valor: 10, tipo: 'Boleto', dt_recebimento: dataIso(0), dt_vencimento: dataIso(8), linha_digitavel: LINHA };
    expect((await criar('gerenteB', { ...base, restaurante_id: 2, fornecedor: 'Forn do B' })).status()).toBe(201);
    expect((await criar('gerenteA', { ...base, restaurante_id: 1 })).status()).toBe(409);

    await entrar(page, 'admin');
    await escolherRestaurante(page, 'Restaurante A');
    await abaNav(page, 'Ocorrências').click();

    await expect(page.getByRole('heading', { name: 'Ocorrências de boletos' })).toBeVisible();
    const item = page.locator('.admin-perm-ocorrencia');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('Restaurante: Restaurante A');
    await expect(item).toContainText('Já cadastrada em: Restaurante B (Forn do B)');
    await expect(item).toContainText(/\d{5}\.\d{5} \d{5}\.\d{6}/);

    await item.getByRole('button', { name: 'Marcar como vista' }).click();
    await expect(item).toHaveCount(0);
    await expect(page.getByText('Nenhuma ocorrência pendente.')).toBeVisible();

    const [o] = await rows('SELECT visto_em, visto_por_usuario_id FROM boletos_ocorrencias');
    expect(o.visto_em).not.toBeNull();
    expect(o.visto_por_usuario_id).toBe(1);

    // continua fora da lista depois de recarregar
    await page.reload();
    await escolherRestaurante(page, 'Restaurante A');
    await abaNav(page, 'Ocorrências').click();
    await expect(page.getByText('Nenhuma ocorrência pendente.')).toBeVisible();
  });

  test('usuário comum não vê a aba Ocorrências e a API recusa', async ({ page, request }) => {
    await entrar(page, 'gerenteA');
    await abrirCadastro(page);
    await expect(page.locator('.nav-tabs').getByRole('button', { name: 'Ocorrências', exact: true })).toHaveCount(0);
    const token = await tokenDe(request, 'gerenteA');
    const r = await request.get(`${API_URL}/admin/boletos-ocorrencias`, { headers: { Authorization: `Bearer ${token}` } });
    expect(r.status()).toBe(403);
  });
});
