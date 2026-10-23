/**
 * Fluxo ponta a ponta com MinIO REAL (S3 de verdade) e HTTP real (supertest), sem storage fake:
 *   extrair (Gemini mockado) -> POST /boletos -> POST /boletos/:id/anexo -> GET /anexo (mesmos bytes)
 *   -> soft delete -> scripts/limpar-boletos.js --confirmar apaga o objeto no MinIO.
 * Pula com aviso se o MinIO de teste não estiver no ar (ver backend/test/README.md).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const request = require('supertest');
const { S3Client, HeadObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { usarBancoReal, auth, U } = require('./helpers/setup');
const { dbConfig } = require('./helpers/dbConfig');
const { linha47 } = require('./helpers/linhas');
const { jpeg, png } = require('./helpers/imagens');
const { configMinio, envStorage, describeMinio } = require('./helpers/minio');
const { definirExtratorImagem } = require('../lib/gemini');
const { definirStorage } = require('../lib/storage');
const { extrairRateLimit } = require('../lib/rateLimit');

const env = usarBancoReal();
const BACKEND = path.join(__dirname, '..');
const SCRIPT = path.join(BACKEND, 'scripts', 'limpar-boletos.js');
const LINHA = linha47(5);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

describeMinio('fluxo de imagem com MinIO real', () => {
  const cfg = configMinio();
  const chavesEnv = Object.keys(envStorage(cfg));
  const guardado = Object.fromEntries(chavesEnv.map((k) => [k, process.env[k]]));
  const s3 = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey }
  });
  const apontarStorage = (extra = {}) => {
    Object.assign(process.env, envStorage(cfg), extra);
    definirStorage(null); // força recriar o cliente S3 a partir do env
  };
  const existeNoMinio = async (chave) => {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: chave }));
      return true;
    } catch (e) {
      if (e.$metadata && e.$metadata.httpStatusCode === 404) return false;
      throw e;
    }
  };

  beforeAll(() => {
    // dist/ precisa ter o storage S3 atual (o script limpar-boletos usa o código compilado)
    const dist = path.join(BACKEND, 'dist', 'lib', 'storage.js');
    const src = path.join(BACKEND, 'lib', 'storage.ts');
    const velho = !fs.existsSync(dist) || !fs.readFileSync(dist, 'utf8').includes('criarStorageS3') || fs.statSync(dist).mtimeMs < fs.statSync(src).mtimeMs;
    if (velho) {
      const b = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsc'], { cwd: BACKEND, encoding: 'utf8', shell: process.platform === 'win32' });
      if (b.status !== 0) throw new Error(`Falha ao compilar dist/: ${b.stdout}${b.stderr}`);
    }
  });

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    apontarStorage();
    extrairRateLimit.reset();
    delete process.env.GEMINI_API_KEY;
    definirExtratorImagem(async () => ({
      tipo_documento: 'boleto',
      fornecedor: 'Distribuidora Sol',
      valor: 321.45,
      dt_vencimento: '2026-11-10',
      dt_documento: '2026-10-21',
      linha_digitavel: LINHA
    }));
  });

  afterEach(async () => {
    definirExtratorImagem(null);
    definirStorage(null);
    extrairRateLimit.reset();
    // não deixa objeto de teste no bucket
    const anexos = await env.rows('SELECT storage_chave FROM boletos_anexos');
    const { criarStorageS3 } = require('../lib/storage');
    for (const a of anexos) await criarStorageS3(cfg).apagar(a.storage_chave).catch(() => {});
    chavesEnv.forEach((k) => {
      if (guardado[k] === undefined) delete process.env[k];
      else process.env[k] = guardado[k];
    });
    jest.restoreAllMocks();
  });

  afterAll(() => s3.destroy());

  const extrair = (usuario, imagem, mime = 'image/jpeg', rid = 1) =>
    request(env.app).post('/api/boletos/extrair').set(auth(usuario)).field('restaurante_id', String(rid)).attach('imagem', imagem, { filename: 'f.jpg', contentType: mime });
  const criarBoleto = (usuario, extra = {}) =>
    request(env.app)
      .post('/api/boletos')
      .set(auth(usuario))
      .send({ restaurante_id: 1, descricao: 'Distribuidora Sol', valor: 321.45, tipo: 'Boleto', dt_recebimento: '2026-10-21', dt_vencimento: '2026-11-10', linha_digitavel: LINHA, ...extra });
  const anexar = (usuario, id, imagem, hash, mime = 'image/jpeg') =>
    request(env.app).post(`/api/boletos/${id}/anexo`).set(auth(usuario)).field('hash_sha256', hash).attach('imagem', imagem, { filename: 'f.jpg', contentType: mime });
  const baixar = (usuario, id) =>
    request(env.app)
      .get(`/api/boletos/${id}/anexo`)
      .set(auth(usuario))
      .buffer(true)
      .parse((r, cb) => {
        const partes = [];
        r.on('data', (c) => partes.push(c));
        r.on('end', () => cb(null, Buffer.concat(partes)));
      });

  function limpar(args, retencao = 30, extraEnv = {}) {
    const c = dbConfig();
    return spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: BACKEND,
      encoding: 'utf8',
      env: {
        ...process.env,
        DB_HOST: c.host,
        DB_PORT: String(c.port),
        DB_NAME: c.database,
        DB_USER: c.user,
        DB_PASSWORD: c.password,
        BOLETOS_RETENCAO_DIAS: String(retencao),
        ...envStorage(cfg),
        ...extraEnv
      }
    });
  }

  it('extrair -> criar boleto -> anexar -> baixar (mesmos bytes) -> excluir -> limpar-boletos apaga o objeto no MinIO', async () => {
    const imagem = Buffer.concat([jpeg(900), crypto.randomBytes(2048)]);

    // 1) extrair: só lê, nada vai ao MinIO nem ao banco
    const lido = await extrair(U.gerenteA, imagem).expect(200);
    expect(lido.body).toMatchObject({ tipo_sugerido: 'Boleto', hash_sha256: sha(imagem), linha_digitavel: LINHA });
    expect(Number((await env.um('SELECT count(*) AS n FROM boletos_anexos')).n)).toBe(0);

    // 2) cria o boleto (sem imagem ainda)
    const criado = await criarBoleto(U.gerenteA).expect(201);
    expect(criado.body.tem_anexo).toBe(false);

    // 3) anexa a imagem confirmada
    const anexado = await anexar(U.gerenteA, criado.body.id, imagem, lido.body.hash_sha256).expect(201);
    expect(anexado.body).toMatchObject({ id: criado.body.id, tem_anexo: true });
    const linha = await env.um('SELECT * FROM boletos_anexos WHERE boleto_id = $1', [criado.body.id]);
    expect(linha).toMatchObject({ restaurante_id: 1, usuario_id: 2, mime: 'image/jpeg', tamanho_bytes: imagem.length, hash_sha256: sha(imagem) });
    expect(linha.storage_chave).toMatch(/^1\/[a-f0-9]{32}\.jpg$/);
    expect(await existeNoMinio(linha.storage_chave)).toBe(true);

    // 4) GET /anexo devolve exatamente os mesmos bytes; outro restaurante não acessa
    const get = await baixar(U.gerenteA, criado.body.id).expect(200);
    expect(get.headers['content-type']).toBe('image/jpeg');
    expect(get.body.equals(imagem)).toBe(true);
    await baixar(U.gerenteB, criado.body.id).expect(403);
    expect((await baixar(U.admin, criado.body.id).expect(200)).body.equals(imagem)).toBe(true);

    // 5) segunda imagem no mesmo boleto: 409 e o objeto original segue intacto, sem objeto novo no bucket
    const antes = await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: '1/' }));
    const outra = png(901);
    await anexar(U.gerenteA, criado.body.id, outra, sha(outra), 'image/png').expect(409);
    const depois = await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: '1/' }));
    expect(depois.KeyCount).toBe(antes.KeyCount);

    // 6) soft delete: some das listagens, mas o objeto ainda existe (retenção)
    await request(env.app).delete(`/api/boletos/${criado.body.id}`).set(auth(U.gerenteA)).expect(200);
    expect((await env.um('SELECT deleted_at FROM boletos_notas WHERE id = $1', [criado.body.id])).deleted_at).not.toBeNull();
    await baixar(U.admin, criado.body.id).expect(404);
    expect(await existeNoMinio(linha.storage_chave)).toBe(true);

    // 7) limpar-boletos: dentro da retenção, nada some; --dry-run não altera nada
    expect(limpar(['--confirmar']).status).toBe(0);
    expect(await existeNoMinio(linha.storage_chave)).toBe(true);
    await env.rows(`UPDATE boletos_notas SET deleted_at = now() - interval '100 days' WHERE id = $1`, [criado.body.id]);
    const seco = limpar(['--dry-run']);
    expect(seco.status).toBe(0);
    expect(seco.stdout).toContain(`boleto ${criado.body.id}`);
    expect(await existeNoMinio(linha.storage_chave)).toBe(true);
    expect(await env.um('SELECT 1 AS x FROM boletos_notas WHERE id = $1', [criado.body.id])).toBeTruthy();

    // 8) --confirmar: apaga a linha do banco E o objeto no MinIO
    const r = limpar(['--confirmar']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Concluído: 1 boleto\(s\), 0 anexo\(s\) órfão\(s\) e 1 arquivo\(s\) apagados/);
    expect(await env.um('SELECT 1 AS x FROM boletos_notas WHERE id = $1', [criado.body.id])).toBeUndefined();
    expect(await env.um('SELECT 1 AS x FROM boletos_anexos WHERE boleto_id = $1', [criado.body.id])).toBeUndefined();
    expect(await existeNoMinio(linha.storage_chave)).toBe(false);

    // 9) idempotente
    expect(limpar(['--confirmar']).stdout).toMatch(/Concluído: 0 boleto\(s\)/);
  });

  it('limpar-boletos NÃO apaga o objeto de boleto ativo nem de excluído recente', async () => {
    const a = jpeg(910);
    const b = jpeg(911);
    const ativo = (await criarBoleto(U.gerenteA).expect(201)).body;
    const recente = (await criarBoleto(U.gerenteA, { linha_digitavel: linha47(6), descricao: 'Outro' }).expect(201)).body;
    await anexar(U.gerenteA, ativo.id, a, sha(a)).expect(201);
    await anexar(U.gerenteA, recente.id, b, sha(b)).expect(201);
    await request(env.app).delete(`/api/boletos/${recente.id}`).set(auth(U.gerenteA)).expect(200);
    const chaves = (await env.rows('SELECT storage_chave FROM boletos_anexos ORDER BY id')).map((r) => r.storage_chave);

    expect(limpar(['--confirmar'], 30).status).toBe(0);
    for (const c of chaves) expect(await existeNoMinio(c)).toBe(true);
  });

  it('limpar-boletos com credenciais erradas do MinIO: o banco é limpo, o objeto fica, o script avisa e termina com exit 0', async () => {
    const imagem = jpeg(920);
    const criado = (await criarBoleto(U.gerenteA).expect(201)).body;
    await anexar(U.gerenteA, criado.id, imagem, sha(imagem)).expect(201);
    const chave = (await env.um('SELECT storage_chave FROM boletos_anexos WHERE boleto_id = $1', [criado.id])).storage_chave;
    await env.rows(`UPDATE boletos_notas SET deleted_at = now() - interval '100 days' WHERE id = $1`, [criado.id]);

    const r = limpar(['--confirmar'], 30, { STORAGE_SECRET_KEY: 'senha-errada-123' });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/não foi possível apagar o arquivo/);
    expect(r.stdout).toMatch(/1 arquivo\(s\) não apagado\(s\)/);
    expect(await env.um('SELECT 1 AS x FROM boletos_notas WHERE id = $1', [criado.id])).toBeUndefined();
    expect(await existeNoMinio(chave)).toBe(true); // órfão de arquivo, mas nada perdido por engano
  });

  it('MinIO recusando as credenciais ao anexar: 500 genérico, o boleto continua e o objeto não existe; depois de corrigir, anexa', async () => {
    const imagem = jpeg(930);
    const criado = (await criarBoleto(U.gerenteA).expect(201)).body;
    apontarStorage({ STORAGE_SECRET_KEY: 'senha-errada-123' });
    const res = await anexar(U.gerenteA, criado.id, imagem, sha(imagem)).expect(500);
    expect(JSON.stringify(res.body)).not.toMatch(/senha-errada|SignatureDoesNotMatch|minioteste/);
    expect(Number((await env.um('SELECT count(*) AS n FROM boletos_anexos')).n)).toBe(0);
    expect(await env.um('SELECT 1 AS x FROM boletos_notas WHERE id = $1', [criado.id])).toBeTruthy();

    apontarStorage();
    await anexar(U.gerenteA, criado.id, imagem, sha(imagem)).expect(201);
    expect(Number((await env.um('SELECT count(*) AS n FROM boletos_anexos')).n)).toBe(1);
  });

  it('objeto removido do bucket por fora: GET /anexo responde 404 (não 500) e o boleto continua listado', async () => {
    const imagem = jpeg(940);
    const criado = (await criarBoleto(U.gerenteA).expect(201)).body;
    await anexar(U.gerenteA, criado.id, imagem, sha(imagem)).expect(201);
    const chave = (await env.um('SELECT storage_chave FROM boletos_anexos WHERE boleto_id = $1', [criado.id])).storage_chave;
    const { criarStorageS3 } = require('../lib/storage');
    await criarStorageS3(cfg).apagar(chave);
    const res = await baixar(U.gerenteA, criado.id).expect(404);
    expect(res.body).toBeDefined();
  });

  it('hash diferente da imagem enviada: 400 e nenhum objeto novo no MinIO', async () => {
    const criado = (await criarBoleto(U.gerenteA).expect(201)).body;
    const antes = await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: '1/' }));
    await anexar(U.gerenteA, criado.id, jpeg(950), sha(jpeg(951))).expect(400);
    const depois = await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: '1/' }));
    expect(depois.KeyCount).toBe(antes.KeyCount);
  });

  it('corrida real: dois envios simultâneos ao MinIO => um 201, um 409 e exatamente um objeto novo no bucket', async () => {
    const criado = (await criarBoleto(U.gerenteA).expect(201)).body;
    const antes = await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: '1/' }));
    const a = jpeg(960);
    const b = jpeg(961);
    const [r1, r2] = await Promise.all([anexar(U.gerenteA, criado.id, a, sha(a)), anexar(U.gerenteA, criado.id, b, sha(b))]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(Number((await env.um('SELECT count(*) AS n FROM boletos_anexos WHERE boleto_id = $1', [criado.id])).n)).toBe(1);
    const depois = await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: '1/' }));
    expect(depois.KeyCount).toBe(antes.KeyCount + 1);
  });
});
