import crypto from 'crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import pool from '../db';
import { authenticateToken } from '../middleware/auth';
import {
  requireModuloBoletos,
  loadUserFlags,
  assertBoletosAcessoRestaurante,
  usuarioPodeRestaurante
} from '../middleware/permissoes';
import { erroTabelaBoletos, enriquecerBoleto, BOLETO_SELECT } from '../lib/boletos';
import type { BoletoRow } from '../lib/boletos';
import { extrairBrutoDaImagem, sanitizarExtracao, leituraIaConfigurada, GeminiErro } from '../lib/gemini';
import { detectarMimeImagem, extensaoDoMime, mimeDeclaradoPermitido, IMAGEM_MAX_BYTES } from '../lib/imagem';
import { getStorage, storageConfigurado, StorageNaoConfigurado } from '../lib/storage';
import { reservarLeituraDiaria } from '../lib/limiteDiario';
import { extrairRateLimit } from '../lib/rateLimit';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGEM_MAX_BYTES, files: 1, fields: 6, fieldSize: 1024, parts: 8 }
});

function receberImagem(req: Request, res: Response, next: NextFunction): void {
  upload.single('imagem')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'Imagem muito grande (máximo 5 MB).' });
      return;
    }
    res.status(400).json({ error: 'Envio inválido. Use multipart/form-data com o campo "imagem".' });
  });
}

interface BoletoAcessoRow {
  id: number;
  restaurante_id: number;
  pago: boolean;
}

const MSG_STORAGE = 'Armazenamento de imagens não configurado';
const MSG_BOLETO_PAGO = 'Boleto pago: peça ao administrador para desfazer o pagamento ou alterar.';

type CampoLido = 'fornecedor' | 'valor' | 'dt_vencimento' | 'dt_recebimento' | 'linha_digitavel';

// ========== Extração por imagem ==========

router.post(
  '/api/boletos/extrair',
  authenticateToken,
  requireModuloBoletos,
  extrairRateLimit.middleware,
  receberImagem,
  async (req, res) => {
    try {
      const rid = parseInt(String(req.body?.restaurante_id), 10);
      if (Number.isNaN(rid)) {
        return res.status(400).json({ error: 'restaurante_id é obrigatório' });
      }
      const pode = await assertBoletosAcessoRestaurante(req, res, rid);
      if (!pode) return;

      if (!leituraIaConfigurada()) {
        return res.status(503).json({ error: 'Leitura por IA não configurada' });
      }
      const arquivo = req.file;
      if (!arquivo || !arquivo.buffer || arquivo.buffer.length === 0) {
        return res.status(400).json({ error: 'Envie a imagem no campo "imagem".' });
      }
      // MIME declarado E assinatura (magic bytes) precisam concordar.
      const declarado = mimeDeclaradoPermitido(arquivo.mimetype || '');
      const real = detectarMimeImagem(arquivo.buffer);
      if (!declarado || !real || declarado !== real) {
        return res.status(415).json({ error: 'Formato de imagem não suportado. Use JPG, PNG ou WebP.' });
      }

      const hash = crypto.createHash('sha256').update(arquivo.buffer).digest('hex');
      const forcar = req.body?.forcar_repetida === 'true' || req.body?.forcar_repetida === '1';

      const repetida = await pool.query<{ boleto_id: number }>(
        `SELECT a.boleto_id
         FROM boletos_anexos a
         JOIN boletos_notas b ON b.id = a.boleto_id
         WHERE a.restaurante_id = $1 AND a.hash_sha256 = $2 AND b.deleted_at IS NULL
         ORDER BY a.id DESC
         LIMIT 1`,
        [rid, hash]
      );
      const comBoleto = repetida.rows[0];
      if (comBoleto && !forcar) {
        // Mesma imagem já cadastrada neste restaurante: avisa sem gastar chamada de IA.
        const b = await pool.query<BoletoRow>(
          `SELECT ${BOLETO_SELECT} FROM boletos_notas WHERE id = $1 AND restaurante_id = $2 AND deleted_at IS NULL`,
          [comBoleto.boleto_id, rid]
        );
        return res.json({
          hash_sha256: hash,
          aviso_imagem_repetida: b.rows[0] ? enriquecerBoleto(b.rows[0]) : true,
          tipo_documento: null,
          tipo_sugerido: null,
          fornecedor: null,
          valor: null,
          dt_vencimento: null,
          dt_recebimento: null,
          linha_digitavel: null,
          campos_nao_lidos: [],
          avisos: ['Esta imagem já foi cadastrada neste restaurante. Para ler mesmo assim, reenvie com forcar_repetida=true.']
        });
      }

      // Teto diário por usuário: reserva (atômico, no banco) antes de chamar a IA. Cada chamada que sai conta.
      if (!(await reservarLeituraDiaria(req.user!.id))) {
        return res.status(429).json({ error: 'Limite diário de leituras por IA atingido', codigo: 'LIMITE_DIARIO' });
      }

      let bruto: unknown;
      try {
        bruto = await extrairBrutoDaImagem(arquivo.buffer, real);
      } catch (error) {
        if (error instanceof GeminiErro && error.message === 'Leitura por IA não configurada') {
          return res.status(503).json({ error: 'Leitura por IA não configurada' });
        }
        // Nunca loga imagem nem resposta: só o tipo/mensagem controlada.
        console.error('[extrair] falha na leitura por IA:', error instanceof GeminiErro ? error.message : 'erro inesperado');
        return res.status(502).json({ error: 'Não foi possível ler a imagem agora. Tente novamente ou preencha manualmente.' });
      }
      const dados = sanitizarExtracao(bruto);

      const avisos: string[] = [];
      // Boleto só é sugerido com linha digitável válida; sem ela o usuário decide.
      let tipoSugerido: 'Boleto' | 'Sem Boleto' | null = null;
      if (dados.linha_digitavel) tipoSugerido = 'Boleto';
      else if (dados.tipo_documento === 'nota') tipoSugerido = 'Sem Boleto';
      if (!dados.linha_digitavel && dados.tipo_documento !== 'nota') {
        avisos.push('Imagem não identificada como boleto.');
      }

      const ehBoleto = tipoSugerido === 'Boleto';
      const resposta = {
        hash_sha256: hash,
        tipo_documento: dados.tipo_documento,
        tipo_sugerido: tipoSugerido,
        fornecedor: dados.fornecedor,
        valor: dados.valor,
        dt_vencimento: ehBoleto ? dados.dt_vencimento : null,
        dt_recebimento: ehBoleto ? dados.dt_documento : null,
        linha_digitavel: dados.linha_digitavel,
        campos_nao_lidos: [] as CampoLido[],
        avisos
      };
      const esperados: CampoLido[] = ehBoleto
        ? ['fornecedor', 'valor', 'dt_vencimento', 'dt_recebimento', 'linha_digitavel']
        : ['fornecedor', 'valor'];
      resposta.campos_nao_lidos = esperados.filter((c) => resposta[c] == null);
      res.json(resposta);
    } catch (error) {
      if (erroTabelaBoletos(error, res)) return;
      console.error('Erro ao extrair dados da imagem:', error instanceof Error ? error.message : 'erro inesperado');
      res.status(500).json({ error: 'Erro ao processar a imagem' });
    }
  }
);

// ========== Pagamento ==========

/** Busca o boleto não excluído e valida acesso ao restaurante dele. Responde 4xx e devolve null se falhar. */
async function carregarBoletoComAcesso(req: Request, res: Response): Promise<BoletoAcessoRow | null> {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'id inválido' });
    return null;
  }
  const r = await pool.query<BoletoAcessoRow>(
    'SELECT id, restaurante_id, pago FROM boletos_notas WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: 'Lançamento não encontrado' });
    return null;
  }
  const pode = await assertBoletosAcessoRestaurante(req, res, r.rows[0].restaurante_id);
  if (!pode) return null;
  return r.rows[0];
}

router.post('/api/boletos/:id/pago', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const boleto = await carregarBoletoComAcesso(req, res);
    if (!boleto) return;
    const flags = await loadUserFlags(req.user!.id);
    // Admin, ou quem tem pode_marcar_pago E vínculo com o restaurante do boleto.
    const permitido =
      !!flags &&
      (flags.is_admin ||
        (flags.pode_marcar_pago && (await usuarioPodeRestaurante(req.user!.id, boleto.restaurante_id))));
    if (!permitido) {
      return res.status(403).json({ error: 'Sem permissão para marcar boletos como pagos.' });
    }
    const upd = await pool.query<BoletoRow>(
      `UPDATE boletos_notas
       SET pago = true, pago_em = CURRENT_TIMESTAMP, pago_por_usuario_id = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND restaurante_id = $3 AND deleted_at IS NULL AND pago = false
       RETURNING id`,
      [boleto.id, req.user!.id, boleto.restaurante_id]
    );
    if (upd.rows.length === 0) {
      return res.status(409).json({ error: 'Este lançamento já está marcado como pago.' });
    }
    const r = await pool.query<BoletoRow>(`SELECT ${BOLETO_SELECT} FROM boletos_notas WHERE id = $1`, [boleto.id]);
    res.json(enriquecerBoleto(r.rows[0]));
  } catch (error) {
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao marcar boleto como pago:', error);
    res.status(500).json({ error: 'Erro ao marcar como pago' });
  }
});

router.delete('/api/boletos/:id/pago', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const boleto = await carregarBoletoComAcesso(req, res);
    if (!boleto) return;
    const flags = await loadUserFlags(req.user!.id);
    if (!flags || !flags.is_admin) {
      return res.status(403).json({ error: 'Apenas administradores podem desfazer um pagamento.' });
    }
    const motivoBruto: unknown = req.body ? req.body.motivo : undefined;
    if (motivoBruto != null && typeof motivoBruto !== 'string') {
      return res.status(400).json({ error: 'Motivo inválido.' });
    }
    const motivo = typeof motivoBruto === 'string' ? motivoBruto.trim() : '';
    if (motivo.length < 5) {
      return res.status(400).json({ error: 'Informe o motivo (mínimo de 5 caracteres).' });
    }
    if (motivo.length > 500) {
      return res.status(400).json({ error: 'Motivo muito longo (máximo de 500 caracteres).' });
    }
    const upd = await pool.query(
      `UPDATE boletos_notas
       SET pago = false, pago_em = NULL, pago_por_usuario_id = NULL,
           pagamento_desfeito_em = CURRENT_TIMESTAMP, pagamento_desfeito_por_usuario_id = $2,
           pagamento_desfeito_motivo = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND restaurante_id = $4 AND deleted_at IS NULL AND pago = true
       RETURNING id`,
      [boleto.id, req.user!.id, motivo, boleto.restaurante_id]
    );
    if (upd.rows.length === 0) {
      return res.status(409).json({ error: 'Este lançamento não está marcado como pago.' });
    }
    const r = await pool.query<BoletoRow>(`SELECT ${BOLETO_SELECT} FROM boletos_notas WHERE id = $1`, [boleto.id]);
    res.json(enriquecerBoleto(r.rows[0]));
  } catch (error) {
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao desfazer pagamento:', error);
    res.status(500).json({ error: 'Erro ao desfazer pagamento' });
  }
});

// ========== Imagem do boleto ==========

/**
 * Grava a imagem confirmada de um boleto já cadastrado. O hash_sha256 informado (vindo de /extrair)
 * precisa ser igual ao SHA-256 da imagem enviada: garante que é a mesma imagem que foi lida.
 */
router.post('/api/boletos/:id/anexo', authenticateToken, requireModuloBoletos, receberImagem, async (req, res) => {
  try {
    const boleto = await carregarBoletoComAcesso(req, res);
    if (!boleto) return;
    if (boleto.pago) {
      const flags = await loadUserFlags(req.user!.id);
      if (!flags || !flags.is_admin) return res.status(403).json({ error: MSG_BOLETO_PAGO });
    }
    if (!storageConfigurado()) return res.status(503).json({ error: MSG_STORAGE });

    const arquivo = req.file;
    if (!arquivo || !arquivo.buffer || arquivo.buffer.length === 0) {
      return res.status(400).json({ error: 'Envie a imagem no campo "imagem".' });
    }
    const declarado = mimeDeclaradoPermitido(arquivo.mimetype || '');
    const real = detectarMimeImagem(arquivo.buffer);
    if (!declarado || !real || declarado !== real) {
      return res.status(415).json({ error: 'Formato de imagem não suportado. Use JPG, PNG ou WebP.' });
    }
    const hashInformado = typeof req.body?.hash_sha256 === 'string' ? req.body.hash_sha256.trim().toLowerCase() : '';
    if (!/^[a-f0-9]{64}$/.test(hashInformado)) {
      return res.status(400).json({ error: 'hash_sha256 é obrigatório.' });
    }
    const hash = crypto.createHash('sha256').update(arquivo.buffer).digest('hex');
    if (hash !== hashInformado) {
      return res.status(400).json({ error: 'A imagem enviada não confere com a imagem lida (hash_sha256 diferente).' });
    }
    const existente = await pool.query(
      'SELECT 1 FROM boletos_anexos WHERE boleto_id = $1 AND restaurante_id = $2 LIMIT 1',
      [boleto.id, boleto.restaurante_id]
    );
    if (existente.rows.length > 0) {
      return res.status(409).json({ error: 'Este lançamento já tem imagem.' });
    }

    const storage = getStorage();
    const chave = await storage.salvar(boleto.restaurante_id, arquivo.buffer, extensaoDoMime(real));
    try {
      await pool.query(
        `INSERT INTO boletos_anexos (boleto_id, restaurante_id, usuario_id, storage_chave, mime, tamanho_bytes, hash_sha256)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [boleto.id, boleto.restaurante_id, req.user!.id, chave, real, arquivo.buffer.length, hash]
      );
    } catch (error) {
      // Não deixa objeto órfão no storage.
      await storage.apagar(chave).catch(() => {});
      // 23505 em uq_boletos_anexos_boleto: outro envio simultâneo gravou primeiro.
      if ((error as { code?: string } | null)?.code === '23505') {
        return res.status(409).json({ error: 'Este lançamento já tem imagem.' });
      }
      throw error;
    }
    const r = await pool.query<BoletoRow>(`SELECT ${BOLETO_SELECT} FROM boletos_notas WHERE id = $1`, [boleto.id]);
    res.status(201).json(enriquecerBoleto(r.rows[0]));
  } catch (error) {
    if (error instanceof StorageNaoConfigurado) return res.status(503).json({ error: MSG_STORAGE });
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao gravar anexo:', error instanceof Error ? error.message : 'erro inesperado');
    res.status(500).json({ error: 'Erro ao salvar a imagem' });
  }
});

router.get('/api/boletos/:id/anexo', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const boleto = await carregarBoletoComAcesso(req, res);
    if (!boleto) return;
    const a = await pool.query<{ storage_chave: string; mime: string }>(
      `SELECT storage_chave, mime FROM boletos_anexos
       WHERE boleto_id = $1 AND restaurante_id = $2 ORDER BY id DESC LIMIT 1`,
      [boleto.id, boleto.restaurante_id]
    );
    const anexo = a.rows[0];
    const mime = anexo ? mimeDeclaradoPermitido(anexo.mime) : null;
    if (!anexo || !mime) {
      return res.status(404).json({ error: 'Este lançamento não tem imagem.' });
    }
    if (!storageConfigurado()) return res.status(503).json({ error: MSG_STORAGE });
    let conteudo: Buffer;
    try {
      ({ conteudo } = await getStorage().ler(anexo.storage_chave));
    } catch {
      return res.status(404).json({ error: 'Imagem não encontrada.' });
    }
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(conteudo.length));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.end(conteudo);
  } catch (error) {
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao servir anexo:', error);
    res.status(500).json({ error: 'Erro ao carregar a imagem' });
  }
});

export = router;
