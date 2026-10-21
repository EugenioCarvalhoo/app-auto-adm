const { test, expect, entrar, escolherRestaurante, abaNav, abrirResumo, rows, dataIso } = require('../support/fixtures');

test.describe('metas de gasto (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, 'admin');
    await escolherRestaurante(page, 'Restaurante A');
    await abaNav(page, 'Boletos e notas').click();
  });

  test('cadastra uma meta pela aba e ela aparece na lista e no banco', async ({ page }) => {
    await page.locator('.boletos-abas').getByRole('button', { name: 'Meta de gasto' }).click();
    await expect(page.getByText('Nenhuma meta cadastrada.')).toBeVisible();

    await page.locator('form').locator('input[type="date"]').fill(dataIso(0));
    await page.locator('form').locator('input[placeholder="0,00"]').fill('5000,00');
    await page.getByRole('button', { name: /Salvar meta|Salvar|Adicionar/ }).first().click();

    await expect(page.locator('.boletos-table tbody tr')).toHaveCount(1);
    await expect(page.locator('.boletos-table tbody tr')).toContainText('5.000,00');

    const metas = await rows('SELECT restaurante_id, maximo_gasto FROM boletos_metas_gasto');
    expect(metas).toHaveLength(1);
    expect(metas[0].restaurante_id).toBe(1);
    expect(Number(metas[0].maximo_gasto)).toBe(5000);
  });

  test('define a meta pelo card da semana e o saldo aparece', async ({ page }) => {
    await abrirResumo(page);
    const card = page.locator('.boletos-dash-card').first();
    await card.getByRole('button', { name: 'Editar meta' }).click();
    await card.locator('input[placeholder="0,00"]').fill('1000,00');
    await card.getByRole('button', { name: 'Salvar' }).click();

    await expect(card).toContainText('1.000,00');
    // 1000,00 de meta - 100,50 lançados
    await expect(card).toContainText('899,50');
  });

  test('exclui uma meta depois de confirmar', async ({ page }) => {
    await abrirResumo(page);
    const card = page.locator('.boletos-dash-card').first();
    await card.getByRole('button', { name: 'Editar meta' }).click();
    await card.locator('input[placeholder="0,00"]').fill('800,00');
    await card.getByRole('button', { name: 'Salvar' }).click();
    await expect(card).toContainText('800,00');

    await page.locator('.boletos-abas').getByRole('button', { name: 'Meta de gasto' }).click();
    page.once('dialog', (d) => d.accept());
    await page.locator('.boletos-table tbody tr').getByRole('button', { name: 'Excluir' }).click();

    await expect(page.getByText('Nenhuma meta cadastrada.')).toBeVisible();
    expect(await rows('SELECT 1 FROM boletos_metas_gasto')).toHaveLength(0);
  });
});
