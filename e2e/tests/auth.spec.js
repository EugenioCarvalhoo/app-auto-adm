const { test, expect, entrar, abaNav } = require('../support/fixtures');

test.describe('login e sessão', () => {
  test('senha errada mostra o erro e continua na tela de login', async ({ page }) => {
    await entrar(page, 'admin', 'senha-errada');
    await expect(page.locator('.login-error')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  });

  test('usuário inexistente não entra', async ({ page }) => {
    await entrar(page, 'ninguem');
    await expect(page.locator('.login-error')).toBeVisible();
  });

  test('login válido abre o sistema e o token fica salvo', async ({ page }) => {
    await entrar(page, 'gerenteA');
    await expect(page.getByText('Olá, Fulano!')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeTruthy();
  });

  test('a sessão sobrevive ao recarregar a página', async ({ page }) => {
    await entrar(page, 'gerenteA');
    await expect(page.getByText('Olá, Fulano!')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Olá, Fulano!')).toBeVisible();
  });

  test('sair volta ao login e apaga o token', async ({ page }) => {
    await entrar(page, 'gerenteA');
    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  });

  test('token inválido no navegador derruba a sessão', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('token', 'token.invalido.aqui'));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  });

  test('usuário sem módulo liberado vê o aviso e nenhuma aba', async ({ page }) => {
    await entrar(page, 'semModulo');
    await expect(page.getByText('Seu usuário não tem módulos liberados')).toBeVisible();
    await expect(abaNav(page, 'Boletos e notas')).toHaveCount(0);
  });
});
