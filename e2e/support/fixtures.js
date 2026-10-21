const base = require('@playwright/test');
const { semearCenario, rows, dataIso } = require('./db');
const { SENHA, API_URL } = require('./env');

/** `test` com o banco semeado do zero antes de cada teste. */
const test = base.test.extend({
  _banco: [
    async ({}, use) => {
      await semearCenario();
      await use();
    },
    { auto: true }
  ]
});

/** Faz login pela tela e espera sair dela. */
async function entrar(page, username, senha = SENHA) {
  await page.goto('/');
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

/** Escolhe o restaurante no modal inicial (aparece para admin e para quem tem mais de um vínculo). */
async function escolherRestaurante(page, nome) {
  const modal = page.getByRole('dialog', { name: /Em qual restaurante/ });
  await modal.getByRole('button', { name: nome }).click();
  await modal.getByRole('button', { name: 'Entrar neste restaurante' }).click();
  await base.expect(modal).toBeHidden();
}

/** Login direto pela API (sem a tela). Devolve o token. */
async function tokenDe(request, username, senha = SENHA) {
  const r = await request.post(`${API_URL}/login`, { data: { username, password: senha } });
  base.expect(r.ok()).toBeTruthy();
  return (await r.json()).token;
}

const abaNav = (page, nome) => page.locator('.nav-tabs').getByRole('button', { name: nome, exact: true });

/** Abre a aba "Totais da semana" (dashboard) do módulo de boletos. */
async function abrirResumo(page) {
  await page.locator('.boletos-abas').getByRole('button', { name: 'Totais da semana' }).click();
  await base.expect(page.locator('.boletos-dash-metrics')).toBeVisible();
}

/** Abre a aba "Cadastro" do módulo de boletos. */
async function abrirCadastro(page) {
  await page.locator('.boletos-abas').getByRole('button', { name: 'Cadastro' }).click();
  await base.expect(page.getByRole('heading', { name: 'Cadastro de Item' })).toBeVisible();
}

/** Preenche e envia o formulário de lançamento (tipo Boleto, ou "Sem Boleto" quando `vencimento` é omitido). */
async function lancar(page, { descricao, valor, vencimento, recebimento = dataIso(0) }) {
  const form = page.locator('form.boletos-form--lancamento');
  await form.locator('[data-boleto-campo="tipo"]').selectOption(vencimento ? 'Boleto' : 'Sem Boleto');
  await form.locator('[data-boleto-campo="recebimento"]').fill(recebimento);
  if (vencimento) await form.locator('[data-boleto-campo="vencimento"]').fill(vencimento);
  await form.locator('[data-boleto-campo="descricao"]').fill(descricao);
  await form.locator('[data-boleto-campo="valor"]').fill(valor);
  await form.locator('[data-boleto-salvar]').click();
}

module.exports = { test, expect: base.expect, entrar, escolherRestaurante, tokenDe, abaNav, abrirCadastro, abrirResumo, lancar, rows, dataIso };
