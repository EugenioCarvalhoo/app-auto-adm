// Tentativas diretas na API (sem a tela): o isolamento não pode depender do front.
const { test, expect, tokenDe, rows } = require('../support/fixtures');
const { API_URL } = require('../support/env');

const hdr = (token) => ({ Authorization: `Bearer ${token}` });

test.describe('isolamento por restaurante na API', () => {
  test('sem token: 401', async ({ request }) => {
    const r = await request.get(`${API_URL}/boletos?restaurante_id=1`);
    expect(r.status()).toBe(401);
  });

  test('usuário do restaurante A não lê boletos do restaurante B', async ({ request }) => {
    const token = await tokenDe(request, 'gerenteA');
    const ok = await request.get(`${API_URL}/boletos?restaurante_id=1`, { headers: hdr(token) });
    expect(ok.status()).toBe(200);
    const negado = await request.get(`${API_URL}/boletos?restaurante_id=2`, { headers: hdr(token) });
    expect(negado.status()).toBe(403);
  });

  test('usuário do restaurante A não edita nem apaga boleto do restaurante B', async ({ request }) => {
    const token = await tokenDe(request, 'gerenteA');
    const put = await request.put(`${API_URL}/boletos/20`, {
      headers: hdr(token),
      data: { descricao: 'invadido', valor: 1 }
    });
    expect([403, 404]).toContain(put.status());
    const del = await request.delete(`${API_URL}/boletos/20`, { headers: hdr(token) });
    expect([403, 404]).toContain(del.status());

    const [b] = await rows('SELECT descricao FROM boletos_notas WHERE id = 20');
    expect(b.descricao).toBe('Fornecedor B');
  });

  test('usuário comum não cria boleto em restaurante não liberado', async ({ request }) => {
    const token = await tokenDe(request, 'gerenteA');
    const r = await request.post(`${API_URL}/boletos`, {
      headers: hdr(token),
      data: { restaurante_id: 2, tipo: 'Sem Boleto', dt_recebimento: '2026-10-21', descricao: 'x', valor: 1 }
    });
    expect(r.status()).toBe(403);
    expect(await rows("SELECT 1 FROM boletos_notas WHERE descricao = 'x'")).toHaveLength(0);
  });

  test('usuário comum não gerencia restaurantes nem usuários', async ({ request }) => {
    const token = await tokenDe(request, 'gerenteA');
    const criar = await request.post(`${API_URL}/restaurantes`, { headers: hdr(token), data: { nome: 'Invasor' } });
    expect(criar.status()).toBe(403);
    const usuarios = await request.get(`${API_URL}/admin/usuarios-permissoes`, { headers: hdr(token) });
    expect(usuarios.status()).toBe(403);
  });

  test('usuário sem módulo de boletos: 403 mesmo no restaurante vinculado', async ({ request }) => {
    const token = await tokenDe(request, 'semModulo');
    const r = await request.get(`${API_URL}/boletos?restaurante_id=1`, { headers: hdr(token) });
    expect(r.status()).toBe(403);
  });

  test('admin lê os dois restaurantes', async ({ request }) => {
    const token = await tokenDe(request, 'admin');
    for (const id of [1, 2]) {
      const r = await request.get(`${API_URL}/boletos?restaurante_id=${id}`, { headers: hdr(token) });
      expect(r.status()).toBe(200);
    }
  });
});
