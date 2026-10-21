const { test, expect, entrar, escolherRestaurante, abaNav, abrirCadastro } = require('../support/fixtures');

test.describe('regra de acesso por perfil', () => {
  test('admin: todas as abas, escolhe o restaurante e vê metas', async ({ page }) => {
    await entrar(page, 'admin');
    await escolherRestaurante(page, 'Restaurante A');

    for (const aba of ['Início', 'Boletos e notas', 'Restaurantes', 'Usuários']) {
      await expect(abaNav(page, aba)).toBeVisible();
    }
    // admin vê os restaurantes ativos (o inativo não entra na lista)
    await expect(page.locator('.restaurante-select option')).toHaveText(['Restaurante A', 'Restaurante B']);

    await abaNav(page, 'Boletos e notas').click();
    await expect(page.locator('.boletos-abas').getByRole('button', { name: 'Meta de gasto' })).toBeVisible();
  });

  test('usuário comum com um restaurante: entra direto, sem abas de admin nem metas', async ({ page }) => {
    await entrar(page, 'gerenteA');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.restaurante-tarja')).toContainText('Restaurante A');
    await expect(page.getByRole('heading', { name: 'Boletos e Notas', level: 2 })).toBeVisible();
    for (const aba of ['Início', 'Restaurantes', 'Usuários']) {
      await expect(abaNav(page, aba)).toHaveCount(0);
    }
    await expect(page.locator('.restaurante-select option')).toHaveText(['Restaurante A']);
    await expect(page.locator('.boletos-abas').getByRole('button', { name: 'Meta de gasto' })).toHaveCount(0);
  });

  test('usuário com dois restaurantes escolhe qual usar e pode trocar depois', async ({ page }) => {
    await entrar(page, 'multi');
    await expect(page.getByRole('dialog', { name: /Em qual restaurante/ })).toBeVisible();
    await escolherRestaurante(page, 'Restaurante B');
    await expect(page.locator('.restaurante-tarja')).toContainText('Restaurante B');

    await page.locator('.restaurante-select').selectOption({ label: 'Restaurante A' });
    await expect(page.locator('.restaurante-tarja')).toContainText('Restaurante A');
  });

  test('usuário sem vínculo não vê restaurante nenhum', async ({ page }) => {
    await entrar(page, 'semVinculo');
    await expect(page.getByText('Nenhum restaurante disponível')).toBeVisible();
    await expect(page.locator('.restaurante-select')).toHaveCount(0);
  });

  test('antigo modulo_financeiro não dá acesso livre: só o restaurante vinculado', async ({ page }) => {
    await entrar(page, 'financeiroLegado');
    await expect(page.locator('.restaurante-select option')).toHaveText(['Restaurante A']);
    await expect(abaNav(page, 'Restaurantes')).toHaveCount(0);
  });

  test('usuário comum não enxerga lançamentos de outro restaurante', async ({ page }) => {
    await entrar(page, 'gerenteA');
    await abrirCadastro(page);
    await expect(page.getByText('Fornecedor A')).toBeVisible();
    await expect(page.getByText('Fornecedor B')).toHaveCount(0);
  });

  test('tirar o vínculo no banco tira o acesso na próxima carga', async ({ page }) => {
    const { getPool } = require('../support/db');
    await entrar(page, 'gerenteA');
    await expect(page.locator('.restaurante-tarja')).toContainText('Restaurante A');

    await getPool().query('DELETE FROM usuario_restaurantes WHERE usuario_id = 2');
    await page.reload();
    await expect(page.getByText('Nenhum restaurante disponível')).toBeVisible();
  });
});
