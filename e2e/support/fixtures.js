const base = require('@playwright/test');
const { semearCenario, rows, dataIso } = require('./db');
const path = require('path');
const { SENHA, API_URL, minio } = require('./env');

const backendModulo = (...partes) => require(path.join(__dirname, '..', '..', 'backend', ...partes));
const { minioAcessivel } = backendModulo('test', 'helpers', 'minio.js');
const { S3Client, HeadObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = backendModulo('node_modules', '@aws-sdk', 'client-s3');

const s3 = new S3Client({
  endpoint: minio.endpoint,
  region: minio.region,
  forcePathStyle: true,
  credentials: { accessKeyId: minio.accessKey, secretAccessKey: minio.secretKey }
});

/** true se o MinIO de teste está no ar (os cenários com imagem real pulam quando não está). */
const minioPronto = () => minioAcessivel(minio);

/** Bytes do objeto no MinIO, ou null se não existir. */
async function objetoNoMinio(chave) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: minio.bucket, Key: chave }));
  } catch (e) {
    if (e.$metadata && e.$metadata.httpStatusCode === 404) return null;
    throw e;
  }
  const r = await s3.send(new GetObjectCommand({ Bucket: minio.bucket, Key: chave }));
  return Buffer.from(await r.Body.transformToByteArray());
}

/** Apaga todos os objetos do bucket de teste (o E2E recria o banco a cada teste, então nada fica referenciado). */
async function limparBucket() {
  const r = await s3.send(new ListObjectsV2Command({ Bucket: minio.bucket }));
  for (const o of r.Contents || []) await s3.send(new DeleteObjectCommand({ Bucket: minio.bucket, Key: o.Key }));
}

/** Quantidade de objetos do restaurante no bucket (prefixo "<id>/"). */
async function contarObjetos(restauranteId) {
  const r = await s3.send(new ListObjectsV2Command({ Bucket: minio.bucket, Prefix: `${restauranteId}/` }));
  return r.KeyCount || 0;
}

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

module.exports = { minioPronto, objetoNoMinio, contarObjetos, limparBucket, test, expect: base.expect, entrar, escolherRestaurante, tokenDe, abaNav, abrirCadastro, abrirResumo, lancar, rows, dataIso };
