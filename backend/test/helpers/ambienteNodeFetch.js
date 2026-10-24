/**
 * Ambiente Jest para os testes do adaptador do Gemini (fetch) contra um servidor local.
 *
 * O SDK faz fetch pelo dispatcher global do undici (`Symbol.for('undici.globalDispatcher.1')`). Dentro do
 * sandbox do Jest esse símbolo não existe no `globalThis` do teste, e a chamada falha com
 * "Undici globalDispatcher is not available" antes de sair da máquina. Aqui copiamos o dispatcher do
 * realm externo (onde o Node o inicializa) para o sandbox. Só afeta arquivos que apontam para este ambiente.
 */
const { TestEnvironment: NodeEnvironment } = require('jest-environment-node');

const SIMBOLO_DISPATCHER = Symbol.for('undici.globalDispatcher.1');

class AmbienteNodeFetch extends NodeEnvironment {
  constructor(config, context) {
    super(config, context);
    // Headers dispara a inicialização preguiçosa do undici no realm externo.
    new Headers();
    const dispatcher = globalThis[SIMBOLO_DISPATCHER];
    if (dispatcher) this.global[SIMBOLO_DISPATCHER] = dispatcher;
  }
}

module.exports = AmbienteNodeFetch;
