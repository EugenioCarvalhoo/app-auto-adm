const { test, expect, entrar, abrirCadastro, lancar, rows, dataIso } = require('../support/fixtures');

/** PNG 1x1 válido: pequeno o bastante para o cliente enviar sem recomprimir. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);
const foto = () => ({ name: 'boleto.png', mimeType: 'image/png', buffer: PNG_1X1 });

const SUGESTAO = {
  tipo_documento: 'boleto',
  tipo_sugerido: 'Boleto',
  fornecedor: 'Distribuidora Sabor IA',
  valor: 1234.56,
  dt_vencimento: dataIso(5),
  dt_documento: dataIso(0),
  linha_digitavel: '23790 12345 67890 123456 78901 234567 8 99990000123456'
};

/**
 * Simula o endpoint de leitura (sem Gemini real). Responde também o preflight de CORS, porque a
 * API roda em outra porta que o front.
 */
async function mockarExtrair(page, { status = 200, body = SUGESTAO } = {}) {
  await page.route('**/api/boletos/extrair', (route) => {
    const pedido = route.request();
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': pedido.headers()['access-control-request-headers'] || 'Authorization, Content-Type'
    };
    if (pedido.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({
      status,
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });
}

const campoForm = (page, nome) => page.locator(`form.boletos-form--lancamento [data-boleto-campo="${nome}"]`);

test.describe('leitura de boleto por foto com IA (usuário gerenteA, restaurante A)', () => {
  test('lê a foto, mostra os campos sugeridos e salva pelo botão existente no restaurante e autor certos', async ({
    page
  }) => {
    await mockarExtrair(page);
    await entrar(page, 'gerenteA');
    await abrirCadastro(page);
    const [autor] = await rows("SELECT id FROM usuarios WHERE username = 'gerenteA'");

    const pedido = page.waitForRequest((r) => r.url().endsWith('/api/boletos/extrair') && r.method() === 'POST');
    await page.getByTestId('ia-input-arquivo').setInputFiles(foto());
    expect((await pedido).postData()).toContain('name="restaurante_id"');

    await expect(page.getByTestId('ia-selo-descricao')).toBeVisible();
    await expect(campoForm(page, 'descricao')).toHaveValue('Distribuidora Sabor IA');
    await expect(campoForm(page, 'valor')).toHaveValue('1234,56');
    await expect(campoForm(page, 'vencimento')).toHaveValue(dataIso(5));
    await expect(campoForm(page, 'recebimento')).toHaveValue(dataIso(0));
    await expect(page.getByTestId('ia-linha-digitavel')).toBeVisible();
    expect(await rows("SELECT 1 FROM boletos_notas WHERE descricao = 'Distribuidora Sabor IA'")).toHaveLength(0);

    await page.getByTestId('ia-ver-imagem').click();
    const preview = page.getByRole('dialog', { name: 'Imagem do documento' });
    await expect(preview).toBeVisible();
    await expect(preview.locator('img')).toHaveAttribute('src', /^blob:/);
    await page.getByTestId('ia-preview-fechar').click();
    await expect(preview).toBeHidden();

    await page.locator('form.boletos-form--lancamento [data-boleto-salvar]').click();

    const linha = page.locator('tr', { hasText: 'Distribuidora Sabor IA' });
    await expect(linha).toBeVisible();
    await expect(linha).toContainText('1.234,56');
    await expect(page.getByTestId('ia-ver-imagem')).toHaveCount(0);

    const [b] = await rows(
      `SELECT restaurante_id, usuario_id, valor, tipo, to_char(dt_vencimento, 'YYYY-MM-DD') AS venc,
              to_char(dt_recebimento, 'YYYY-MM-DD') AS receb, row_to_json(boletos_notas)::text AS bruto
         FROM boletos_notas WHERE descricao = 'Distribuidora Sabor IA'`
    );
    expect(b.restaurante_id).toBe(1);
    expect(b.usuario_id).toBe(autor.id);
    expect(Number(b.valor)).toBe(1234.56);
    expect(b.tipo).toBe('Boleto');
    expect(b.venc).toBe(dataIso(5));
    expect(b.receb).toBe(dataIso(0));
    expect(b.bruto).not.toContain('23790'); // a linha digitável é só exibida, nunca gravada
  });

  test('erro 503 da leitura mostra a mensagem e o lançamento manual continua funcionando', async ({ page }) => {
    await mockarExtrair(page, { status: 503, body: { error: 'indisponível' } });
    await entrar(page, 'gerenteA');
    await abrirCadastro(page);

    await page.getByTestId('ia-input-arquivo').setInputFiles(foto());

    await expect(page.getByTestId('ia-erro')).toHaveText(
      'Leitura por IA indisponível no momento; preencha manualmente.'
    );
    await expect(page.getByTestId('ia-selo-descricao')).toHaveCount(0);

    await lancar(page, { descricao: 'Lançado à mão', valor: '10,00', vencimento: dataIso(6) });
    await expect(page.locator('tr', { hasText: 'Lançado à mão' })).toBeVisible();
    const [b] = await rows("SELECT restaurante_id, tipo FROM boletos_notas WHERE descricao = 'Lançado à mão'");
    expect(b.restaurante_id).toBe(1);
    expect(b.tipo).toBe('Boleto');
  });

  test('foto acima do limite (413) mostra a mensagem e nada é gravado', async ({ page }) => {
    await mockarExtrair(page, { status: 413, body: { error: 'grande' } });
    await entrar(page, 'gerenteA');
    await abrirCadastro(page);

    await page.getByTestId('ia-input-arquivo').setInputFiles(foto());

    await expect(page.getByTestId('ia-erro')).toHaveText(
      'Imagem muito grande. Tire a foto de novo ou escolha uma menor.'
    );
    await expect(campoForm(page, 'descricao')).toHaveValue('');
    expect(await rows("SELECT 1 FROM boletos_notas WHERE descricao = 'Distribuidora Sabor IA'")).toHaveLength(0);
  });
});
