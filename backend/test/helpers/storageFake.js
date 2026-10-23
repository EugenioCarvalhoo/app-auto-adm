/**
 * Storages falsos para os testes (nenhum S3 de verdade). Mesma interface de lib/storage.ts.
 *  - criarStorageFake(): em memória, com injeção de falhas (para o processo do Jest).
 *  - criarStorageEmDisco(dir): em diretório temporário (para o processo filho de limpar-boletos, que não
 *    compartilha memória com o teste; ver preloadStorageFake.js).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MIMES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const CHAVE_RE = /^\d{1,10}\/[a-f0-9]{32}\.(jpg|png|webp)$/;

function novaChave(restauranteId, extensao) {
  const ext = String(extensao).toLowerCase();
  if (!MIMES[ext]) throw new Error('Extensão não permitida');
  return `${restauranteId}/${crypto.randomBytes(16).toString('hex')}.${ext}`;
}
function validar(chave) {
  if (typeof chave !== 'string' || !CHAVE_RE.test(chave)) throw new Error('Chave de armazenamento inválida');
}
const mimeDaChave = (chave) => MIMES[chave.split('.').pop()];

function criarStorageFake() {
  const objetos = new Map();
  const s = {
    objetos,
    /** Próxima chamada de salvar/ler/apagar rejeita com este erro (uma vez, ou sempre se `sempre`). */
    falhar: { salvar: null, ler: null, apagar: null },
    chamadas: { salvar: 0, ler: 0, apagar: 0 },
    chaves: () => [...objetos.keys()],
    async salvar(restauranteId, conteudo, extensao) {
      s.chamadas.salvar++;
      if (s.falhar.salvar) throw s.falhar.salvar;
      const chave = novaChave(restauranteId, extensao);
      objetos.set(chave, { conteudo: Buffer.from(conteudo), mime: mimeDaChave(chave) });
      return chave;
    },
    async ler(chave) {
      s.chamadas.ler++;
      if (s.falhar.ler) throw s.falhar.ler;
      validar(chave);
      const o = objetos.get(chave);
      if (!o) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
      return { conteudo: Buffer.from(o.conteudo), mime: o.mime };
    },
    async apagar(chave) {
      s.chamadas.apagar++;
      if (s.falhar.apagar) throw s.falhar.apagar;
      validar(chave);
      objetos.delete(chave);
    }
  };
  return s;
}

function criarStorageEmDisco(dir) {
  return {
    async salvar(restauranteId, conteudo, extensao) {
      const chave = novaChave(restauranteId, extensao);
      fs.mkdirSync(path.join(dir, String(restauranteId)), { recursive: true });
      fs.writeFileSync(path.join(dir, chave), conteudo);
      return chave;
    },
    async ler(chave) {
      validar(chave);
      return { conteudo: fs.readFileSync(path.join(dir, chave)), mime: mimeDaChave(chave) };
    },
    async apagar(chave) {
      validar(chave);
      try {
        fs.unlinkSync(path.join(dir, chave));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
  };
}

module.exports = { criarStorageFake, criarStorageEmDisco };
