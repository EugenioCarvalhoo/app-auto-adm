-- Remove o legado fora do escopo (gastos, relatórios e estoque), autorizado pelo dono do projeto:
-- os dados de gastos e estoque podem ser apagados. DESTRUTIVA: faça backup (pg_dump) antes de aplicar.
--
-- Os usuários que tinham modulo_financeiro já ganharam modulo_boletos (014) e vínculo com os
-- restaurantes (015), então ninguém perde o acesso a boletos. Quem só tinha estoque fica sem módulo
-- até o admin liberar boletos.
-- Sem CASCADE de propósito: se algo inesperado depender dessas tabelas, a migration falha (e reverte).

DROP TABLE IF EXISTS estoque_movimentos;
DROP TABLE IF EXISTS estoque_lancamentos_diarios;
DROP TABLE IF EXISTS estoque_produtos;
DROP TABLE IF EXISTS estoque_categorias;
DROP FUNCTION IF EXISTS estoque_movimentos_preencher_tipo_quantidade();

DROP TABLE IF EXISTS gastos;

ALTER TABLE usuarios
  DROP COLUMN IF EXISTS modulo_financeiro,
  DROP COLUMN IF EXISTS modulo_estoque,
  DROP COLUMN IF EXISTS modulo_estoque_simplificado,
  DROP COLUMN IF EXISTS somente_estoque;
