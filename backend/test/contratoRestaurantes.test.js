/** Contrato de /api/restaurantes: formato dos corpos, mensagens exatas, efeitos no banco e entradas inválidas. */
const request = require('supertest');
const { usarBancoReal, auth, U } = require('./helpers/setup');

const env = usarBancoReal();

const CHAVES_RESTAURANTE = ['ativo', 'cnpj', 'created_at', 'email', 'endereco', 'id', 'nome', 'observacoes', 'telefone', 'updated_at'];

describe('contrato de restaurantes', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('GET /api/restaurantes', () => {
    it('200: array ordenado por nome, com as colunas exatas da tabela', async () => {
      await env.rows("UPDATE restaurantes SET nome = 'Zeta' WHERE id = 1");
      const res = await request(env.app).get('/api/restaurantes').set(auth(U.admin)).expect(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body.map((r) => r.nome)).toEqual(['Restaurante B', 'Zeta']);
      expect(Object.keys(res.body[0]).sort()).toEqual(CHAVES_RESTAURANTE);
      expect(res.body[0]).toMatchObject({ id: 2, endereco: null, telefone: null, email: null, cnpj: null, observacoes: null, ativo: true });
    });

    it('usuário comum: lista filtrada e ordenada por nome', async () => {
      await env.rows('INSERT INTO usuario_restaurantes (usuario_id, restaurante_id) VALUES (2, 2)');
      await env.rows("UPDATE restaurantes SET nome = 'Zeta' WHERE id = 1");
      const res = await request(env.app).get('/api/restaurantes').set(auth(U.gerenteA)).expect(200);
      expect(res.body.map((r) => r.id)).toEqual([2, 1]);
    });

    it('usuário sem módulo de boletos ainda lista os restaurantes vinculados (a rota não exige módulo)', async () => {
      const res = await request(env.app).get('/api/restaurantes').set(auth(U.semModulo)).expect(200);
      expect(res.body.map((r) => r.id)).toEqual([1]);
    });
  });

  describe('GET /api/restaurantes/:id', () => {
    it('200: objeto com as colunas exatas', async () => {
      const res = await request(env.app).get('/api/restaurantes/1').set(auth(U.gerenteA)).expect(200);
      expect(Object.keys(res.body).sort()).toEqual(CHAVES_RESTAURANTE);
      expect(res.body).toMatchObject({ id: 1, nome: 'Restaurante A', ativo: true });
    });

    it('403 { error } em restaurante não vinculado', async () => {
      const res = await request(env.app).get('/api/restaurantes/2').set(auth(U.gerenteA)).expect(403);
      expect(res.body).toEqual({ error: 'Sem acesso a este restaurante.' });
    });

    it('usuário comum recebe 403 (e não 404) mesmo para id inexistente: não revela existência', async () => {
      const res = await request(env.app).get('/api/restaurantes/999').set(auth(U.gerenteA)).expect(403);
      expect(res.body).toEqual({ error: 'Sem acesso a este restaurante.' });
    });

    it('404 { error } para admin em id inexistente', async () => {
      const res = await request(env.app).get('/api/restaurantes/999').set(auth(U.admin)).expect(404);
      expect(res.body).toEqual({ error: 'Restaurante não encontrado' });
    });

    it('admin consegue ler restaurante inativo pelo id (a listagem é que o oculta)', async () => {
      const res = await request(env.app).get('/api/restaurantes/3').set(auth(U.admin)).expect(200);
      expect(res.body).toMatchObject({ id: 3, ativo: false });
    });

    it('usuário sem vínculo: 403', async () => {
      await request(env.app).get('/api/restaurantes/1').set(auth(U.semVinculo)).expect(403);
    });
  });

  describe('POST /api/restaurantes', () => {
    it('201: devolve a linha criada; campos vazios viram null; ativo nasce true; nome é aparado', async () => {
      const res = await request(env.app)
        .post('/api/restaurantes')
        .set(auth(U.admin))
        .send({ nome: '  Novo Lugar  ', endereco: '', telefone: '', email: '', cnpj: '', observacoes: '' })
        .expect(201);
      expect(Object.keys(res.body).sort()).toEqual(CHAVES_RESTAURANTE);
      expect(res.body).toMatchObject({ nome: 'Novo Lugar', endereco: null, telefone: null, email: null, cnpj: null, observacoes: null, ativo: true });
      const salvo = await env.um('SELECT * FROM restaurantes WHERE id = $1', [res.body.id]);
      expect(salvo).toMatchObject({ nome: 'Novo Lugar', endereco: null, ativo: true });
    });

    it('201: grava todos os campos informados', async () => {
      const corpo = { nome: 'Completo', endereco: 'Rua 1', telefone: '11999999999', email: 'a@b.com', cnpj: '12.345.678/0001-90', observacoes: 'obs' };
      const res = await request(env.app).post('/api/restaurantes').set(auth(U.admin)).send(corpo).expect(201);
      expect(res.body).toMatchObject(corpo);
      expect(await env.um('SELECT endereco, telefone, email, cnpj, observacoes FROM restaurantes WHERE id = $1', [res.body.id])).toEqual({
        endereco: 'Rua 1',
        telefone: '11999999999',
        email: 'a@b.com',
        cnpj: '12.345.678/0001-90',
        observacoes: 'obs'
      });
    });

    it('400 { error } sem nome ou com nome só de espaços; nada é gravado', async () => {
      for (const corpo of [{}, { nome: '' }, { nome: '   ' }]) {
        const res = await request(env.app).post('/api/restaurantes').set(auth(U.admin)).send(corpo).expect(400);
        expect(res.body).toEqual({ error: 'Nome é obrigatório' });
      }
      expect(Number((await env.um('SELECT count(*) AS n FROM restaurantes')).n)).toBe(3);
    });

    it('ignora id/ativo enviados no corpo (não permite criar já inativo nem escolher id)', async () => {
      const res = await request(env.app).post('/api/restaurantes').set(auth(U.admin)).send({ nome: 'X', id: 77, ativo: false }).expect(201);
      expect(res.body.id).not.toBe(77);
      expect(res.body.ativo).toBe(true);
    });

    it('403 para usuário comum: nada é gravado', async () => {
      await request(env.app).post('/api/restaurantes').set(auth(U.gerenteA)).send({ nome: 'Invasor' }).expect(403);
      expect(await env.um("SELECT 1 FROM restaurantes WHERE nome = 'Invasor'")).toBeUndefined();
    });
  });

  describe('PUT /api/restaurantes/:id', () => {
    it('200: devolve a linha atualizada e grava no banco (updated_at avança)', async () => {
      const antes = await env.um('SELECT updated_at FROM restaurantes WHERE id = 1');
      const res = await request(env.app)
        .put('/api/restaurantes/1')
        .set(auth(U.admin))
        .send({ nome: ' Renomeado ', endereco: 'Av. Brasil', ativo: true })
        .expect(200);
      expect(Object.keys(res.body).sort()).toEqual(CHAVES_RESTAURANTE);
      expect(res.body).toMatchObject({ id: 1, nome: 'Renomeado', endereco: 'Av. Brasil', ativo: true });
      const depois = await env.um('SELECT nome, endereco, updated_at FROM restaurantes WHERE id = 1');
      expect(depois).toMatchObject({ nome: 'Renomeado', endereco: 'Av. Brasil' });
      expect(depois.updated_at.getTime()).toBeGreaterThan(antes.updated_at.getTime());
    });

    it('é um PUT total: campos omitidos viram null e `ativo` omitido reativa o restaurante (comportamento atual)', async () => {
      await env.rows("UPDATE restaurantes SET endereco = 'Rua X', ativo = false WHERE id = 1");
      const res = await request(env.app).put('/api/restaurantes/1').set(auth(U.admin)).send({ nome: 'Só nome' }).expect(200);
      expect(res.body).toMatchObject({ endereco: null, ativo: true });
      expect(await env.um('SELECT endereco, ativo FROM restaurantes WHERE id = 1')).toEqual({ endereco: null, ativo: true });
    });

    it('ativo:false desativa pelo PUT', async () => {
      await request(env.app).put('/api/restaurantes/2').set(auth(U.admin)).send({ nome: 'B', ativo: false }).expect(200);
      expect((await env.um('SELECT ativo FROM restaurantes WHERE id = 2')).ativo).toBe(false);
    });

    it('400 sem nome; 404 em id inexistente; nada muda', async () => {
      const a = await request(env.app).put('/api/restaurantes/1').set(auth(U.admin)).send({ nome: ' ' }).expect(400);
      expect(a.body).toEqual({ error: 'Nome é obrigatório' });
      const b = await request(env.app).put('/api/restaurantes/999').set(auth(U.admin)).send({ nome: 'x' }).expect(404);
      expect(b.body).toEqual({ error: 'Restaurante não encontrado' });
      expect((await env.um('SELECT nome FROM restaurantes WHERE id = 1')).nome).toBe('Restaurante A');
    });

    it('403 para usuário comum (inclusive no próprio restaurante)', async () => {
      const res = await request(env.app).put('/api/restaurantes/1').set(auth(U.gerenteA)).send({ nome: 'Hack' }).expect(403);
      expect(res.body).toEqual({ error: 'Apenas administradores podem realizar esta ação.' });
    });
  });

  describe('DELETE /api/restaurantes/:id (soft delete)', () => {
    it('200 { message }: marca inativo, mantém a linha, os vínculos e os boletos', async () => {
      const res = await request(env.app).delete('/api/restaurantes/1').set(auth(U.admin)).expect(200);
      expect(res.body).toEqual({ message: 'Restaurante desativado com sucesso' });
      expect(await env.um('SELECT ativo FROM restaurantes WHERE id = 1')).toEqual({ ativo: false });
      expect(await env.um('SELECT 1 FROM usuario_restaurantes WHERE restaurante_id = 1')).toBeDefined();
      expect(await env.um('SELECT 1 FROM boletos_notas WHERE restaurante_id = 1')).toBeDefined();
    });

    it('depois de desativado, some da lista de todos (admin e vinculado)', async () => {
      await request(env.app).delete('/api/restaurantes/1').set(auth(U.admin)).expect(200);
      const admin = await request(env.app).get('/api/restaurantes').set(auth(U.admin)).expect(200);
      const gerente = await request(env.app).get('/api/restaurantes').set(auth(U.gerenteA)).expect(200);
      expect(admin.body.map((r) => r.id)).toEqual([2]);
      expect(gerente.body).toEqual([]);
    });

    it('é idempotente: desativar de novo continua 200', async () => {
      await request(env.app).delete('/api/restaurantes/3').set(auth(U.admin)).expect(200);
    });

    it('404 { error } em id inexistente', async () => {
      const res = await request(env.app).delete('/api/restaurantes/999').set(auth(U.admin)).expect(404);
      expect(res.body).toEqual({ error: 'Restaurante não encontrado' });
    });

    it('403 para usuário comum e a linha permanece ativa', async () => {
      await request(env.app).delete('/api/restaurantes/1').set(auth(U.gerenteA)).expect(403);
      expect((await env.um('SELECT ativo FROM restaurantes WHERE id = 1')).ativo).toBe(true);
    });
  });

  // BUGS DE PRODUCAO (reportados ao backend-api): entradas inválidas viram 500 em vez de 400/404.
  // `it.failing` passa enquanto o bug existe e FALHA quando corrigido; aí remova o `.failing`.
  describe('entradas inválidas hoje respondem 500 (bug conhecido)', () => {
    it.failing('BUG: GET /api/restaurantes/abc (admin) deveria ser 4xx', async () => {
      const res = await request(env.app).get('/api/restaurantes/abc').set(auth(U.admin));
      expect(res.status).toBeLessThan(500);
    });

    it.failing('BUG: GET /api/restaurantes/abc (usuário comum) deveria ser 4xx', async () => {
      const res = await request(env.app).get('/api/restaurantes/abc').set(auth(U.gerenteA));
      expect(res.status).toBeLessThan(500);
    });

    it.failing('BUG: PUT e DELETE /api/restaurantes/abc deveriam ser 4xx', async () => {
      const put = await request(env.app).put('/api/restaurantes/abc').set(auth(U.admin)).send({ nome: 'x' });
      const del = await request(env.app).delete('/api/restaurantes/abc').set(auth(U.admin));
      expect(Math.max(put.status, del.status)).toBeLessThan(500);
    });

    it.failing('BUG: POST com nome não-string (número) deveria ser 400', async () => {
      const res = await request(env.app).post('/api/restaurantes').set(auth(U.admin)).send({ nome: 123 });
      expect(res.status).toBeLessThan(500);
    });

    it.failing('BUG: POST com cnpj/telefone acima do tamanho da coluna deveria ser 400', async () => {
      const res = await request(env.app).post('/api/restaurantes').set(auth(U.admin)).send({ nome: 'x', cnpj: '1'.repeat(40) });
      expect(res.status).toBeLessThan(500);
    });
  });
});
