-- Cadastro de boleto por imagem (Gemini), baixa de pagamento, soft delete e ocorrências.
-- Não destrutiva e idempotente. Compatível com o código anterior (só adiciona colunas/tabelas).

-- 1) boletos_notas
ALTER TABLE boletos_notas ADD COLUMN IF NOT EXISTS fornecedor TEXT;
ALTER TABLE boletos_notas ADD COLUMN IF NOT EXISTS fornecedor_norm TEXT;
ALTER TABLE boletos_notas ADD COLUMN IF NOT EXISTS linha_digitavel VARCHAR(48);
ALTER TABLE boletos_notas ADD COLUMN IF NOT EXISTS pago BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE boletos_notas ADD COLUMN IF NOT EXISTS pago_em TIMESTAMP;
ALTER TABLE boletos_notas ADD COLUMN IF NOT EXISTS pago_por_usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE boletos_notas ADD COLUMN IF NOT EXISTS pagamento_desfeito_em TIMESTAMP;
ALTER TABLE boletos_notas ADD COLUMN IF NOT EXISTS pagamento_desfeito_por_usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE boletos_notas ADD COLUMN IF NOT EXISTS pagamento_desfeito_motivo TEXT;
ALTER TABLE boletos_notas ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE boletos_notas ADD COLUMN IF NOT EXISTS deleted_by_usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'boletos_notas_linha_digitavel_check' AND conrelid = 'boletos_notas'::regclass
  ) THEN
    ALTER TABLE boletos_notas
      ADD CONSTRAINT boletos_notas_linha_digitavel_check
      CHECK (linha_digitavel IS NULL OR (linha_digitavel ~ '^[0-9]+$' AND char_length(linha_digitavel) IN (47, 48)));
  END IF;
END $$;

-- Unicidade GLOBAL (todos os restaurantes) entre boletos não excluídos; excluir libera a linha.
CREATE UNIQUE INDEX IF NOT EXISTS uq_boletos_notas_linha_digitavel
    ON boletos_notas(linha_digitavel)
    WHERE linha_digitavel IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_boletos_notas_fornecedor_norm
    ON boletos_notas(restaurante_id, fornecedor_norm)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_boletos_notas_deleted_at
    ON boletos_notas(deleted_at)
    WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN boletos_notas.fornecedor IS 'Nome do fornecedor/beneficiário como informado ou extraído da imagem.';
COMMENT ON COLUMN boletos_notas.fornecedor_norm IS 'fornecedor normalizado pela aplicação (minúsculas, sem acento, espaços colapsados); apoia a busca de similaridade.';
COMMENT ON COLUMN boletos_notas.linha_digitavel IS 'Linha digitável (somente dígitos, 47 ou 48). Nula em registros antigos/sem boleto. Única globalmente entre registros não excluídos.';
COMMENT ON COLUMN boletos_notas.pago IS 'Boleto marcado como pago.';
COMMENT ON COLUMN boletos_notas.pago_em IS 'Momento em que foi marcado como pago.';
COMMENT ON COLUMN boletos_notas.pago_por_usuario_id IS 'Usuário que marcou como pago.';
COMMENT ON COLUMN boletos_notas.pagamento_desfeito_em IS 'Momento do último desfazer de pagamento.';
COMMENT ON COLUMN boletos_notas.pagamento_desfeito_por_usuario_id IS 'Usuário que desfez o pagamento.';
COMMENT ON COLUMN boletos_notas.pagamento_desfeito_motivo IS 'Motivo informado ao desfazer o pagamento.';
COMMENT ON COLUMN boletos_notas.deleted_at IS 'Soft delete: preenchido = excluído (fora das listagens e da unicidade da linha digitável).';
COMMENT ON COLUMN boletos_notas.deleted_by_usuario_id IS 'Usuário que excluiu (soft delete).';

-- 2) usuarios
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pode_marcar_pago BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN usuarios.pode_marcar_pago IS 'Permite marcar/desfazer pagamento de boleto. Admin é tratado no código (sempre pode).';

-- 3) boletos_anexos
CREATE TABLE IF NOT EXISTS boletos_anexos (
    id SERIAL PRIMARY KEY,
    boleto_id INTEGER REFERENCES boletos_notas(id) ON DELETE CASCADE,
    restaurante_id INTEGER NOT NULL REFERENCES restaurantes(id) ON DELETE CASCADE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    storage_chave TEXT NOT NULL,
    mime TEXT NOT NULL,
    tamanho_bytes INTEGER NOT NULL,
    hash_sha256 CHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_boletos_anexos_boleto ON boletos_anexos(boleto_id);
CREATE INDEX IF NOT EXISTS idx_boletos_anexos_restaurante_hash ON boletos_anexos(restaurante_id, hash_sha256);

COMMENT ON TABLE boletos_anexos IS 'Imagens/arquivos de boletos. boleto_id é nulo enquanto a imagem foi enviada mas o boleto ainda não foi salvo.';
COMMENT ON COLUMN boletos_anexos.storage_chave IS 'Chave/caminho do arquivo no armazenamento.';
COMMENT ON COLUMN boletos_anexos.hash_sha256 IS 'SHA-256 hex (64 caracteres) do conteúdo, para detectar reenvio da mesma imagem.';

-- 4) boletos_ocorrencias
CREATE TABLE IF NOT EXISTS boletos_ocorrencias (
    id SERIAL PRIMARY KEY,
    tipo TEXT NOT NULL,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    restaurante_id INTEGER REFERENCES restaurantes(id) ON DELETE CASCADE,
    boleto_existente_id INTEGER REFERENCES boletos_notas(id) ON DELETE SET NULL,
    linha_digitavel VARCHAR(48),
    visto_em TIMESTAMP,
    visto_por_usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT boletos_ocorrencias_tipo_check CHECK (tipo IN ('linha_duplicada'))
);

CREATE INDEX IF NOT EXISTS idx_boletos_ocorrencias_nao_vistas
    ON boletos_ocorrencias(created_at DESC)
    WHERE visto_em IS NULL;

COMMENT ON TABLE boletos_ocorrencias IS 'Alertas ao admin (ex.: tentativa de cadastrar linha digitável já existente).';
COMMENT ON COLUMN boletos_ocorrencias.boleto_existente_id IS 'Boleto que já possuía a linha digitável (NULL se foi removido definitivamente).';
COMMENT ON COLUMN boletos_ocorrencias.visto_em IS 'NULL = ainda não vista pelo admin.';
