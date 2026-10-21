const { prepararBanco } = require('./support/db');

module.exports = async () => {
  await prepararBanco();
};
