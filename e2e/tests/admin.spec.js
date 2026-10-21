const { test, expect, entrar, escolherRestaurante, abaNav, rows } = require('../support/fixtures');

test.describe('administração (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, 'admin');
    await escolherRestaurante(page, 'Restaurante A');
  });

  test('o Início leva às telas que sobraram', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();
    await page.getByRole('button', { name: 'Usuários e permissões' }).click();
    await expect(page.getByRole('heading', { name: 'Usuários e permissões', level: 1 })).toBeVisible();
  });

  test('cadastra um restaurante novo', async ({ page }) => {
    await abaNav(page, 'Restaurantes').click();
    await page.getByLabel(/Nome/).first().fill('Restaurante Novo');
    await page.getByRole('button', { name: /Cadastrar|Salvar/ }).first().click();

    await expect(page.locator('.restaurante-details, h4', { hasText: 'Restaurante Novo' }).first()).toBeVisible();
    const [r] = await rows("SELECT ativo FROM restaurantes WHERE nome = 'Restaurante Novo'");
    expect(r.ativo).toBe(true);
  });

  test('cria um usuário com boletos e restaurante, e ele consegue entrar vendo só esse restaurante', async ({ page, browser }) => {
    await abaNav(page, 'Usuários').click();
    const form = page.locator('form.admin-perm-novo');
    await form.getByLabel('Login').fill('novo.usuario');
    await form.getByLabel('Senha').fill('segredo123');
    await form.getByLabel('Nome').fill('Novo Usuário');
    await form.getByLabel('Boletos e notas').check();
    await form.getByLabel('Restaurante B').check();
    await form.getByRole('button', { name: 'Cadastrar usuário' }).click();
    await expect(page.locator('.admin-perm-banner--ok')).toBeVisible();

    const [u] = await rows("SELECT id, modulo_boletos FROM usuarios WHERE username = 'novo.usuario'");
    expect(u.modulo_boletos).toBe(true);
    const vinculos = await rows('SELECT restaurante_id FROM usuario_restaurantes WHERE usuario_id = $1', [u.id]);
    expect(vinculos.map((v) => v.restaurante_id)).toEqual([2]);

    // outro navegador (outra sessão): o novo usuário só vê o restaurante B
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await entrar(p2, 'novo.usuario', 'segredo123');
    await expect(p2.locator('.restaurante-tarja')).toContainText('Restaurante B');
    await expect(p2.locator('.restaurante-select option')).toHaveText(['Restaurante B']);
    await ctx.close();
  });

  test('não deixa criar usuário comum sem restaurante', async ({ page }) => {
    await abaNav(page, 'Usuários').click();
    const form = page.locator('form.admin-perm-novo');
    await form.getByLabel('Login').fill('sem.rest');
    await form.getByLabel('Senha').fill('segredo123');
    await form.getByLabel('Nome').fill('Sem Restaurante');
    await form.getByLabel('Boletos e notas').check();
    await form.getByRole('button', { name: 'Cadastrar usuário' }).click();

    await expect(page.locator('.admin-perm-banner--err')).toContainText('restaurante');
    expect(await rows("SELECT 1 FROM usuarios WHERE username = 'sem.rest'")).toHaveLength(0);
  });
});
