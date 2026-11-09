// node --experimental-sqlite teste.js
process.env.DB_PATH = ':memory:';
const { validarPedido } = await import('./server.js');
import assert from 'node:assert';
const H = 3600000, agora = 0, base = 72 * H;
const ocupado = [{ inicio: base, fim: base + 4 * H, nome: 'SILVA', posto: 'Sgt' }];
assert.match(validarPedido({ inicio: 10 * H, fim: 12 * H }, agora, []), /48 horas/);
assert.match(validarPedido({ inicio: base + H, fim: base + 2 * H }, agora, ocupado), /SILVA/);
assert.equal(validarPedido({ inicio: base + 4 * H, fim: base + 8 * H }, agora, ocupado), null); // mesmo dia, depois da volta
assert.match(validarPedido({ inicio: base, fim: base - 1 }, agora, []), /volta/);
console.log('ok');
