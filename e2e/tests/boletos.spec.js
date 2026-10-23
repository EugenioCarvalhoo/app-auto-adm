const { test, expect, entrar, escolherRestaurante, abaNav, abrirCadastro, abrirResumo, lancar, rows, dataIso } = require('../support/fixtures');

test.describe('boletos e notas (usuário comum, restaurante A)', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, 'gerenteA');
    await abrirCadastro(page);
  });

  test('cadastra um boleto: aparece na lista e grava no banco com o restaurante e o autor certos', async ({ page }) => {
    await lancar(page, { descricao: 'Hortifruti Sol', valor: '123,45', vencimento: dataIso(5) });

    const linha = page.locator('tr', { hasText: 'Hortifruti Sol' });
    await expect(linha).toBeVisible();
    await expect(linha).toContainText('123,45');
    await expect(linha).toContainText('Boleto');

    const [b] = await rows("SELECT * FROM boletos_notas WHERE descricao = 'Hortifruti Sol'");
    expect(b.restaurante_id).toBe(1);
    expect(b.usuario_id).toBe(2);
    expect(Number(b.valor)).toBe(123.45);
    expect(b.tipo).toBe('Boleto');
  });

  test('cadastra um lançamento sem boleto (à vista)', async ({ page }) => {
    await lancar(page, { descricao: 'Padaria Avista', valor: '50,00' });

    await expect(page.locator('tr', { hasText: 'Padaria Avista' })).toContainText('Sem Boleto');
    const [b] = await rows("SELECT tipo, valor FROM boletos_notas WHERE descricao = 'Padaria Avista'");
    expect(b.tipo).toBe('Sem Boleto');
    expect(Number(b.valor)).toBe(50);
  });

  test('o total filtrado soma os lançamentos do restaurante', async ({ page }) => {
    await lancar(page, { descricao: 'Item Dois', valor: '10,00', vencimento: dataIso(2) });
    await expect(page.locator('tr', { hasText: 'Item Dois' })).toBeVisible();
    // 100,50 (seed) + 10,00
    await expect(page.locator('.boletos-registros-head')).toContainText('110,50');
  });

  test('edita um lançamento existente', async ({ page }) => {
    await page.locator('tr', { hasText: 'Fornecedor A' }).getByRole('button', { name: 'Editar' }).click();
    await expect(page.getByText('Modo: Editar')).toBeVisible();

    const form = page.locator('form.boletos-form--lancamento');
    await form.locator('[data-boleto-campo="descricao"]').fill('Fornecedor A Editado');
    await form.locator('[data-boleto-campo="valor"]').fill('999,99');
    await form.locator('[data-boleto-salvar]').click();

    await expect(page.locator('tr', { hasText: 'Fornecedor A Editado' })).toContainText('999,99');
    const [b] = await rows('SELECT descricao, valor FROM boletos_notas WHERE id = 10');
    expect(b.descricao).toBe('Fornecedor A Editado');
    expect(Number(b.valor)).toBe(999.99);
  });

  test('cancelar a edição volta ao modo de adicionar', async ({ page }) => {
    await page.locator('tr', { hasText: 'Fornecedor A' }).getByRole('button', { name: 'Editar' }).click();
    await page.getByRole('button', { name: /Cancelar/ }).click();
    await expect(page.getByText('Modo: Adicionar')).toBeVisible();
  });

  test('exclui um lançamento recém-criado depois de confirmar', async ({ page }) => {
    await lancar(page, { descricao: 'Para Apagar', valor: '1,00', vencimento: dataIso(4) });
    const linha = page.locator('tr', { hasText: 'Para Apagar' });
    await expect(linha).toBeVisible();

    page.once('dialog', (d) => d.accept());
    await linha.getByRole('button', { name: 'Excluir' }).click();

    await expect(linha).toHaveCount(0);
    // exclusão lógica: o registro fica no banco, marcado como excluído por quem apagou, e sai da lista
    const [b] = await rows("SELECT deleted_at, deleted_by_usuario_id FROM boletos_notas WHERE descricao = 'Para Apagar'");
    expect(b.deleted_at).not.toBeNull();
    expect(b.deleted_by_usuario_id).toBe(2);
    await page.reload();
    await abrirCadastro(page);
    await expect(page.locator('tr', { hasText: 'Para Apagar' })).toHaveCount(0);
  });

  test('recusar a confirmação mantém o lançamento', async ({ page }) => {
    await lancar(page, { descricao: 'Nao Apagar', valor: '1,00', vencimento: dataIso(4) });
    const linha = page.locator('tr', { hasText: 'Nao Apagar' });
    await expect(linha).toBeVisible();

    page.once('dialog', (d) => d.dismiss());
    await linha.getByRole('button', { name: 'Excluir' }).click();

    await expect(linha).toBeVisible();
    expect(await rows("SELECT 1 FROM boletos_notas WHERE descricao = 'Nao Apagar'")).toHaveLength(1);
  });

  test('valor inválido é recusado e nada é gravado', async ({ page }) => {
    await lancar(page, { descricao: 'Valor Ruim', valor: 'abc', vencimento: dataIso(3) });
    await expect(page.locator('.error-message')).toBeVisible();
    expect(await rows("SELECT 1 FROM boletos_notas WHERE descricao = 'Valor Ruim'")).toHaveLength(0);
  });

  test('campos obrigatórios em branco não enviam o formulário', async ({ page }) => {
    await page.locator('[data-boleto-salvar]').click();
    const total = (await rows('SELECT count(*)::int AS n FROM boletos_notas'))[0].n;
    expect(total).toBe(2); // só os dois do seed
  });
});

test.describe('dashboard semanal', () => {
  test('mostra os totais do restaurante e muda ao trocar de restaurante (admin)', async ({ page }) => {
    await entrar(page, 'admin');
    await escolherRestaurante(page, 'Restaurante A');
    await abaNav(page, 'Boletos e notas').click();
    await abrirResumo(page);

    const total = page.locator('.boletos-dash-metrics article').first();
    await expect(total).toContainText('1 lançamentos');
    await expect(total).toContainText('100,50');

    await page.locator('.restaurante-select').selectOption({ label: 'Restaurante B' });
    await expect(total).toContainText('200,00');
    await expect(total).not.toContainText('100,50');
  });

  test('um lançamento novo entra no total do dashboard', async ({ page }) => {
    await entrar(page, 'gerenteA');
    await abrirCadastro(page);
    await lancar(page, { descricao: 'Novo no Total', valor: '49,50', vencimento: dataIso(3) });
    await expect(page.locator('tr', { hasText: 'Novo no Total' })).toBeVisible();

    await abrirResumo(page);
    const total = page.locator('.boletos-dash-metrics article').first();
    await expect(total).toContainText('2 lançamentos');
    await expect(total).toContainText('150,00');
  });
});
