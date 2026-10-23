#!/usr/bin/env node
/**
 * Limpeza definitiva de boletos excluídos (soft delete) e suas imagens.
 *
 *   npm run limpar-boletos -- --dry-run     lista o que seria apagado (não altera nada)
 *   npm run limpar-boletos -- --confirmar   apaga de verdade
 *   (--dry-run e --confirmar juntos: erro de uso, nada e feito)
 *
 * Tambem apaga ocorrencias (boletos_ocorrencias) mais antigas que a retencao.
 * Ordem: apaga a linha no banco primeiro e depois o arquivo; se o arquivo falhar, loga e segue (orfao de arquivo
 * e menos grave que registro quebrado).
 *
 * Variáveis:
 *   BOLETOS_RETENCAO_DIAS  obrigatória: inteiro >= 1. Apaga boletos com deleted_at mais antigo que isso
 *                          (e, defensivamente, anexos órfãos antigos sem boleto; o fluxo atual não os cria mais). Ausente/inválida: não apaga nada.
 *   STORAGE_*              storage S3/MinIO das imagens (mesmas variáveis da API; ver .env.example).
 *                          Sem configuração completa, o banco é limpo mas os arquivos não (aviso).
 *
 * Usa o storage compilado em dist/ (rode `npm run build` antes).
 */
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const confirmar = args.includes('--confirmar');

function falhar(msg) {
  console.error(msg);
  process.exit(1);
}

async function main() {
  const bruto = (process.env.BOLETOS_RETENCAO_DIAS || '').trim();
  if (!/^\d+$/.test(bruto) || Number(bruto) < 1) {
    falhar(
      'BOLETOS_RETENCAO_DIAS ausente ou inválida (use um inteiro >= 1, em dias). Nada foi apagado.\n' +
        'Exemplo: BOLETOS_RETENCAO_DIAS=90 npm run limpar-boletos -- --dry-run'
    );
  }
  const dias = Number(bruto);
  if (dryRun && confirmar) {
    falhar('Use --dry-run OU --confirmar, não os dois juntos. Nada foi apagado.');
  }
  if (!dryRun && !confirmar) {
    falhar('Informe --dry-run (apenas listar) ou --confirmar (apagar definitivamente). Nada foi apagado.');
  }

  let storageLib;
  try {
    storageLib = require('../dist/lib/storage');
  } catch (e) {
    falhar('Não foi possível carregar dist/lib/storage. Rode `npm run build` antes. Nada foi apagado.');
  }
  const cfgStorage = storageLib.lerConfigStorage();
  if (!cfgStorage) {
    console.error('Aviso: STORAGE_* ausente/inválido; os arquivos de imagem NÃO serão apagados (apenas o banco).');
  }
  const storage = cfgStorage ? storageLib.criarStorageS3(cfgStorage) : null;

  const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'controle_financeiro',
    password: process.env.DB_PASSWORD || 'postgres',
    port: process.env.DB_PORT || 5432
  });

  try {
    const boletos = await pool.query(
      `SELECT b.id, b.restaurante_id, b.deleted_at,
              COALESCE(json_agg(json_build_object('id', a.id, 'chave', a.storage_chave))
                       FILTER (WHERE a.id IS NOT NULL), '[]') AS anexos
       FROM boletos_notas b
       LEFT JOIN boletos_anexos a ON a.boleto_id = b.id
       WHERE b.deleted_at IS NOT NULL AND b.deleted_at < NOW() - make_interval(days => $1::int)
       GROUP BY b.id
       ORDER BY b.id`,
      [dias]
    );
    const orfaos = await pool.query(
      `SELECT id, restaurante_id, storage_chave AS chave, created_at
       FROM boletos_anexos
       WHERE boleto_id IS NULL AND created_at < NOW() - make_interval(days => $1::int)
       ORDER BY id`,
      [dias]
    );

    const ocorr = await pool.query(
      'SELECT COUNT(*)::int AS n FROM boletos_ocorrencias WHERE created_at < NOW() - make_interval(days => $1::int)',
      [dias]
    );
    const nOcorrencias = ocorr.rows[0].n;

    console.log(
      `Retenção: ${dias} dia(s). Boletos excluídos a apagar: ${boletos.rows.length}. Anexos órfãos a apagar: ${orfaos.rows.length}. Ocorrências a apagar: ${nOcorrencias}.`
    );
    boletos.rows.forEach((b) => {
      console.log(`- boleto ${b.id} (restaurante ${b.restaurante_id}, excluído em ${new Date(b.deleted_at).toISOString()}), imagens: ${b.anexos.length}`);
    });
    orfaos.rows.forEach((o) => {
      console.log(`- anexo órfão ${o.id} (restaurante ${o.restaurante_id}, enviado em ${new Date(o.created_at).toISOString()})`);
    });

    if (dryRun) {
      console.log('--dry-run: nada foi apagado.');
      return;
    }

    let nBoletos = 0;
    let nArquivos = 0;
    let falhasArquivo = 0;
    // Banco primeiro; arquivo depois (falha de arquivo só é logada).
    const apagarArquivo = async (chave) => {
      if (!storage) {
        falhasArquivo++;
        return;
      }
      try {
        await storage.apagar(chave);
        nArquivos++;
      } catch (e) {
        falhasArquivo++;
        console.error(`Aviso: não foi possível apagar o arquivo "${chave}": ${e && e.message ? e.message : e}`);
      }
    };
    for (const b of boletos.rows) {
      // ON DELETE CASCADE remove as linhas de boletos_anexos; ocorrências ficam com boleto_existente_id NULL.
      await pool.query('DELETE FROM boletos_notas WHERE id = $1 AND deleted_at IS NOT NULL', [b.id]);
      nBoletos++;
      for (const a of b.anexos) await apagarArquivo(a.chave);
    }
    let nOrfaos = 0;
    for (const o of orfaos.rows) {
      await pool.query('DELETE FROM boletos_anexos WHERE id = $1 AND boleto_id IS NULL', [o.id]);
      nOrfaos++;
      await apagarArquivo(o.chave);
    }
    const delOcorr = await pool.query(
      'DELETE FROM boletos_ocorrencias WHERE created_at < NOW() - make_interval(days => $1::int)',
      [dias]
    );
    console.log(`Concluído: ${nBoletos} boleto(s), ${nOrfaos} anexo(s) órfão(s) e ${nArquivos} arquivo(s) apagados; ${delOcorr.rowCount} ocorrência(s) apagada(s)` +
        (falhasArquivo ? `; ${falhasArquivo} arquivo(s) não apagado(s) (ver avisos acima).` : '.'));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Falha na limpeza:', e && e.message ? e.message : e);
  process.exit(1);
});
