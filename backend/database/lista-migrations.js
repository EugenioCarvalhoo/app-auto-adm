// Lista ordenada das migrations.
// Ao criar uma migration, adicione aqui; a API verifica no boot se todas estão em schema_migrations.
const MIGRATIONS = [
  '001_create_gastos_table.sql',
  '002_create_usuarios_table.sql',
  '003_create_restaurantes_table.sql',
  '004_add_restaurante_id_to_gastos.sql',
  '005_create_restaurante_modelo_and_update_gastos.sql',
  '003_add_retroativo_to_gastos.sql',
  '006_estoque_modulo.sql',
  '007_usuario_restaurante_estoque.sql',
  '008_estoque_movimentos.sql',
  '009_estoque_movimentos_operacao_estorno.sql',
  '010_estoque_movimentos_trigger_defaults.sql',
  '011_estoque_produto_critica_foto.sql',
  '012_estoque_lancamentos_diarios.sql',
  '013_usuario_modulos_permissao.sql',
  '014_boletos_notas.sql',
  '015_vinculo_restaurantes_regra_admin.sql',
  '016_renomeia_vinculo_usuario_restaurantes.sql',
  '017_remove_legado_gastos_estoque.sql',
  '018_boletos_extracoes_uso.sql',
  '019_boletos_extracoes_uso_timestamps.sql'
];

module.exports = { MIGRATIONS };
