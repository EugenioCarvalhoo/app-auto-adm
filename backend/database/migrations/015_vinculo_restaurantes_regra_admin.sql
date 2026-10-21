-- Regra de negócio: só o admin enxerga todos os restaurantes; os demais usuários
-- acessam apenas os restaurantes vinculados em usuario_restaurante_estoque.
-- Quem tinha acesso livre (modulo_financeiro) é vinculado a todos os restaurantes ativos
-- para não perder acesso; o admin ajusta os vínculos depois pela tela de permissões.
INSERT INTO usuario_restaurante_estoque (usuario_id, restaurante_id)
SELECT u.id, r.id
FROM usuarios u
CROSS JOIN restaurantes r
WHERE COALESCE(u.is_admin, false) = false
  AND COALESCE(u.modulo_financeiro, false) = true
  AND COALESCE(r.ativo, true) = true
ON CONFLICT (usuario_id, restaurante_id) DO NOTHING;

