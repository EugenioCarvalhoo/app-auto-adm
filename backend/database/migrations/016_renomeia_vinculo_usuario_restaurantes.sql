-- Renomeia o vínculo usuário↔restaurante: o nome antigo (usuario_restaurante_estoque) vinha do módulo
-- de estoque, mas hoje a tabela serve a toda restrição por restaurante (boletos incluídos).
-- Não destrutivo: só renomeia; dados, chaves e FKs permanecem. Idempotente.
DO $$
BEGIN
  IF to_regclass('public.usuario_restaurante_estoque') IS NOT NULL
     AND to_regclass('public.usuario_restaurantes') IS NULL THEN
    ALTER TABLE usuario_restaurante_estoque RENAME TO usuario_restaurantes;
  END IF;
END $$;

ALTER INDEX IF EXISTS idx_ure_usuario RENAME TO idx_usuario_restaurantes_usuario;
ALTER INDEX IF EXISTS idx_ure_restaurante RENAME TO idx_usuario_restaurantes_restaurante;
ALTER INDEX IF EXISTS usuario_restaurante_estoque_pkey RENAME TO usuario_restaurantes_pkey;

COMMENT ON TABLE usuario_restaurantes IS 'Restaurantes que cada usuário não-admin pode acessar (liberados pelo admin).';
