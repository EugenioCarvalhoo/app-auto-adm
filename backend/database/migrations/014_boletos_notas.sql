-- Módulo de cadastramento de boletos e notas (planilha do cliente)

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS modulo_boletos BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN usuarios.modulo_boletos IS 'Acesso ao cadastramento de boletos e notas, totais semanais e metas de gasto.';

UPDATE usuarios
SET modulo_boletos = true
WHERE is_admin = true;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'usuarios' AND column_name = 'modulo_financeiro'
  ) THEN
    UPDATE usuarios
    SET modulo_boletos = true
    WHERE COALESCE(modulo_financeiro, false) = true;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS boletos_notas (
    id SERIAL PRIMARY KEY,
    restaurante_id INTEGER NOT NULL REFERENCES restaurantes(id) ON DELETE CASCADE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    dt_recebimento DATE,
    dt_vencimento DATE,
    descricao TEXT NOT NULL DEFAULT '',
    valor NUMERIC(14, 2) NOT NULL DEFAULT 0,
    tipo TEXT NOT NULL DEFAULT 'Boleto',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT boletos_notas_tipo_check CHECK (tipo IN ('Boleto', 'Sem Boleto'))
);

CREATE INDEX IF NOT EXISTS idx_boletos_notas_restaurante
    ON boletos_notas(restaurante_id, dt_recebimento DESC);

COMMENT ON TABLE boletos_notas IS
    'Lançamentos da planilha HOME / TB_BOLTETOS_NOTAS: recebimento, vencimento, descrição, valor e tipo.';

CREATE TABLE IF NOT EXISTS boletos_metas_gasto (
    id SERIAL PRIMARY KEY,
    restaurante_id INTEGER NOT NULL REFERENCES restaurantes(id) ON DELETE CASCADE,
    data_referencia DATE NOT NULL,
    semana_chave TEXT NOT NULL,
    semana_inicio DATE NOT NULL,
    semana_fim DATE NOT NULL,
    maximo_gasto NUMERIC(14, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT boletos_metas_semana_unique UNIQUE (restaurante_id, semana_chave)
);

CREATE INDEX IF NOT EXISTS idx_boletos_metas_restaurante
    ON boletos_metas_gasto(restaurante_id, semana_inicio);

COMMENT ON TABLE boletos_metas_gasto IS
    'Meta de gasto por semana sábado–sexta (TB_META_GASTO). A data de referência cai dentro da semana.';
