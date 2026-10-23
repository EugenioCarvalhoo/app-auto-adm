/**
 * No Windows o Docker roda dentro do WSL2, que desliga a distro ao ficar ocioso e derruba o Postgres de teste
 * no meio da suíte ("the database system is shutting down" / ECONNREFUSED). Mantemos um `sleep infinity`
 * na distro enquanto o processo de teste vive. Em Linux/macOS não faz nada.
 * Usado por `scripts/test.js` (Jest) e `e2e/support/db.js` (Playwright).
 */
const { spawn } = require('child_process');

let keepalive = null;

function manterWslAcordado(distro = process.env.WSL_DISTRO || 'Ubuntu') {
  if (process.platform !== 'win32' || keepalive) return;
  keepalive = spawn('wsl', ['-d', distro, '--', 'sleep', 'infinity'], { stdio: 'ignore', windowsHide: true });
  keepalive.on('error', () => {});
  keepalive.unref();
  process.on('exit', () => {
    if (keepalive) keepalive.kill();
  });
}

module.exports = { manterWslAcordado };
