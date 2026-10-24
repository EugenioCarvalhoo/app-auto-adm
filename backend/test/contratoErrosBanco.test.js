/**
 * Contrato de falhas de infraestrutura:
 *  - 503 "Banco desatualizado" (SQLSTATE 42P01: tabela inexistente) em TODAS as rotas que tocam o banco;
 *  - 503 de coluna inexistente (42703): módulo de boletos / permissões não migrados;
 *  - 500 com mensagem genérica por rota, sem vazar detalhes do erro;
 *  - 409 em violação de unicidade (23505) no cadastro de usuário.
 *
 * A tabela/coluna é renomeada de verdade no Postgres de teste e restaurada em `finally`; os 500 são
 * simulados espionando `pool.query`/`pool.connect` do pool devolvido por criarApp().
 */
const request = require('supertest');
const { usarBancoReal, auth, U } = require('./helpers/setup');

const env = usarBancoReal();

const MSG_503 = 'Banco desatualizado: migrations pendentes. Veja /api/health/ready.';
const MSG_503_BOLETOS = 'Módulo de boletos não instalado. Rode a migração 014.';
const MSG_503_PERMISSOES = 'Migração de permissões pendente (014).';

async function semTabela(tabela, fn) {
  await env.rows(`ALTER TABLE ${tabela} RENAME TO ${tabela}__off`);
  try {
    await fn();
  } finally {
    await env.rows(`ALTER TABLE ${tabela}__off RENAME TO ${tabela}`);
  }
}
async function semColuna(tabela, coluna, fn) {
  await env.rows(`ALTER TABLE ${tabela} RENAME COLUMN ${coluna} TO ${coluna}__off`);
  try {
    await fn();
  } finally {
    await env.rows(`ALTER TABLE ${tabela} RENAME COLUMN ${coluna}__off TO ${coluna}`);
  }
}

const corpoBoleto = { restaurante_id: 1, descricao: 'x', valor: 1, tipo: 'Boleto', dt_recebimento: '2026-10-20', dt_vencimento: '2026-11-05' };
const corpoMeta = { restaurante_id: 1, data_referencia: '2026-11-04', maximo_gasto: 1 };
const corpoNovoUsuario = { username: 'novo', password: 'abcd1234', nome: 'Novo', modulo_boletos: true, restaurante_ids: [1] };

/** [descrição, função que dispara a requisição (admin)] */
const ROTAS = {
  login: ['login', () => request(env.app).post('/api/login').send({ username: 'admin', password: 'senha123' })],
  verify: ['verify', () => request(env.app).get('/api/verify').set(auth(U.admin))],
  restaurantesListar: ['GET /api/restaurantes', () => request(env.app).get('/api/restaurantes').set(auth(U.admin))],
  restaurantesLer: ['GET /api/restaurantes/1', () => request(env.app).get('/api/restaurantes/1').set(auth(U.admin))],
  restaurantesCriar: ['POST /api/restaurantes', () => request(env.app).post('/api/restaurantes').set(auth(U.admin)).send({ nome: 'x' })],
  restaurantesEditar: ['PUT /api/restaurantes/1', () => request(env.app).put('/api/restaurantes/1').set(auth(U.admin)).send({ nome: 'x' })],
  restaurantesDesativar: ['DELETE /api/restaurantes/1', () => request(env.app).delete('/api/restaurantes/1').set(auth(U.admin))],
  boletosListar: ['GET /api/boletos', () => request(env.app).get('/api/boletos?restaurante_id=1').set(auth(U.admin))],
  boletosResumo: ['GET /api/boletos/resumo', () => request(env.app).get('/api/boletos/resumo?restaurante_id=1').set(auth(U.admin))],
  boletosCriar: ['POST /api/boletos', () => request(env.app).post('/api/boletos').set(auth(U.admin)).send(corpoBoleto)],
  boletosEditar: ['PUT /api/boletos/10', () => request(env.app).put('/api/boletos/10').set(auth(U.admin)).send({ descricao: 'y' })],
  boletosExcluir: ['DELETE /api/boletos/10', () => request(env.app).delete('/api/boletos/10').set(auth(U.admin))],
  metasListar: ['GET /api/boletos/metas', () => request(env.app).get('/api/boletos/metas?restaurante_id=1').set(auth(U.admin))],
  metasCriar: ['POST /api/boletos/metas', () => request(env.app).post('/api/boletos/metas').set(auth(U.admin)).send(corpoMeta)],
  metasEditar: ['PUT /api/boletos/metas/1', () => request(env.app).put('/api/boletos/metas/1').set(auth(U.admin)).send({ maximo_gasto: 5 })],
  metasExcluir: ['DELETE /api/boletos/metas/1', () => request(env.app).delete('/api/boletos/metas/1').set(auth(U.admin))],
  adminListar: ['GET /api/admin/usuarios-permissoes', () => request(env.app).get('/api/admin/usuarios-permissoes').set(auth(U.admin))],
  adminCriar: ['POST /api/admin/usuarios-permissoes', () => request(env.app).post('/api/admin/usuarios-permissoes').set(auth(U.admin)).send(corpoNovoUsuario)],
  adminEditar: ['PUT /api/admin/usuarios-permissoes/2', () => request(env.app).put('/api/admin/usuarios-permissoes/2').set(auth(U.admin)).send({ modulo_boletos: false, restaurante_ids: [1] })],
  adminExcluir: ['DELETE /api/admin/usuarios-permissoes/3', () => request(env.app).delete('/api/admin/usuarios-permissoes/3').set(auth(U.admin))]
};
const r = (...chaves) => chaves.map((c) => ROTAS[c]);

describe('contrato de falhas do banco', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('503 "Banco desatualizado" (42P01) por tabela ausente', () => {
    it.each(r('login', 'verify'))('tabela usuarios ausente: %s responde 503', async (_n, chamar) => {
      await semTabela('usuarios', async () => {
        const res = await chamar();
        expect(res.status).toBe(503);
        expect(res.body).toEqual({ error: MSG_503 });
      });
    });

    it.each(r('restaurantesListar', 'restaurantesLer', 'restaurantesCriar', 'restaurantesEditar', 'restaurantesDesativar'))(
      'tabela restaurantes ausente: %s responde 503',
      async (_n, chamar) => {
        await semTabela('restaurantes', async () => {
          const res = await chamar();
          expect(res.status).toBe(503);
          expect(res.body).toEqual({ error: MSG_503 });
        });
      }
    );

    it('tabela restaurantes ausente também derruba a listagem do usuário comum (JOIN)', async () => {
      await semTabela('restaurantes', async () => {
        const res = await request(env.app).get('/api/restaurantes').set(auth(U.gerenteA));
        expect(res.status).toBe(503);
        expect(res.body).toEqual({ error: MSG_503 });
      });
    });

    it('tabela usuario_restaurantes ausente: listagem de restaurantes do usuário comum responde 503', async () => {
      await semTabela('usuario_restaurantes', async () => {
        const res = await request(env.app).get('/api/restaurantes').set(auth(U.gerenteA));
        expect(res.status).toBe(503);
        expect(res.body).toEqual({ error: MSG_503 });
      });
    });

    it.each(r('boletosListar', 'boletosResumo', 'boletosCriar', 'boletosEditar', 'boletosExcluir'))(
      'tabela boletos_notas ausente: %s responde 503',
      async (_n, chamar) => {
        await semTabela('boletos_notas', async () => {
          const res = await chamar();
          expect(res.status).toBe(503);
          expect(res.body).toEqual({ error: MSG_503 });
        });
      }
    );

    it.each(r('boletosResumo', 'metasListar', 'metasCriar', 'metasEditar', 'metasExcluir'))(
      'tabela boletos_metas_gasto ausente: %s responde 503',
      async (_n, chamar) => {
        await semTabela('boletos_metas_gasto', async () => {
          const res = await chamar();
          expect(res.status).toBe(503);
          expect(res.body).toEqual({ error: MSG_503 });
        });
      }
    );

    it.each(r('adminListar', 'adminCriar', 'adminEditar', 'adminExcluir'))('tabela usuarios ausente: %s responde 503', async (_n, chamar) => {
      await semTabela('usuarios', async () => {
        const res = await chamar();
        expect(res.status).toBe(503);
        expect(res.body).toEqual({ error: MSG_503 });
      });
    });

    it.each(r('adminListar', 'adminCriar', 'adminEditar'))('tabela usuario_restaurantes ausente: %s responde 503', async (_n, chamar) => {
      await semTabela('usuario_restaurantes', async () => {
        const res = await chamar();
        expect(res.status).toBe(503);
        expect(res.body).toEqual({ error: MSG_503 });
      });
    });

    it('POST admin com tabela de vínculos ausente desfaz a criação (transação): nenhum usuário órfão', async () => {
      await semTabela('usuario_restaurantes', async () => {
        await ROTAS.adminCriar[1]();
      });
      expect(await env.um("SELECT 1 FROM usuarios WHERE username = 'novo'")).toBeUndefined();
    });

    it('PUT admin com tabela de vínculos ausente desfaz o UPDATE do módulo (transação)', async () => {
      await semTabela('usuario_restaurantes', async () => {
        await ROTAS.adminEditar[1]();
      });
      expect((await env.um('SELECT modulo_boletos FROM usuarios WHERE id = 2')).modulo_boletos).toBe(true);
    });

    it('as rotas voltam ao normal assim que a tabela reaparece', async () => {
      await semTabela('boletos_notas', async () => {
        await ROTAS.boletosListar[1]();
      });
      await ROTAS.boletosListar[1]().then((res) => expect(res.status).toBe(200));
    });
  });

  describe('503 por coluna ausente (42703)', () => {
    it.each(r('boletosListar', 'boletosCriar', 'boletosEditar', 'boletosExcluir', 'boletosResumo'))(
      'boletos_notas sem coluna: %s responde 503 "Módulo de boletos não instalado"',
      async (_n, chamar) => {
        // DELETE seleciona só restaurante_id/created_at; renomeia uma coluna que todas as rotas usam
        await semColuna('boletos_notas', 'created_at', async () => {
          const res = await chamar();
          expect(res.status).toBe(503);
          expect(res.body).toEqual({ error: MSG_503_BOLETOS });
        });
      }
    );

    it.each(r('metasListar', 'metasCriar', 'metasEditar', 'metasExcluir'))(
      'boletos_metas_gasto sem coluna: %s responde 503 "Módulo de boletos não instalado"',
      async (_n, chamar) => {
        await semColuna('boletos_metas_gasto', 'restaurante_id', async () => {
          const res = await chamar();
          expect(res.status).toBe(503);
          expect(res.body).toEqual({ error: MSG_503_BOLETOS });
        });
      }
    );

    it.each(r('adminListar', 'adminCriar', 'adminEditar'))(
      'usuarios sem a coluna modulo_boletos: %s responde 503 "Migração de permissões pendente"',
      async (_n, chamar) => {
        await semColuna('usuarios', 'modulo_boletos', async () => {
          const res = await chamar();
          expect(res.status).toBe(503);
          expect(res.body).toEqual({ error: MSG_503_PERMISSOES });
        });
      }
    );
  });

  describe('500 genérico por rota (sem vazar detalhes do erro)', () => {
    function falharConsulta(padrao) {
      const original = env.pool.query.bind(env.pool);
      jest.spyOn(env.pool, 'query').mockImplementation((sql, ...resto) => {
        const texto = typeof sql === 'string' ? sql : sql && sql.text;
        if (padrao.test(texto)) return Promise.reject(new Error('detalhe interno secreto'));
        return original(sql, ...resto);
      });
    }

    it.each([
      ['login', ROTAS.login, /FROM usuarios WHERE username/, 'Erro ao fazer login'],
      ['verify', ROTAS.verify, /SELECT \* FROM usuarios WHERE id/, 'Erro ao verificar token'],
      ['GET /api/restaurantes', ROTAS.restaurantesListar, /FROM restaurantes/, 'Erro ao buscar restaurantes'],
      ['GET /api/restaurantes/1', ROTAS.restaurantesLer, /FROM restaurantes/, 'Erro ao buscar restaurante'],
      ['POST /api/restaurantes', ROTAS.restaurantesCriar, /INSERT INTO restaurantes/, 'Erro ao criar restaurante'],
      ['PUT /api/restaurantes/1', ROTAS.restaurantesEditar, /UPDATE restaurantes/, 'Erro ao atualizar restaurante'],
      ['DELETE /api/restaurantes/1', ROTAS.restaurantesDesativar, /UPDATE restaurantes/, 'Erro ao deletar restaurante'],
      ['GET /api/boletos', ROTAS.boletosListar, /FROM boletos_notas/, 'Erro ao listar boletos e notas'],
      ['GET /api/boletos/resumo', ROTAS.boletosResumo, /FROM boletos_notas/, 'Erro ao calcular o total da semana'],
      ['POST /api/boletos', ROTAS.boletosCriar, /INSERT INTO boletos_notas/, 'Erro ao cadastrar boleto ou nota'],
      ['PUT /api/boletos/10', ROTAS.boletosEditar, /FROM boletos_notas WHERE id/, 'Erro ao atualizar boleto ou nota'],
      ['DELETE /api/boletos/10', ROTAS.boletosExcluir, /FROM boletos_notas WHERE id/, 'Erro ao remover boleto ou nota'],
      ['GET /api/boletos/metas', ROTAS.metasListar, /FROM boletos_metas_gasto/, 'Erro ao listar metas de gasto'],
      ['POST /api/boletos/metas', ROTAS.metasCriar, /INSERT INTO boletos_metas_gasto/, 'Erro ao salvar meta de gasto'],
      ['PUT /api/boletos/metas/1', ROTAS.metasEditar, /FROM boletos_metas_gasto WHERE id/, 'Erro ao atualizar meta de gasto'],
      ['DELETE /api/boletos/metas/1', ROTAS.metasExcluir, /FROM boletos_metas_gasto WHERE id/, 'Erro ao remover meta de gasto'],
      ['GET /api/admin/usuarios-permissoes', ROTAS.adminListar, /FROM usuarios u/, 'Erro ao listar permissões de usuários'],
      ['DELETE /api/admin/usuarios-permissoes/3', ROTAS.adminExcluir, /DELETE FROM usuarios WHERE id/, 'Erro ao remover usuário']
    ])('%s: 500 { error } genérico', async (_nome, [, chamar], padrao, mensagem) => {
      falharConsulta(padrao);
      const res = await chamar();
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: mensagem });
      expect(JSON.stringify(res.body)).not.toMatch(/secreto/);
    });

    it('login: sem NODE_ENV=development o 500 não traz "details"', async () => {
      falharConsulta(/FROM usuarios WHERE username/);
      const res = await ROTAS.login[1]();
      expect(res.status).toBe(500);
      expect(Object.keys(res.body)).toEqual(['error']);
    });

    /**
     * Intercepta `client.query` dos clients obtidos via `await pool.connect()` (a API usa isso nas rotas
     * transacionais). `interceptar(texto)` devolve uma Promise para substituir a consulta ou undefined
     * para deixá-la passar. Os clients voltam ao normal no afterEach (eles retornam ao pool).
     */
    const clientsAlterados = [];
    afterEach(() => {
      while (clientsAlterados.length) {
        const [client, original] = clientsAlterados.pop();
        client.query = original;
      }
    });
    function interceptarClient(interceptar) {
      const conectar = env.pool.connect.bind(env.pool);
      jest.spyOn(env.pool, 'connect').mockImplementation((...args) => {
        if (typeof args[0] === 'function') return conectar(...args); // forma com callback (uso interno do pool.query)
        return conectar().then((client) => {
          const original = client.query;
          clientsAlterados.push([client, original]);
          client.query = (sql, ...resto) => {
            const texto = typeof sql === 'string' ? sql : sql && sql.text;
            const desvio = interceptar(texto);
            return desvio !== undefined ? desvio : original.call(client, sql, ...resto);
          };
          return client;
        });
      });
    }
    const falharNoClient = (padrao) =>
      interceptarClient((texto) => (padrao.test(texto) ? Promise.reject(new Error('detalhe interno secreto')) : undefined));

    it('POST admin: 500 genérico e a transação é desfeita (nenhum usuário criado)', async () => {
      falharNoClient(/INSERT INTO usuario_restaurantes/);
      const res = await ROTAS.adminCriar[1]();
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Erro ao criar usuário' });
      expect(await env.um("SELECT 1 FROM usuarios WHERE username = 'novo'")).toBeUndefined();
    });

    it('PUT admin: 500 genérico e a transação é desfeita (módulo e vínculos intactos)', async () => {
      falharNoClient(/INSERT INTO usuario_restaurantes/);
      const res = await request(env.app)
        .put('/api/admin/usuarios-permissoes/2')
        .set(auth(U.admin))
        .send({ modulo_boletos: false, restaurante_ids: [1, 2] });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Erro ao atualizar permissões' });
      expect((await env.um('SELECT modulo_boletos FROM usuarios WHERE id = 2')).modulo_boletos).toBe(true);
      expect((await env.rows('SELECT restaurante_id FROM usuario_restaurantes WHERE usuario_id = 2')).map((x) => x.restaurante_id)).toEqual([1]);
    });

    it('POST admin: corrida no login duplicado (23505 no INSERT) vira 409, não 500', async () => {
      // a checagem prévia de duplicidade "não vê" o usuário; o índice único do banco o pega no INSERT
      interceptarClient((texto) => (/SELECT id FROM usuarios WHERE username/.test(texto) ? Promise.resolve({ rows: [] }) : undefined));
      const res = await request(env.app)
        .post('/api/admin/usuarios-permissoes')
        .set(auth(U.admin))
        .send({ ...corpoNovoUsuario, username: 'gerenteA' });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'Já existe usuário com este login.' });
      expect(Number((await env.um("SELECT count(*) AS n FROM usuarios WHERE username = 'gerenteA'")).n)).toBe(1);
    });
  });
});
