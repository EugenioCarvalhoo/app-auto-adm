import express from 'express';
import type { Response } from 'express';
import pool from '../db';
import { authenticateToken } from '../middleware/auth';
import { requireModuloBoletos, loadUserFlags, assertBoletosAcessoRestaurante } from '../middleware/permissoes';
import { intervaloSemana, normalizarTipo } from '../lib/boletosSemana';
import type { IntervaloSemana } from '../lib/boletosSemana';
import { codigoErro } from '../lib/erros';
import {
  hojeBrasil,
  dateToIso,
  parseValorBoleto,
  erroTabelaBoletos,
  enriquecerBoleto,
  enriquecerMeta,
  parseDateOnly,
  BOLETO_SELECT,
  META_SELECT
} from '../lib/boletos';
import type { BoletoRow, MetaRow } from '../lib/boletos';
import { normalizarFornecedor, sanearFornecedor, fornecedorValido } from '../lib/fornecedor';
import { normalizarLinhaDigitavel, validarLinhaDigitavel } from '../lib/linhaDigitavel';

interface SemanaResumo {
  chave: string;
  inicio: string | null;
  fim: string | null;
  total: number;
  quantidade: number;
  maximo: number | null;
}

const router = express.Router();

const MSG_BOLETO_PAGO = 'Boleto pago: peça ao administrador para desfazer o pagamento ou alterar.';
const MSG_LINHA_DUPLICADA = 'Esta linha digitável já está cadastrada.';

/** Linha do body: ausente/vazia => null; preenchida => normalizada e validada (47/48 dígitos + DVs). */
function parseLinhaBody(raw: unknown): { linha: string | null } | { erro: string } {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { linha: null };
  const r = validarLinhaDigitavel(raw);
  if (!r.valida) {
    return { erro: 'Linha digitável inválida. Confira os 47 dígitos (boleto) ou 48 dígitos (concessionária).' };
  }
  return { linha: r.linha };
}

/** Busca GLOBAL (todos os restaurantes) de boleto não excluído com a linha; uso interno, nunca devolver ao cliente. */
async function buscarBoletoPorLinha(linha: string, ignorarId?: number): Promise<number | null> {
  const r = await pool.query<{ id: number }>(
    'SELECT id FROM boletos_notas WHERE linha_digitavel = $1 AND deleted_at IS NULL AND id <> $2 LIMIT 1',
    [linha, ignorarId ?? 0]
  );
  return r.rows[0] ? r.rows[0].id : null;
}

function ehViolacaoLinhaUnica(error: unknown): boolean {
  return (
    codigoErro(error) === '23505' &&
    (error as { constraint?: unknown }).constraint === 'uq_boletos_notas_linha_digitavel'
  );
}

/** Registra a ocorrência para o admin e responde 409 genérico (sem dados do boleto existente). */
async function responderLinhaDuplicada(
  res: Response,
  usuarioId: number,
  restauranteId: number | null,
  linha: string
): Promise<Response> {
  try {
    const existenteId = linha ? await buscarBoletoPorLinha(linha) : null;
    const rid = restauranteId != null && !Number.isNaN(restauranteId) ? restauranteId : null;
    // Não repete a ocorrência ainda não vista do mesmo usuário/restaurante/linha.
    await pool.query(
      `INSERT INTO boletos_ocorrencias (tipo, usuario_id, restaurante_id, boleto_existente_id, linha_digitavel)
       SELECT 'linha_duplicada', $1::int, $2::int, $3::int, $4::varchar
       WHERE NOT EXISTS (
         SELECT 1 FROM boletos_ocorrencias
         WHERE tipo = 'linha_duplicada' AND visto_em IS NULL
           AND usuario_id IS NOT DISTINCT FROM $1::int
           AND restaurante_id IS NOT DISTINCT FROM $2::int
           AND linha_digitavel IS NOT DISTINCT FROM $4::varchar
       )`,
      [usuarioId, rid, existenteId, linha || null]
    );
  } catch (error) {
    console.error('Erro ao registrar ocorrência de linha duplicada:', error);
  }
  return res.status(409).json({ error: MSG_LINHA_DUPLICADA, codigo: 'LINHA_DUPLICADA' });
}

// ========== Boletos e notas ==========

router.get('/api/boletos/resumo', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const rid = parseInt(String(req.query.restaurante_id), 10);
    if (Number.isNaN(rid)) {
      return res.status(400).json({ error: 'restaurante_id é obrigatório' });
    }
    const pode = await assertBoletosAcessoRestaurante(req, res, rid);
    if (!pode) return;

    const [boletos, metas] = await Promise.all([
      pool.query<BoletoRow>(
        `SELECT ${BOLETO_SELECT} FROM boletos_notas WHERE restaurante_id = $1 AND deleted_at IS NULL ORDER BY dt_recebimento ASC, id ASC`,
        [rid]
      ),
      pool.query<MetaRow>(
        `SELECT ${META_SELECT} FROM boletos_metas_gasto WHERE restaurante_id = $1 ORDER BY semana_inicio ASC`,
        [rid]
      )
    ]);

    const porSemana = new Map<string, SemanaResumo>();
    boletos.rows.forEach((row) => {
      const item = enriquecerBoleto(row);
      if (!item.semana_chave) return;
      const atual: SemanaResumo = porSemana.get(item.semana_chave) || {
        chave: item.semana_chave,
        inicio: item.semana_inicio,
        fim: item.semana_fim,
        total: 0,
        quantidade: 0,
        maximo: null
      };
      atual.total = Math.round((atual.total + item.valor) * 100) / 100;
      atual.quantidade += 1;
      porSemana.set(item.semana_chave, atual);
    });

    metas.rows.forEach((row) => {
      const meta = enriquecerMeta(row);
      const atual: SemanaResumo = porSemana.get(meta.semana_chave) || {
        chave: meta.semana_chave,
        inicio: meta.semana_inicio,
        fim: meta.semana_fim,
        total: 0,
        quantidade: 0,
        maximo: null
      };
      atual.maximo = meta.maximo_gasto;
      porSemana.set(meta.semana_chave, atual);
    });

    const semanas = [...porSemana.values()]
      .sort((a, b) => a.chave.localeCompare(b.chave))
      .map((semana) => ({
        ...semana,
        saldo: semana.maximo == null ? null : Math.round((semana.maximo - semana.total) * 100) / 100
      }));
    const totalGeral = Math.round(semanas.reduce((acc, semana) => acc + semana.total, 0) * 100) / 100;

    res.json({ semanas, total_geral: totalGeral });
  } catch (error) {
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao resumir boletos:', error);
    res.status(500).json({ error: 'Erro ao calcular o total da semana' });
  }
});

router.get('/api/boletos', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const rid = parseInt(String(req.query.restaurante_id), 10);
    if (Number.isNaN(rid)) {
      return res.status(400).json({ error: 'restaurante_id é obrigatório' });
    }
    const pode = await assertBoletosAcessoRestaurante(req, res, rid);
    if (!pode) return;
    const result = await pool.query<BoletoRow>(
      `SELECT ${BOLETO_SELECT} FROM boletos_notas WHERE restaurante_id = $1 AND deleted_at IS NULL ORDER BY dt_recebimento DESC NULLS LAST, id DESC`,
      [rid]
    );
    res.json(result.rows.map(enriquecerBoleto));
  } catch (error) {
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao listar boletos:', error);
    res.status(500).json({ error: 'Erro ao listar boletos e notas' });
  }
});

router.post('/api/boletos', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const body = req.body || {};
    const rid = parseInt(String(body.restaurante_id), 10);
    if (Number.isNaN(rid)) {
      return res.status(400).json({ error: 'restaurante_id é obrigatório' });
    }
    const pode = await assertBoletosAcessoRestaurante(req, res, rid);
    if (!pode) return;

    const descricao = body.descricao != null ? String(body.descricao).trim() : '';
    if (!descricao) {
      return res.status(400).json({ error: 'Descrição é obrigatória' });
    }
    const valor = parseValorBoleto(body.valor);
    if (valor == null) {
      return res.status(400).json({ error: 'Valor inválido' });
    }
    const tipo = normalizarTipo(body.tipo);
    let dtRecebimento = body.dt_recebimento ? parseDateOnly(String(body.dt_recebimento).slice(0, 10)) : null;
    if (tipo === 'Sem Boleto' && !dtRecebimento) {
      dtRecebimento = hojeBrasil();
    }
    if (!dtRecebimento) {
      return res.status(400).json({ error: 'Data de recebimento é obrigatória' });
    }
    let dtVencimento = null;
    if (tipo === 'Boleto') {
      dtVencimento = body.dt_vencimento ? parseDateOnly(String(body.dt_vencimento).slice(0, 10)) : null;
      if (!dtVencimento) {
        return res.status(400).json({ error: 'Data de vencimento é obrigatória para boleto' });
      }
    }

    if (!fornecedorValido(body.fornecedor)) {
      return res.status(400).json({ error: 'Fornecedor inválido' });
    }
    const fornecedor = sanearFornecedor(body.fornecedor);
    const fornecedorNorm = fornecedor ? normalizarFornecedor(fornecedor) || null : null;
    const linhaParse = parseLinhaBody(body.linha_digitavel);
    if ('erro' in linhaParse) {
      return res.status(400).json({ error: linhaParse.erro });
    }
    // Linha digitável só faz sentido em boleto.
    const linha = tipo === 'Boleto' ? linhaParse.linha : null;
    if (linha) {
      const existente = await buscarBoletoPorLinha(linha);
      if (existente) {
        return responderLinhaDuplicada(res, req.user!.id, rid, linha);
      }
    }

    if (body.confirmar_similar !== true && fornecedorNorm) {
      const similares = await pool.query<BoletoRow>(
        `SELECT ${BOLETO_SELECT} FROM boletos_notas
         WHERE restaurante_id = $1 AND deleted_at IS NULL AND fornecedor_norm = $2
           AND (dt_recebimento = $3 OR ($4::date IS NOT NULL AND dt_vencimento = $4::date))
         ORDER BY dt_recebimento DESC, id DESC
         LIMIT 10`,
        [rid, fornecedorNorm, dtRecebimento, dtVencimento]
      );
      if (similares.rows.length > 0) {
        return res.status(409).json({
          error: 'Já existe um lançamento parecido (mesmo fornecedor e mesma data). Confirme para cadastrar mesmo assim.',
          codigo: 'BOLETO_SIMILAR',
          similar: true,
          boletos: similares.rows.map(enriquecerBoleto)
        });
      }
    }

    const ins = await pool.query<{ id: number }>(
      `INSERT INTO boletos_notas
         (restaurante_id, usuario_id, dt_recebimento, dt_vencimento, descricao, valor, tipo, fornecedor, fornecedor_norm, linha_digitavel)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [rid, req.user!.id, dtRecebimento, dtVencimento, descricao, valor, tipo, fornecedor, fornecedorNorm, linha]
    );
    const result = await pool.query<BoletoRow>(`SELECT ${BOLETO_SELECT} FROM boletos_notas WHERE id = $1`, [ins.rows[0].id]);
    res.status(201).json(enriquecerBoleto(result.rows[0]));
  } catch (error) {
    if (ehViolacaoLinhaUnica(error)) {
      const body = req.body || {};
      const linha = normalizarLinhaDigitavel(body.linha_digitavel);
      return responderLinhaDuplicada(res, req.user!.id, parseInt(String(body.restaurante_id), 10), linha);
    }
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao criar boleto:', error);
    res.status(500).json({ error: 'Erro ao cadastrar boleto ou nota' });
  }
});

router.put('/api/boletos/:id', authenticateToken, requireModuloBoletos, async (req, res) => {
  let restauranteIdDoBoleto: number | null = null;
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'id inválido' });
    }
    const existing = await pool.query<BoletoRow>(
      `SELECT ${BOLETO_SELECT} FROM boletos_notas WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Lançamento não encontrado' });
    }
    const atual = existing.rows[0];
    const pode = await assertBoletosAcessoRestaurante(req, res, atual.restaurante_id);
    if (!pode) return;
    restauranteIdDoBoleto = atual.restaurante_id;
    if (atual.pago) {
      const flagsPut = await loadUserFlags(req.user!.id);
      if (!flagsPut || !flagsPut.is_admin) {
        return res.status(403).json({ error: MSG_BOLETO_PAGO });
      }
    }

    const body = req.body || {};
    const descricao = body.descricao !== undefined ? String(body.descricao).trim() : atual.descricao;
    if (!descricao) {
      return res.status(400).json({ error: 'Descrição é obrigatória' });
    }
    const valor = body.valor !== undefined ? parseValorBoleto(body.valor) : Number(atual.valor);
    if (valor == null) {
      return res.status(400).json({ error: 'Valor inválido' });
    }
    const tipo = body.tipo !== undefined ? normalizarTipo(body.tipo) : normalizarTipo(atual.tipo);
    let dtRecebimento = body.dt_recebimento !== undefined
      ? parseDateOnly(String(body.dt_recebimento || '').slice(0, 10))
      : dateToIso(atual.dt_recebimento);
    if (tipo === 'Sem Boleto' && !dtRecebimento) {
      dtRecebimento = hojeBrasil();
    }
    if (!dtRecebimento) {
      return res.status(400).json({ error: 'Data de recebimento é obrigatória' });
    }
    let dtVencimento = dateToIso(atual.dt_vencimento);
    if (tipo === 'Sem Boleto') {
      dtVencimento = null;
    } else if (body.dt_vencimento !== undefined) {
      dtVencimento = body.dt_vencimento
        ? parseDateOnly(String(body.dt_vencimento).slice(0, 10))
        : null;
    }
    if (tipo === 'Boleto' && !dtVencimento) {
      return res.status(400).json({ error: 'Data de vencimento é obrigatória para boleto' });
    }

    if (!fornecedorValido(body.fornecedor)) {
      return res.status(400).json({ error: 'Fornecedor inválido' });
    }
    const fornecedor = body.fornecedor !== undefined ? sanearFornecedor(body.fornecedor) : atual.fornecedor;
    const fornecedorNorm = fornecedor ? normalizarFornecedor(fornecedor) || null : null;
    let linha: string | null = atual.linha_digitavel;
    if (body.linha_digitavel !== undefined) {
      const linhaParse = parseLinhaBody(body.linha_digitavel);
      if ('erro' in linhaParse) {
        return res.status(400).json({ error: linhaParse.erro });
      }
      linha = linhaParse.linha;
    }
    if (tipo === 'Sem Boleto') linha = null;
    if (linha && linha !== atual.linha_digitavel) {
      const existente = await buscarBoletoPorLinha(linha, id);
      if (existente) {
        return responderLinhaDuplicada(res, req.user!.id, atual.restaurante_id, linha);
      }
    }

    await pool.query(
      `UPDATE boletos_notas
       SET dt_recebimento = $1, dt_vencimento = $2, descricao = $3, valor = $4, tipo = $5,
           fornecedor = $7, fornecedor_norm = $8, linha_digitavel = $9, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 AND restaurante_id = $10 AND deleted_at IS NULL`,
      [dtRecebimento, dtVencimento, descricao, valor, tipo, id, fornecedor, fornecedorNorm, linha, atual.restaurante_id]
    );
    const result = await pool.query<BoletoRow>(`SELECT ${BOLETO_SELECT} FROM boletos_notas WHERE id = $1`, [id]);
    res.json(enriquecerBoleto(result.rows[0]));
  } catch (error) {
    if (ehViolacaoLinhaUnica(error)) {
      const body = req.body || {};
      return responderLinhaDuplicada(res, req.user!.id, restauranteIdDoBoleto, normalizarLinhaDigitavel(body.linha_digitavel));
    }
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao atualizar boleto:', error);
    res.status(500).json({ error: 'Erro ao atualizar boleto ou nota' });
  }
});

// Soft delete: marca deleted_at; imagem e linha ficam até o comando de limpeza (scripts/limpar-boletos.js).
router.delete('/api/boletos/:id', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'id inválido' });
    }
    const existing = await pool.query<{ restaurante_id: number; created_at: Date; pago: boolean }>(
      'SELECT restaurante_id, created_at, pago FROM boletos_notas WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Lançamento não encontrado' });
    }
    const pode = await assertBoletosAcessoRestaurante(req, res, existing.rows[0].restaurante_id);
    if (!pode) return;
    const flags = await loadUserFlags(req.user!.id);
    if (!flags || !flags.is_admin) {
      if (existing.rows[0].pago) {
        return res.status(403).json({ error: MSG_BOLETO_PAGO });
      }
      const criado = new Date(existing.rows[0].created_at).getTime();
      const passouUmDia = !Number.isFinite(criado) || Date.now() - criado > 24 * 60 * 60 * 1000;
      if (passouUmDia) {
        return res.status(403).json({
          error: 'Só o administrador pode excluir um lançamento com mais de 1 dia.'
        });
      }
    }
    await pool.query(
      `UPDATE boletos_notas
       SET deleted_at = CURRENT_TIMESTAMP, deleted_by_usuario_id = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND deleted_at IS NULL`,
      [id, req.user!.id]
    );
    res.json({ message: 'Lançamento removido', id });
  } catch (error) {
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao remover boleto:', error);
    res.status(500).json({ error: 'Erro ao remover boleto ou nota' });
  }
});

router.get('/api/boletos/metas', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const rid = parseInt(String(req.query.restaurante_id), 10);
    if (Number.isNaN(rid)) {
      return res.status(400).json({ error: 'restaurante_id é obrigatório' });
    }
    const pode = await assertBoletosAcessoRestaurante(req, res, rid);
    if (!pode) return;
    const result = await pool.query<MetaRow>(
      `SELECT ${META_SELECT} FROM boletos_metas_gasto WHERE restaurante_id = $1 ORDER BY semana_inicio DESC`,
      [rid]
    );
    res.json(result.rows.map(enriquecerMeta));
  } catch (error) {
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao listar metas:', error);
    res.status(500).json({ error: 'Erro ao listar metas de gasto' });
  }
});

router.post('/api/boletos/metas', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const body = req.body || {};
    const rid = parseInt(String(body.restaurante_id), 10);
    if (Number.isNaN(rid)) {
      return res.status(400).json({ error: 'restaurante_id é obrigatório' });
    }
    const pode = await assertBoletosAcessoRestaurante(req, res, rid);
    if (!pode) return;
    const dataReferencia = parseDateOnly(String(body.data_referencia || '').slice(0, 10));
    if (!dataReferencia) {
      return res.status(400).json({ error: 'Informe uma data dentro da semana da meta' });
    }
    const maximo = parseValorBoleto(body.maximo_gasto);
    if (maximo == null) {
      return res.status(400).json({ error: 'Máximo de gasto inválido' });
    }
    const semana = intervaloSemana(dataReferencia) as IntervaloSemana; // dataReferencia ja validada
    const result = await pool.query<MetaRow>(
      `INSERT INTO boletos_metas_gasto (restaurante_id, data_referencia, semana_chave, semana_inicio, semana_fim, maximo_gasto)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (restaurante_id, semana_chave)
       DO UPDATE SET data_referencia = EXCLUDED.data_referencia,
                     maximo_gasto = EXCLUDED.maximo_gasto,
                     updated_at = CURRENT_TIMESTAMP
       RETURNING ${META_SELECT}`,
      [rid, dataReferencia, semana.chave, semana.inicio, semana.fim, maximo]
    );
    res.status(201).json(enriquecerMeta(result.rows[0]));
  } catch (error) {
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao salvar meta:', error);
    res.status(500).json({ error: 'Erro ao salvar meta de gasto' });
  }
});

router.put('/api/boletos/metas/:id', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'id inválido' });
    }
    const existing = await pool.query<MetaRow>(`SELECT ${META_SELECT} FROM boletos_metas_gasto WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Meta não encontrada' });
    }
    const atual = existing.rows[0];
    const pode = await assertBoletosAcessoRestaurante(req, res, atual.restaurante_id);
    if (!pode) return;
    const body = req.body || {};
    const dataReferencia = body.data_referencia !== undefined
      ? parseDateOnly(String(body.data_referencia || '').slice(0, 10))
      : dateToIso(atual.data_referencia);
    if (!dataReferencia) {
      return res.status(400).json({ error: 'Informe uma data dentro da semana da meta' });
    }
    const maximo = body.maximo_gasto !== undefined ? parseValorBoleto(body.maximo_gasto) : Number(atual.maximo_gasto);
    if (maximo == null) {
      return res.status(400).json({ error: 'Máximo de gasto inválido' });
    }
    const semana = intervaloSemana(dataReferencia) as IntervaloSemana; // dataReferencia ja validada
    const result = await pool.query<MetaRow>(
      `UPDATE boletos_metas_gasto
       SET data_referencia = $1, semana_chave = $2, semana_inicio = $3, semana_fim = $4, maximo_gasto = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING ${META_SELECT}`,
      [dataReferencia, semana.chave, semana.inicio, semana.fim, maximo, id]
    );
    res.json(enriquecerMeta(result.rows[0]));
  } catch (error) {
    if (codigoErro(error) === '23505') {
      return res.status(409).json({ error: 'Já existe meta para esta semana.' });
    }
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao atualizar meta:', error);
    res.status(500).json({ error: 'Erro ao atualizar meta de gasto' });
  }
});

router.delete('/api/boletos/metas/:id', authenticateToken, requireModuloBoletos, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'id inválido' });
    }
    const existing = await pool.query<{ restaurante_id: number }>('SELECT restaurante_id FROM boletos_metas_gasto WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Meta não encontrada' });
    }
    const pode = await assertBoletosAcessoRestaurante(req, res, existing.rows[0].restaurante_id);
    if (!pode) return;
    await pool.query('DELETE FROM boletos_metas_gasto WHERE id = $1', [id]);
    res.json({ message: 'Meta removida', id });
  } catch (error) {
    if (erroTabelaBoletos(error, res)) return;
    console.error('Erro ao remover meta:', error);
    res.status(500).json({ error: 'Erro ao remover meta de gasto' });
  }
});

export = router;
