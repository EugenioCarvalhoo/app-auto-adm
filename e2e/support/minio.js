/**
 * MinIO de teste para o E2E (mesmo container `minio-controle` do Jest, ver backend/test/README.md).
 * Best effort: se não houver Docker/MinIO, segue sem ele e os testes que dependem dele PULAM.
 */
const path = require('path');
const { spawnSync } = require('child_process');
const { minio } = require('./env');
const { minioAcessivel, garantirBucket } = require(path.join(__dirname, '..', '..', 'backend', 'test', 'helpers', 'minio.js'));

const DISTRO = process.env.WSL_DISTRO || 'Ubuntu';
const NOME = process.env.TEST_MINIO_CONTAINER || 'minio-controle';
const IMAGEM = process.env.TEST_MINIO_IMAGE || 'cgr.dev/chainguard/minio:latest';
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function docker(args) {
  const [cmd, a] = process.platform === 'win32' ? ['wsl', ['-d', DISTRO, '--', 'docker', ...args]] : ['docker', args];
  const r = spawnSync(cmd, a, { encoding: 'utf8' });
  return r.error ? { status: 1, stdout: '', stderr: r.error.message } : r;
}

/** true se o MinIO de teste está no ar e com o bucket pronto. Nunca lança. */
async function prepararMinio() {
  try {
    if (!(await minioAcessivel(minio))) {
      const url = new URL(minio.endpoint);
      if (process.env.TEST_MINIO_AUTOSTART === '0' || !['127.0.0.1', 'localhost'].includes(url.hostname)) return false;
      if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) return false;
      const estado = docker(['ps', '-a', '--filter', `name=^/${NOME}$`, '--format', '{{.State}}']).stdout.trim();
      const porta = url.port || '9100';
      const r = estado
        ? estado === 'running' ? { status: 0 } : docker(['start', NOME])
        : docker([
            'run', '-d', '--name', NOME, '--user', '0',
            '-p', `127.0.0.1:${porta}:9000`, '-p', `127.0.0.1:${Number(porta) + 1}:9001`,
            '-e', `MINIO_ROOT_USER=${minio.accessKey}`, '-e', `MINIO_ROOT_PASSWORD=${minio.secretKey}`,
            IMAGEM, 'server', '/data', '--console-address', ':9001'
          ]);
      if (r.status !== 0) return false;
      for (let i = 0; i < 30 && !(await minioAcessivel(minio)); i += 1) await dormir(1000);
      if (!(await minioAcessivel(minio))) return false;
    }
    await garantirBucket(minio);
    return true;
  } catch {
    return false;
  }
}

module.exports = { prepararMinio };
