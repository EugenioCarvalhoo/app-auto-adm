-- Contador diário de leituras de boleto por IA, por usuário (teto diário).
-- Não destrutiva e idempotente.
CREATE TABLE IF NOT EXISTS boletos_extracoes_uso (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  dia DATE NOT NULL,
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  PRIMARY KEY (usuario_id, dia)
);

COMMENT ON TABLE boletos_extracoes_uso IS
  'Contador diário de leituras de boleto por IA por usuário (teto diário). dia = data em America/Sao_Paulo. Incremento atômico via INSERT ... ON CONFLICT (usuario_id, dia) DO UPDATE SET total = boletos_extracoes_uso.total + 1.';

-- Garante 1 imagem por boleto, inclusive com dois envios simultâneos.
-- Anexos ainda não vinculados (boleto_id NULL) ficam fora do índice.
-- Não apaga dados: se já houver 2+ anexos para o mesmo boleto, aborta com instrução de correção manual.
DO $$
DECLARE
  dup TEXT;
BEGIN
  IF to_regclass('uq_boletos_anexos_boleto') IS NULL THEN
    SELECT string_agg(boleto_id || ' (' || total || ' anexos)', ', ' ORDER BY boleto_id)
      INTO dup
      FROM (
        SELECT boleto_id, COUNT(*) AS total
          FROM boletos_anexos
         WHERE boleto_id IS NOT NULL
         GROUP BY boleto_id
        HAVING COUNT(*) > 1
      ) d;
    IF dup IS NOT NULL THEN
      RAISE EXCEPTION 'Migration 019: boletos com mais de um anexo, impossível criar uq_boletos_anexos_boleto. Boletos: %. Resolva manualmente (após pg_dump): mantenha um anexo por boleto, p.ex. desvinculando os extras com UPDATE boletos_anexos SET boleto_id = NULL WHERE id = <id do anexo extra>, ou removendo-os depois de conferir; então reexecute o migrate.', dup;
    END IF;
    CREATE UNIQUE INDEX uq_boletos_anexos_boleto
      ON boletos_anexos(boleto_id)
      WHERE boleto_id IS NOT NULL;
  END IF;
END $$;
