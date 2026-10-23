/**
 * scripts/limpar-boletos.js: retenção obrigatória, --dry-run, --confirmar, apaga arquivos e anexos órfãos.
 * O script roda como processo filho contra o MESMO banco `_test`. Usa o storage compilado em dist/ (o CI roda o
 * build antes; aqui recompila se dist/ estiver ausente ou velho). Como o filho não compartilha memória com o teste,
 * `criarStorageS3` é trocado (preload `helpers/preloadStorageFake.js`) por um storage em diretório temporário.
 * O comportamento contra o MinIO REAL fica em storageMinio.test.js e storageFluxoMinio.test.js.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { usarBancoReal } = require('./helpers/setup');
const { dbConfig } = require('./helpers/dbConfig');
const { linha47 } = require('./helpers/linhas');
const { criarStorageEmDisco } = require('./helpers/storageFake');

const env = usarBancoReal();
const BACKEND = path.join(__dirname, '..');
const SCRIPT = path.join(BACKEND, 'scripts', 'limpar-boletos.js');
const PRELOAD = path.join(__dirname, 'helpers', 'preloadStorageFake.js');

describe('scripts/limpar-boletos.js', () => {
  let dir;
  let storage;
  let ids;

  beforeAll(() => {
    // dist/ ausente, sem criarStorageS3 (build antigo) ou mais velho que o fonte => recompila
    const dist = path.join(BACKEND, 'dist', 'lib', 'storage.js');
    const src = path.join(BACKEND, 'lib', 'storage.ts');
    const velho = !fs.existsSync(dist) || !fs.readFileSync(dist, 'utf8').includes('criarStorageS3') || fs.statSync(dist).mtimeMs < fs.statSync(src).mtimeMs;
    if (velho) {
      const b = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsc'], { cwd: BACKEND, encoding: 'utf8', shell: process.platform === 'win32' });
      if (b.status !== 0) throw new Error(`Falha ao compilar dist/ para o teste: ${b.stdout}${b.stderr}`);
    }
  });

  function rodar(args, retencao, { extraEnv = {}, nodeArgs = [] } = {}) {
    const cfg = dbConfig();
    const e = {
      ...process.env,
      DB_HOST: cfg.host,
      DB_PORT: String(cfg.port),
      DB_NAME: cfg.database,
      DB_USER: cfg.user,
      DB_PASSWORD: cfg.password,
      // storage "configurado" (valores falsos) para o script não cair no modo "só banco"; o preload troca o cliente S3
      STORAGE_ENDPOINT: 'http://127.0.0.1:9',
      STORAGE_BUCKET: 'bucket-fake',
      STORAGE_ACCESS_KEY: 'ak',
      STORAGE_SECRET_KEY: 'sk',
      FAKE_STORAGE_DIR: dir,
      // string vazia (e não "ausente"): impede o dotenv de preencher a partir de backend/.env
      BOLETOS_RETENCAO_DIAS: retencao === undefined ? '' : String(retencao),
      ...extraEnv
    };
    return spawnSync(process.execPath, ['-r', PRELOAD, ...nodeArgs, SCRIPT, ...args], { cwd: BACKEND, env: e, encoding: 'utf8' });
  }

  async function anexo(boletoId, restauranteId, { diasAtras = 0, hash } = {}) {
    const chave = await storage.salvar(restauranteId, Buffer.from(`conteudo-${Math.random()}`), 'jpg');
    const r = await env.um(
      `INSERT INTO boletos_anexos (boleto_id, restaurante_id, usuario_id, storage_chave, mime, tamanho_bytes, hash_sha256, created_at)
       VALUES ($1, $2, 2, $3, 'image/jpeg', 10, $4, now() - ($5 || ' days')::interval) RETURNING id`,
      [boletoId, restauranteId, chave, hash || 'e'.repeat(64), String(diasAtras)]
    );
    return { id: r.id, chave };
  }

  async function boleto(id, { excluidoHaDias = null, linha = null } = {}) {
    await env.rows(
      `INSERT INTO boletos_notas (id, restaurante_id, usuario_id, dt_recebimento, dt_vencimento, descricao, valor, tipo, linha_digitavel, deleted_at)
       VALUES ($1, 1, 2, '2026-10-01', '2026-10-30', 'x', 10, 'Boleto', $2, CASE WHEN $3::int IS NULL THEN NULL ELSE now() - ($3::int || ' days')::interval END)`,
      [id, linha, excluidoHaDias]
    );
  }

  const existeArquivo = (chave) => fs.existsSync(path.join(dir, chave));
  const existeBoleto = async (id) => !!(await env.um('SELECT 1 AS x FROM boletos_notas WHERE id = $1', [id]));
  const existeAnexo = async (id) => !!(await env.um('SELECT 1 AS x FROM boletos_anexos WHERE id = $1', [id]));

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'limpar-test-'));
    storage = criarStorageEmDisco(dir);
    // 101: excluído há 100 dias (apagar) | 102: excluído há 5 dias (manter) | 103: ativo (manter)
    await boleto(101, { excluidoHaDias: 100, linha: linha47(1) });
    await boleto(102, { excluidoHaDias: 5, linha: linha47(2) });
    await boleto(103, { linha: linha47(3) });
    const a101 = await anexo(101, 1);
    const a102 = await anexo(102, 1);
    const a103 = await anexo(103, 1);
    const orfaoVelho = await anexo(null, 1, { diasAtras: 100 });
    const orfaoNovo = await anexo(null, 1, { diasAtras: 1 });
    await env.rows(
      `INSERT INTO boletos_ocorrencias (tipo, usuario_id, restaurante_id, boleto_existente_id, linha_digitavel) VALUES ('linha_duplicada', 3, 2, 101, $1)`,
      [linha47(1)]
    );
    ids = { a101, a102, a103, orfaoVelho, orfaoNovo };
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function nadaFoiApagado() {
    for (const id of [101, 102, 103]) expect(await existeBoleto(id)).toBe(true);
    for (const a of Object.values(ids)) {
      expect(await existeAnexo(a.id)).toBe(true);
      expect(existeArquivo(a.chave)).toBe(true);
    }
  }

  describe('retenção ausente ou inválida não apaga nada', () => {
    it.each([[undefined], ['abc'], ['0'], ['-3'], ['1.5'], ['10 dias'], ['   ']])('BOLETOS_RETENCAO_DIAS=%p => erro e nada apagado', async (retencao) => {
      const r = rodar(['--confirmar'], retencao);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/BOLETOS_RETENCAO_DIAS/);
      expect(r.stderr).toMatch(/Nada foi apagado/);
      await nadaFoiApagado();
    });
  });

  it('sem --dry-run nem --confirmar: erro e nada apagado', async () => {
    const r = rodar([], 30);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--dry-run/);
    await nadaFoiApagado();
  });

  it('--dry-run lista o que seria apagado e não altera banco nem arquivos', async () => {
    const r = rodar(['--dry-run'], 30);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Boletos excluídos a apagar: 1/);
    expect(r.stdout).toMatch(/Anexos órfãos a apagar: 1/);
    expect(r.stdout).toContain('boleto 101');
    expect(r.stdout).not.toContain('boleto 102');
    expect(r.stdout).toMatch(/--dry-run: nada foi apagado/);
    await nadaFoiApagado();
  });

  it('--confirmar apaga só o que passou da retenção: boleto, anexos (banco e arquivo) e órfãos antigos', async () => {
    const r = rodar(['--confirmar'], 30);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Concluído: 1 boleto\(s\), 1 anexo\(s\) órfão\(s\) e 2 arquivo\(s\) apagados/);

    // apagados
    expect(await existeBoleto(101)).toBe(false);
    expect(await existeAnexo(ids.a101.id)).toBe(false);
    expect(existeArquivo(ids.a101.chave)).toBe(false);
    expect(await existeAnexo(ids.orfaoVelho.id)).toBe(false);
    expect(existeArquivo(ids.orfaoVelho.chave)).toBe(false);

    // mantidos
    expect(await existeBoleto(102)).toBe(true); // excluído recentemente
    expect(await existeBoleto(103)).toBe(true); // ativo
    for (const a of [ids.a102, ids.a103, ids.orfaoNovo]) {
      expect(await existeAnexo(a.id)).toBe(true);
      expect(existeArquivo(a.chave)).toBe(true);
    }
  });

  it('a ocorrência fica, com boleto_existente_id NULL', async () => {
    rodar(['--confirmar'], 30);
    const o = await env.um('SELECT boleto_existente_id, linha_digitavel FROM boletos_ocorrencias');
    expect(o.boleto_existente_id).toBeNull();
    expect(o.linha_digitavel).toBe(linha47(1));
  });

  it('é idempotente: rodar de novo não falha e não apaga mais nada', async () => {
    expect(rodar(['--confirmar'], 30).status).toBe(0);
    const r = rodar(['--confirmar'], 30);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Concluído: 0 boleto\(s\), 0 anexo\(s\) órfão\(s\) e 0 arquivo\(s\)/);
    expect(await existeBoleto(103)).toBe(true);
  });

  it('arquivo já ausente do disco não impede a limpeza do registro', async () => {
    fs.rmSync(path.join(dir, ids.a101.chave));
    const r = rodar(['--confirmar'], 30);
    expect(r.status).toBe(0);
    expect(await existeBoleto(101)).toBe(false);
  });

  it('retenção maior que a idade do excluído não apaga nada', async () => {
    const r = rodar(['--confirmar'], 365);
    expect(r.status).toBe(0);
    await nadaFoiApagado();
  });

  it('--dry-run junto com --confirmar => exit 1, aviso de uso e NADA apagado', async () => {
    const r = rodar(['--dry-run', '--confirmar'], 30);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/não os dois juntos/);
    expect(r.stderr).toMatch(/Nada foi apagado/);
    await nadaFoiApagado();
    // a ordem dos argumentos não muda o resultado
    expect(rodar(['--confirmar', '--dry-run'], 30).status).toBe(1);
    await nadaFoiApagado();
  });

  describe('ocorrências (boletos_ocorrencias)', () => {
    const contarOcorrencias = async () => Number((await env.um('SELECT count(*) AS n FROM boletos_ocorrencias')).n);

    beforeEach(async () => {
      // além da recente criada no beforeEach externo: uma de 100 dias atrás e uma de 10 dias atrás
      await env.rows(
        `INSERT INTO boletos_ocorrencias (tipo, usuario_id, restaurante_id, linha_digitavel, created_at) VALUES
           ('linha_duplicada', 2, 1, $1, now() - interval '100 days'),
           ('linha_duplicada', 2, 1, $2, now() - interval '10 days')`,
        [linha47(7), linha47(8)]
      );
    });

    it('--confirmar apaga as antigas (> retenção) e preserva as recentes', async () => {
      expect(await contarOcorrencias()).toBe(3);
      const r = rodar(['--confirmar'], 30);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/1 ocorrência\(s\) apagada\(s\)/);
      const restantes = (await env.rows('SELECT linha_digitavel FROM boletos_ocorrencias')).map((o) => o.linha_digitavel).sort();
      expect(restantes).toEqual([linha47(1), linha47(8)].sort());
    });

    it('retenção de 5 dias apaga também a de 10 dias, mas não a recente', async () => {
      rodar(['--confirmar'], 5);
      const restantes = (await env.rows('SELECT linha_digitavel FROM boletos_ocorrencias')).map((o) => o.linha_digitavel);
      expect(restantes).toEqual([linha47(1)]);
    });

    it('--dry-run informa a contagem e não apaga nenhuma', async () => {
      const r = rodar(['--dry-run'], 30);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/Ocorrências a apagar: 1/);
      expect(await contarOcorrencias()).toBe(3);
    });

    it('retenção maior que a idade de todas não apaga nenhuma', async () => {
      rodar(['--confirmar'], 365);
      expect(await contarOcorrencias()).toBe(3);
    });
  });

  describe('falha ao apagar arquivo e ordem banco-antes-do-arquivo', () => {
    it('arquivo impossível de apagar não impede o DELETE do banco; segue para os demais e avisa', async () => {
      // troca o arquivo do anexo do boleto 101 por um diretório não vazio: unlink falha (EPERM/EISDIR), não é ENOENT
      const caminho = path.join(dir, ids.a101.chave);
      fs.rmSync(caminho);
      fs.mkdirSync(caminho);
      fs.writeFileSync(path.join(caminho, 'trava.txt'), 'x');

      const r = rodar(['--confirmar'], 30);
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/não foi possível apagar o arquivo/);
      expect(r.stdout).toMatch(/1 arquivo\(s\) não apagado\(s\)/);

      // banco: boleto e anexo apagados apesar da falha de arquivo
      expect(await existeBoleto(101)).toBe(false);
      expect(await existeAnexo(ids.a101.id)).toBe(false);
      // continuou: o órfão antigo (processado depois) também foi apagado, banco e arquivo
      expect(await existeAnexo(ids.orfaoVelho.id)).toBe(false);
      expect(existeArquivo(ids.orfaoVelho.chave)).toBe(false);
      // e os que não passaram da retenção seguem intactos
      expect(await existeBoleto(102)).toBe(true);
      expect(existeArquivo(ids.a103.chave)).toBe(true);
    });

    it('a linha do banco já foi apagada quando o arquivo é apagado (banco antes do arquivo)', async () => {
      const log = path.join(dir, 'ordem.log');
      const r = rodar(['--confirmar'], 30, { extraEnv: { ORDEM_LOG: log } });
      expect(r.status).toBe(0);
      const obs = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      // 2 arquivos apagados (anexo do boleto 101 e o órfão antigo)
      expect(obs.map((o) => o.chave).sort()).toEqual([ids.a101.chave, ids.orfaoVelho.chave].sort());
      // em nenhum deles o registro do anexo ainda existia no instante de apagar o arquivo
      obs.forEach((o) => expect(o.anexoAindaNoBanco).toBe(false));
    });

    it('storage fora do ar (apagar lança): o banco é limpo, o script termina com exit 0, avisa e conta os arquivos não apagados', async () => {
      const r = rodar(['--confirmar'], 30, { extraEnv: { FAKE_APAGAR_FALHA: '1' } });
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/não foi possível apagar o arquivo/);
      expect(r.stderr).toMatch(/storage fora do ar/);
      expect(r.stdout).toMatch(/0 arquivo\(s\) apagados/);
      expect(r.stdout).toMatch(/2 arquivo\(s\) não apagado\(s\)/);
      expect(await existeBoleto(101)).toBe(false);
      expect(await existeAnexo(ids.orfaoVelho.id)).toBe(false);
      // os arquivos continuam (órfãos de arquivo), nada foi perdido por engano
      expect(existeArquivo(ids.a101.chave)).toBe(true);
    });

    it('--dry-run com o preload não apaga arquivo algum (nenhuma observação registrada)', async () => {
      const log = path.join(dir, 'ordem-dry.log');
      rodar(['--dry-run'], 30, { extraEnv: { ORDEM_LOG: log } });
      expect(fs.existsSync(log)).toBe(false);
    });
  });

  describe('sem storage configurado (STORAGE_* ausente ou inválido)', () => {
    // sem o preload de storage: usa o criarStorageS3/lerConfigStorage reais
    const semStorage = (extraEnv) => {
      const cfg = dbConfig();
      return spawnSync(process.execPath, [SCRIPT, '--confirmar'], {
        cwd: BACKEND,
        encoding: 'utf8',
        env: {
          ...process.env,
          DB_HOST: cfg.host,
          DB_PORT: String(cfg.port),
          DB_NAME: cfg.database,
          DB_USER: cfg.user,
          DB_PASSWORD: cfg.password,
          BOLETOS_RETENCAO_DIAS: '30',
          STORAGE_ENDPOINT: '',
          STORAGE_BUCKET: '',
          STORAGE_ACCESS_KEY: '',
          STORAGE_SECRET_KEY: '',
          ...extraEnv
        }
      });
    };

    it('STORAGE_* ausente: limpa só o banco, avisa e não toca nos arquivos', async () => {
      const r = semStorage({});
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/STORAGE_\* ausente\/inválido/);
      expect(r.stdout).toMatch(/Concluído: 1 boleto\(s\), 1 anexo\(s\) órfão\(s\) e 0 arquivo\(s\) apagados/);
      expect(await existeBoleto(101)).toBe(false);
      expect(existeArquivo(ids.a101.chave)).toBe(true);
    });

    it('endpoint http público (inválido): trata como ausente (só banco), sem tentar rede', async () => {
      const r = semStorage({ STORAGE_ENDPOINT: 'http://s3.exemplo.com', STORAGE_BUCKET: 'boletos', STORAGE_ACCESS_KEY: 'a', STORAGE_SECRET_KEY: 'b' });
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/https/);
      expect(r.stderr).toMatch(/NÃO serão apagados/);
      expect(await existeBoleto(101)).toBe(false);
    });

    it('--dry-run sem storage não altera nada', async () => {
      const cfg = dbConfig();
      const r = spawnSync(process.execPath, [SCRIPT, '--dry-run'], {
        cwd: BACKEND,
        encoding: 'utf8',
        env: { ...process.env, DB_HOST: cfg.host, DB_PORT: String(cfg.port), DB_NAME: cfg.database, DB_USER: cfg.user, DB_PASSWORD: cfg.password, BOLETOS_RETENCAO_DIAS: '30', STORAGE_ENDPOINT: '' }
      });
      expect(r.status).toBe(0);
      await nadaFoiApagado();
    });
  });

  it('o boleto ativo nunca é apagado, mesmo com retenção mínima de 1 dia', async () => {
    rodar(['--confirmar'], 1);
    expect(await existeBoleto(103)).toBe(true);
    expect(await existeAnexo(ids.a103.id)).toBe(true);
    expect(existeArquivo(ids.a103.chave)).toBe(true);
  });
});
