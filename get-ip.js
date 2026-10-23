// Script para descobrir o IP local da máquina
const os = require('os');

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Ignora endereços internos (não IPv4) e não-internos
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({
          interface: name,
          address: iface.address
        });
      }
    }
  }
  
  return addresses;
}

const ips = getLocalIP();
console.log('\n=== IPs da sua máquina na rede local ===\n');
if (ips.length === 0) {
  console.log('Nenhum IP encontrado. Verifique sua conexão de rede.');
} else {
  ips.forEach(({ interface, address }) => {
    console.log(`Interface: ${interface}`);
    console.log(`IP: ${address}`);
    console.log(`\nAcesse pelo celular usando:`);
    console.log(`Frontend: http://${address}:3000`);
    console.log(`Backend:  http://${address}:5000`);
    console.log('---\n');
  });
}

console.log('\n⚠️  IMPORTANTE:');
console.log('1. Certifique-se de que o celular está na mesma rede Wi-Fi');
console.log('2. Desative o firewall temporariamente ou permita as portas 3000 e 5000');
console.log('3. No celular, acesse o IP mostrado acima na porta 3000\n');

