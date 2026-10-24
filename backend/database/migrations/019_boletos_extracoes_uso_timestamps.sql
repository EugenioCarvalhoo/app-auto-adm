-- Alinha boletos_extracoes_uso entre ambientes. Em bancos que já tinham a tabela da versão antiga da leitura por IA
-- (criada sem created_at/updated_at), a 018 não a recriou; aqui acrescentamos o que falta.
-- Aditiva e idempotente (sem DROP/DELETE).
ALTER TABLE boletos_extracoes_uso ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE boletos_extracoes_uso ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
