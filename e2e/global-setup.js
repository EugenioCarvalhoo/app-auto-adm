const { prepararBanco } = require('./support/db');
const { prepararMinio } = require('./support/minio');

module.exports = async () => {
  await prepararBanco();
  if (!(await prepararMinio())) {
    console.warn('[e2e] MinIO de teste indisponível: os cenários com imagem real serão PULADOS (veja e2e/README.md).');
  }
};
