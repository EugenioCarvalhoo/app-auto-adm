/** Imagens mínimas (só a assinatura + bytes distintos por `seed`) para os testes de upload. Nunca vão ao Gemini. */
const jpeg = (seed = 1) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`jpeg-${seed}-`.repeat(8))]);
const png = (seed = 1) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`png-${seed}-`.repeat(8))]);
const webp = (seed = 1) =>
  Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from(`webp-${seed}-`.repeat(8))]);

module.exports = { jpeg, png, webp };
