/** Contrato de /api/admin/usuarios-permissoes: corpos exatos, mensagens, ordem das validações e efeitos no banco. */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { usarBancoReal, auth, U } = require('./helpers/setup');

const env = usarBancoReal();

const ROTA = '/api/admin/usuarios-permissoes';
const CHAVES_USUARIO = ['id', 'is_admin', 'modulo_boletos', 'nome', 'restaurante_ids', 'username'];
const novo = (extra = {}) => ({
  username: 'novo',
  password: 'abcd1234',
  nome: 'Novo Usuário',
  modulo_boletos: true,
  restaurante_ids: [1],
  ...extra
});
const nUsuarios = async () => Number((await env.um('SELECT count(*) AS n FROM usuarios')).n);
const vinculosDe = async (uid) =>
  (await env.rows('SELECT restaurante_id FROM usuario_restaurantes WHERE usuario_id = $1 ORDER BY 1', [uid])).map((r) => r.restaurante_id);

describe('contrato de usuários e permissões (admin)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('GET', () => {
    it('200: array com as chaves exatas, admin primeiro, vínculos ordenados e sem dados sensíveis', async () => {
      await env.rows('INSERT INTO usuario_restaurantes (usuario_id, restaurante_id) VALUES (2, 2)');
      const res = await request(env.app).get(ROTA).set(auth(U.admin)).expect(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toHaveLength(6);
      res.body.forEach((u) => expect(Object.keys(u).sort()).toEqual(CHAVES_USUARIO));
      expect(res.body[0]).toEqual({ id: 1, username: 'admin', nome: 'Fulano', is_admin: true, modulo_boletos: true, restaurante_ids: [] });
      expect(res.body.find((u) => u.id === 2)).toEqual({
        id: 2, username: 'gerenteA', nome: 'Fulano', is_admin: false, modulo_boletos: true, restaurante_ids: [1, 2]
      });
      expect(res.body.find((u) => u.id === 4)).toMatchObject({ modulo_boletos: false });
      expect(res.body.find((u) => u.id === 5)).toMatchObject({ restaurante_ids: [] });
    });

    it('admin sempre aparece com modulo_boletos true, mesmo que a coluna esteja false', async () => {
      await env.rows('UPDATE usuarios SET modulo_boletos = false WHERE id = 1');
      const res = await request(env.app).get(ROTA).set(auth(U.admin)).expect(200);
      expect(res.body.find((u) => u.id === 1).modulo_boletos).toBe(true);
    });

    it('ordena por admin primeiro e depois por nome', async () => {
      await env.rows("UPDATE usuarios SET nome = 'Zé' WHERE id = 2");
      await env.rows("UPDATE usuarios SET nome = 'Ana' WHERE id = 3");
      const res = await request(env.app).get(ROTA).set(auth(U.admin)).expect(200);
      expect(res.body[0].id).toBe(1);
      expect(res.body[1].nome).toBe('Ana');
      expect(res.body[res.body.length - 1].nome).toBe('Zé');
    });
  });

  describe('POST', () => {
    it('201: corpo com as chaves exatas; grava hash, flags e vínculos', async () => {
      const res = await request(env.app).post(ROTA).set(auth(U.admin)).send(novo({ restaurante_ids: [2, 1] })).expect(201);
      expect(Object.keys(res.body).sort()).toEqual(CHAVES_USUARIO);
      expect(res.body).toEqual({
        id: expect.any(Number), username: 'novo', nome: 'Novo Usuário', is_admin: false, modulo_boletos: true, restaurante_ids: [1, 2]
      });
      const salvo = await env.um('SELECT * FROM usuarios WHERE id = $1', [res.body.id]);
      expect(salvo).toMatchObject({ username: 'novo', nome: 'Novo Usuário', is_admin: false, modulo_boletos: true });
      expect(await bcrypt.compare('abcd1234', salvo.password)).toBe(true);
      expect(await vinculosDe(res.body.id)).toEqual([1, 2]);
    });

    it('apara username e nome; não apara a senha; aceita ids como string e remove duplicados', async () => {
      const res = await request(env.app)
        .post(ROTA)
        .set(auth(U.admin))
        .send(novo({ username: '  novo  ', nome: '  Nome  ', password: ' abc ', restaurante_ids: ['1', 1, '2', 'x'] }))
        .expect(201);
      expect(res.body).toMatchObject({ username: 'novo', nome: 'Nome', restaurante_ids: [1, 2] });
      const salvo = await env.um('SELECT password FROM usuarios WHERE id = $1', [res.body.id]);
      expect(await bcrypt.compare(' abc ', salvo.password)).toBe(true);
    });

    it('400 com a mensagem exata de cada validação; nada é gravado', async () => {
      const casos = [
        [novo({ username: '   ' }), 'Login é obrigatório'],
        [novo({ username: undefined }), 'Login é obrigatório'],
        [novo({ password: 'abc' }), 'Senha é obrigatória (mín. 4 caracteres).'],
        [novo({ password: undefined }), 'Senha é obrigatória (mín. 4 caracteres).'],
        [novo({ nome: ' ' }), 'Nome é obrigatório'],
        [novo({ modulo_boletos: false }), 'Marque ao menos um módulo para o usuário.'],
        [novo({ modulo_boletos: 'true' }), 'Marque ao menos um módulo para o usuário.'],
        [novo({ modulo_boletos: undefined }), 'Marque ao menos um módulo para o usuário.'],
        [novo({ restaurante_ids: [] }), 'Usuário não-admin precisa de ao menos um restaurante liberado.'],
        [novo({ restaurante_ids: undefined }), 'Usuário não-admin precisa de ao menos um restaurante liberado.'],
        [novo({ restaurante_ids: ['x'] }), 'Usuário não-admin precisa de ao menos um restaurante liberado.'],
        [novo({ restaurante_ids: [3] }), 'Nenhum dos restaurantes informados é válido ou está ativo.'],
        [novo({ restaurante_ids: [999] }), 'Nenhum dos restaurantes informados é válido ou está ativo.']
      ];
      for (const [corpo, mensagem] of casos) {
        const res = await request(env.app).post(ROTA).set(auth(U.admin)).send(corpo);
        expect({ corpo, status: res.status, body: res.body }).toEqual({ corpo, status: 400, body: { error: mensagem } });
      }
      expect(await nUsuarios()).toBe(6);
      expect(await env.rows('SELECT 1 FROM usuario_restaurantes')).toHaveLength(4);
    });

    it('ordem das validações: login, senha, nome, módulo e só depois restaurantes', async () => {
      const res = await request(env.app).post(ROTA).set(auth(U.admin)).send({}).expect(400);
      expect(res.body).toEqual({ error: 'Login é obrigatório' });
      const r2 = await request(env.app).post(ROTA).set(auth(U.admin)).send({ username: 'a' }).expect(400);
      expect(r2.body).toEqual({ error: 'Senha é obrigatória (mín. 4 caracteres).' });
    });

    it('409 { error } para login duplicado; nada novo é gravado', async () => {
      const res = await request(env.app).post(ROTA).set(auth(U.admin)).send(novo({ username: 'gerenteA' })).expect(409);
      expect(res.body).toEqual({ error: 'Já existe usuário com este login.' });
      expect(await nUsuarios()).toBe(6);
    });

    it('login duplicado só difere em maiúsculas: é outro usuário (comparação sensível a caixa)', async () => {
      await request(env.app).post(ROTA).set(auth(U.admin)).send(novo({ username: 'GERENTEA' })).expect(201);
    });

    it('403 para usuário comum; nada é gravado', async () => {
      await request(env.app).post(ROTA).set(auth(U.gerenteA)).send(novo()).expect(403);
      expect(await nUsuarios()).toBe(6);
    });
  });

  describe('PUT /:id', () => {
    it('200: corpo com as chaves exatas, username/nome preservados, vínculos substituídos', async () => {
      const res = await request(env.app).put(`${ROTA}/2`).set(auth(U.admin)).send({ modulo_boletos: true, restaurante_ids: [2, 1] }).expect(200);
      expect(res.body).toEqual({ id: 2, username: 'gerenteA', nome: 'Fulano', is_admin: false, modulo_boletos: true, restaurante_ids: [1, 2] });
      expect(await vinculosDe(2)).toEqual([1, 2]);
    });

    it('não altera senha, nome, username nem is_admin, mesmo que venham no corpo', async () => {
      const antes = await env.um('SELECT password, nome, username, is_admin FROM usuarios WHERE id = 2');
      await request(env.app)
        .put(`${ROTA}/2`)
        .set(auth(U.admin))
        .send({ modulo_boletos: true, restaurante_ids: [1], password: 'outra', nome: 'Hack', username: 'hack', is_admin: true })
        .expect(200);
      expect(await env.um('SELECT password, nome, username, is_admin FROM usuarios WHERE id = 2')).toEqual(antes);
    });

    it('revogar o módulo (false) é permitido e atualiza o banco; mantém vínculos', async () => {
      const res = await request(env.app).put(`${ROTA}/2`).set(auth(U.admin)).send({ modulo_boletos: false }).expect(200);
      expect(res.body).toMatchObject({ modulo_boletos: false, restaurante_ids: [1] });
      expect((await env.um('SELECT modulo_boletos FROM usuarios WHERE id = 2')).modulo_boletos).toBe(false);
      expect(await vinculosDe(2)).toEqual([1]);
    });

    it('400 com mensagens exatas e nada muda', async () => {
      const casos = [
        [{}, 'Informe modulo_boletos (true ou false).'],
        [{ modulo_boletos: 'true' }, 'Informe modulo_boletos (true ou false).'],
        [{ modulo_boletos: 1 }, 'Informe modulo_boletos (true ou false).'],
        [{ modulo_boletos: true, restaurante_ids: [] }, 'Usuário não-admin precisa de ao menos um restaurante liberado.'],
        [{ modulo_boletos: true, restaurante_ids: ['x'] }, 'Usuário não-admin precisa de ao menos um restaurante liberado.']
      ];
      for (const [corpo, mensagem] of casos) {
        const res = await request(env.app).put(`${ROTA}/2`).set(auth(U.admin)).send(corpo);
        expect({ corpo, status: res.status, body: res.body }).toEqual({ corpo, status: 400, body: { error: mensagem } });
      }
      expect(await vinculosDe(2)).toEqual([1]);
      expect((await env.um('SELECT modulo_boletos FROM usuarios WHERE id = 2')).modulo_boletos).toBe(true);
    });

    it('400 "id inválido"; 404 "Usuário não encontrado"; 400 ao tentar alterar administrador', async () => {
      expect((await request(env.app).put(`${ROTA}/abc`).set(auth(U.admin)).send({}).expect(400)).body).toEqual({ error: 'id inválido' });
      expect((await request(env.app).put(`${ROTA}/999`).set(auth(U.admin)).send({ modulo_boletos: true }).expect(404)).body).toEqual({
        error: 'Usuário não encontrado'
      });
      expect((await request(env.app).put(`${ROTA}/1`).set(auth(U.admin)).send({ modulo_boletos: false }).expect(400)).body).toEqual({
        error: 'Permissões de administrador não podem ser alteradas.'
      });
      expect((await env.um('SELECT is_admin, modulo_boletos FROM usuarios WHERE id = 1')).is_admin).toBe(true);
    });

    it('ordem: usuário inexistente/admin é checado antes do corpo (404/400 de admin mesmo com corpo vazio)', async () => {
      expect((await request(env.app).put(`${ROTA}/999`).set(auth(U.admin)).send({}).expect(404)).body.error).toBe('Usuário não encontrado');
      expect((await request(env.app).put(`${ROTA}/1`).set(auth(U.admin)).send({}).expect(400)).body.error).toBe(
        'Permissões de administrador não podem ser alteradas.'
      );
    });

    it('403 para usuário comum; vínculos intactos', async () => {
      await request(env.app).put(`${ROTA}/2`).set(auth(U.gerenteA)).send({ modulo_boletos: true, restaurante_ids: [1, 2] }).expect(403);
      expect(await vinculosDe(2)).toEqual([1]);
    });

    // BUG DE PRODUCAO (reportado): o POST rejeita lista sem restaurante válido, mas o PUT só checa o tamanho da
    // lista ANTES de filtrar inativos/inexistentes; com [999] o usuário perde todos os vínculos e recebe 200.
    it.failing('BUG: PUT com restaurantes todos inválidos deveria ser 400 e preservar os vínculos atuais', async () => {
      const res = await request(env.app).put(`${ROTA}/2`).set(auth(U.admin)).send({ modulo_boletos: true, restaurante_ids: [999] });
      expect(res.status).toBe(400);
      expect(await vinculosDe(2)).toEqual([1]);
    });
  });

  describe('DELETE /:id', () => {
    it('200 { message, id }: remove usuário e vínculos; boletos que ele criou ficam sem autor (não somem)', async () => {
      const res = await request(env.app).delete(`${ROTA}/2`).set(auth(U.admin)).expect(200);
      expect(res.body).toEqual({ message: 'Usuário removido', id: 2 });
      expect(await env.um('SELECT 1 FROM usuarios WHERE id = 2')).toBeUndefined();
      expect(await vinculosDe(2)).toEqual([]);
      expect(await env.um('SELECT usuario_id FROM boletos_notas WHERE id = 10')).toBeDefined();
      expect(await nUsuarios()).toBe(5);
    });

    it('400 ao remover a si mesmo (mensagem exata); nada é removido', async () => {
      const res = await request(env.app).delete(`${ROTA}/1`).set(auth(U.admin)).expect(400);
      expect(res.body).toEqual({ error: 'Não é possível remover o próprio usuário.' });
      expect(await nUsuarios()).toBe(6);
    });

    it('400 ao remover outro administrador', async () => {
      await env.rows("INSERT INTO usuarios (id, username, password, nome, is_admin) VALUES (7, 'admin2', 'x', 'Outro', true)");
      const res = await request(env.app).delete(`${ROTA}/7`).set(auth(U.admin)).expect(400);
      expect(res.body).toEqual({ error: 'Não é possível remover um administrador.' });
      expect(await env.um('SELECT 1 FROM usuarios WHERE id = 7')).toBeDefined();
    });

    it('400 "id inválido"; 404 "Usuário não encontrado"', async () => {
      expect((await request(env.app).delete(`${ROTA}/abc`).set(auth(U.admin)).expect(400)).body).toEqual({ error: 'id inválido' });
      expect((await request(env.app).delete(`${ROTA}/999`).set(auth(U.admin)).expect(404)).body).toEqual({ error: 'Usuário não encontrado' });
    });

    it('403 para usuário comum; nada é removido', async () => {
      await request(env.app).delete(`${ROTA}/3`).set(auth(U.gerenteA)).expect(403);
      expect(await nUsuarios()).toBe(6);
    });
  });
});
