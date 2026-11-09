// Viaturas do CMBEL — servidor sem dependências (Node 22.5+, SQLite embutido).
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8081);
const SENHA_INICIAL = '123';
const ANTECEDENCIA_MS = 48 * 3600 * 1000;

fs.mkdirSync(path.join(DIR, 'data'), { recursive: true });
const db = new DatabaseSync(process.env.DB_PATH || path.join(DIR, 'data/viaturas.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (identidade TEXT PRIMARY KEY, senha TEXT, nome TEXT, posto TEXT,
  trocar_senha INTEGER DEFAULT 1, falhas INTEGER DEFAULT 0, bloqueado_ate INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessoes (token TEXT PRIMARY KEY, identidade TEXT, criado INTEGER);
CREATE TABLE IF NOT EXISTS viaturas (id TEXT PRIMARY KEY, nome TEXT, tipo TEXT, placa TEXT);
CREATE TABLE IF NOT EXISTS pedidos (id INTEGER PRIMARY KEY AUTOINCREMENT, viatura TEXT, identidade TEXT,
  inicio INTEGER, fim INTEGER, destino TEXT, missao TEXT, criado INTEGER);
`);

try { db.exec('ALTER TABLE viaturas ADD COLUMN disponivel INTEGER DEFAULT 1'); db.exec('ALTER TABLE viaturas ADD COLUMN motivo TEXT'); } catch {}
// Frota inicial (a Fiscalização ajusta pela Área do Fiscal).
const AGUARDANDO = 'Aguardando informação da Fiscalização';
for (const [id, nome, tipo, disp] of [['onibus', 'Ônibus', 'onibus', 1], ['ambulancia', 'Ambulância', 'ambulancia', 1], ['doblo', 'Fiat Doblò', 'doblo', 1],
  ['cmt', 'Viatura do Cmt', 'sedan', 1], ['5ton', 'Caminhão 5 Ton', 'caminhao', 0], ['spin', 'Chevrolet Spin', 'van', 0], ['versa', 'Nissan Versa', 'sedan', 0]])
  db.prepare('INSERT OR IGNORE INTO viaturas (id, nome, tipo, placa, disponivel, motivo) VALUES (?,?,?,?,?,?)').run(id, nome, tipo, '', disp, disp ? null : AGUARDANDO);
const TIPOS = ['onibus', 'ambulancia', 'doblo', 'caminhao', 'van', 'sedan'];
const FISCAL_USUARIO = (process.env.FISCAL_USUARIO || 'FISCAL').toUpperCase();
const FISCAL_SENHA = process.env.FISCAL_SENHA || 'FISCAL2026';
let fiscalFalhas = 0, fiscalBloqueio = 0; // ponytail: bloqueio único em memória (zera ao reiniciar)

for (const col of ['completo', 'secao']) try { db.exec(`ALTER TABLE usuarios ADD COLUMN ${col} TEXT`); } catch {}

const hash = (s) => { const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}$${crypto.scryptSync(String(s), salt, 64).toString('hex')}`; };
const confere = (s, h) => { const [salt, k] = String(h).split('$');
  return !!k && crypto.timingSafeEqual(crypto.scryptSync(String(s), salt, 64), Buffer.from(k, 'hex')); };

// Regra central: 48h de antecedência e sem choque de horário na mesma viatura.
export function validarPedido({ inicio, fim }, agora, existentes) {
  if (!(inicio > 0 && fim > inicio)) return 'A volta precisa ser depois da saída.';
  if (inicio - agora < ANTECEDENCIA_MS) return 'O pedido precisa de 48 horas de antecedência.';
  const choque = existentes.find((p) => inicio < p.fim && fim > p.inicio);
  if (choque) return `Viatura já reservada nesse horário (${choque.posto || ''} ${choque.nome || ''}).`.replace(/\s+/g, ' ');
  return null;
}

// Mesmas regras do Rancho do CMBEL.
const normId = (v) => { const d = String(v || '').replace(/[\s.\-/]/g, ''); return /^\d{6,12}$/.test(d) ? d : null; };
const comparavel = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const senhaFraca = (s) => (s.length < 6 ? 'A nova senha precisa ter pelo menos 6 caracteres.'
  : s === SENHA_INICIAL || /^(\d)\1+$/.test(s) || '1234567890'.includes(s) ? 'Escolha uma senha menos óbvia (evite sequências ou números repetidos).' : null);
const contarFalha = (u) => { const f = u.falhas + 1;
  db.prepare('UPDATE usuarios SET falhas=?, bloqueado_ate=? WHERE identidade=?').run(f >= 5 ? 0 : f, f >= 5 ? Date.now() + 15 * 60000 : 0, u.identidade);
  return f >= 5; };
const contasPorIp = new Map(); // ponytail: limite por IP em memória (zera ao reiniciar), igual ao Rancho

const usuarioDa = (req) => {
  const t = /(?:^|;\s*)vt=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
  return t && db.prepare('SELECT u.* FROM sessoes s JOIN usuarios u USING(identidade) WHERE token=?').get(t);
};
const publico = (u) => u && { identidade: u.identidade, nome: u.nome, posto: u.posto, trocarSenha: !!u.trocar_senha };

async function api(req, res, rota) {
  const body = req.method === 'POST' ? JSON.parse((await new Promise((r) => {
    let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d));
  })) || '{}') : {};
  const json = (code, obj, extra = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...extra }); res.end(JSON.stringify(obj)); };

  if (rota === 'POST /api/criar-conta') {
    const id = normId(body.identidade);
    if (!id) return json(400, { erro: 'Digite a identidade militar (somente números, de 6 a 12 dígitos).' });
    if (db.prepare('SELECT 1 FROM usuarios WHERE identidade=?').get(id)) return json(409, { erro: 'Essa identidade já tem conta. Volte e entre com sua senha.' });
    const ip = req.socket.remoteAddress, agora = Date.now(), janela = (contasPorIp.get(ip) || []).filter((t) => agora - t < 3600000);
    if (janela.length >= 30) return json(429, { erro: 'Muitas contas criadas deste computador. Tente mais tarde.' });
    contasPorIp.set(ip, [...janela, agora]);
    db.prepare('INSERT INTO usuarios (identidade, senha) VALUES (?,?)').run(id, hash(SENHA_INICIAL));
    return json(201, {});
  }

  if (rota === 'POST /api/recuperar-senha') {
    const id = normId(body.identidade), invalido = 'Os dados não conferem com o cadastro desta identidade.';
    if (!id) return json(400, { erro: 'Digite a identidade militar (somente números).' });
    const u = db.prepare('SELECT * FROM usuarios WHERE identidade=?').get(id);
    if (!u) return json(400, { erro: invalido });
    if (u.bloqueado_ate > Date.now()) return json(429, { erro: 'Muitas tentativas erradas. Tente de novo em 15 minutos.' });
    if (!u.completo || !u.nome || !u.posto || !u.secao) return json(400, { erro: 'Esta conta ainda não tem dados cadastrados. Procure a Informática para redefinir a senha.' });
    if (!['completo', 'nome', 'posto', 'secao'].every((c) => comparavel(body[c]) === comparavel(u[c]))) { contarFalha(u); return json(400, { erro: invalido }); }
    const fraca = senhaFraca(String(body.senha || ''));
    if (fraca) return json(400, { erro: fraca });
    db.prepare('UPDATE usuarios SET senha=?, trocar_senha=0, falhas=0, bloqueado_ate=0 WHERE identidade=?').run(hash(body.senha), id);
    db.prepare('DELETE FROM sessoes WHERE identidade=?').run(id);
    return json(200, {});
  }

  if (rota === 'POST /api/login') {
    const id = normId(body.identidade);
    if (!id || !body.senha) return json(400, { erro: 'Informe a identidade e a senha.' });
    const u = db.prepare('SELECT * FROM usuarios WHERE identidade=?').get(id);
    if (!u) return json(401, { erro: 'Identidade sem conta. Toque em "Criar conta" primeiro.' });
    if (u.bloqueado_ate > Date.now()) return json(429, { erro: `Muitas tentativas erradas. Tente novamente após ${new Date(u.bloqueado_ate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.` });
    if (!confere(body.senha, u.senha)) return json(401, { erro: contarFalha(u) ? 'Senha errada 5 vezes. Acesso bloqueado por 15 minutos.' : 'Identidade ou senha inválidas.' });
    db.prepare('UPDATE usuarios SET falhas=0, bloqueado_ate=0 WHERE identidade=?').run(id);
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessoes VALUES (?,?,?)').run(token, id, Date.now());
    return json(200, publico(u), { 'Set-Cookie': `vt=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` });
  }

  if (rota.startsWith('POST /api/fiscal/')) {
    if (fiscalBloqueio > Date.now()) return json(429, { erro: 'Muitas tentativas erradas. Tente de novo em 15 minutos.' });
    if (String(body.usuario_fiscal || '').trim().toUpperCase() !== FISCAL_USUARIO || String(body.senha_fiscal || '') !== FISCAL_SENHA) {
      if (++fiscalFalhas >= 5) { fiscalFalhas = 0; fiscalBloqueio = Date.now() + 15 * 60000; }
      return json(401, { erro: 'Usuário ou senha da Fiscalização incorretos.' });
    }
    fiscalFalhas = 0;
    if (rota === 'POST /api/fiscal/entrar') return json(200, {
      viaturas: db.prepare('SELECT * FROM viaturas').all(),
      pedidos: db.prepare('SELECT p.*, u.nome, u.posto FROM pedidos p JOIN usuarios u USING(identidade) ORDER BY inicio').all(),
      usuarios: db.prepare('SELECT identidade, completo, nome, posto, secao, trocar_senha FROM usuarios ORDER BY nome').all(),
    });
    if (rota === 'POST /api/fiscal/pedido') {
      const p = { id: Number(body.id), viatura: String(body.viatura), inicio: Number(body.inicio), fim: Number(body.fim),
        destino: String(body.destino || '').trim().slice(0, 200), missao: String(body.missao || '').trim().slice(0, 500) };
      if (!db.prepare('SELECT 1 FROM viaturas WHERE id=?').get(p.viatura)) return json(400, { erro: 'Viatura inválida.' });
      if (!p.destino || !p.missao) return json(400, { erro: 'Informe destino e missão.' });
      const outros = db.prepare('SELECT p.*, u.nome, u.posto FROM pedidos p JOIN usuarios u USING(identidade) WHERE viatura=? AND id<>?').all(p.viatura, p.id);
      const erro = validarPedido(p, 0, outros); // agora=0: a Fiscalização não precisa respeitar as 48h
      if (erro) return json(409, { erro });
      db.prepare('UPDATE pedidos SET viatura=?, inicio=?, fim=?, destino=?, missao=? WHERE id=?').run(p.viatura, p.inicio, p.fim, p.destino, p.missao, p.id);
      return json(200, {});
    }
    if (rota === 'POST /api/fiscal/pedido-excluir') { db.prepare('DELETE FROM pedidos WHERE id=?').run(Number(body.id)); return json(200, {}); }
    if (rota === 'POST /api/fiscal/usuario') {
      const d = Object.fromEntries(['completo', 'nome', 'posto', 'secao'].map((k) => [k, String(body[k] || '').trim()]));
      db.prepare('UPDATE usuarios SET completo=?, nome=?, posto=?, secao=? WHERE identidade=?').run(d.completo, d.nome.toUpperCase(), d.posto, d.secao, String(body.identidade));
      return json(200, {});
    }
    if (rota === 'POST /api/fiscal/usuario-zerar') {
      db.prepare('UPDATE usuarios SET senha=?, trocar_senha=1, falhas=0, bloqueado_ate=0 WHERE identidade=?').run(hash(SENHA_INICIAL), String(body.identidade));
      db.prepare('DELETE FROM sessoes WHERE identidade=?').run(String(body.identidade));
      return json(200, {});
    }
    if (rota === 'POST /api/fiscal/usuario-excluir') {
      for (const t of ['pedidos', 'sessoes', 'usuarios']) db.prepare(`DELETE FROM ${t} WHERE identidade=?`).run(String(body.identidade));
      return json(200, {});
    }
    if (rota === 'POST /api/fiscal/viatura') {
      const nome = String(body.nome || '').trim().slice(0, 60), tipo = String(body.tipo), disp = body.disponivel ? 1 : 0, motivo = String(body.motivo || '').trim().slice(0, 200);
      if (!nome || !TIPOS.includes(tipo)) return json(400, { erro: 'Informe nome e tipo da viatura.' });
      if (!disp && !motivo) return json(400, { erro: 'Informe o motivo da indisponibilidade.' });
      const id = body.id || `vt${Date.now().toString(36)}`;
      db.prepare(`INSERT INTO viaturas (id, nome, tipo, placa, disponivel, motivo) VALUES (?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET nome=excluded.nome, tipo=excluded.tipo, placa=excluded.placa, disponivel=excluded.disponivel, motivo=excluded.motivo`)
        .run(id, nome, tipo, String(body.placa || '').trim().slice(0, 10), disp, disp ? null : motivo);
      return json(200, {});
    }
    if (rota === 'POST /api/fiscal/remover') {
      db.prepare('DELETE FROM pedidos WHERE viatura=?').run(String(body.id));
      db.prepare('DELETE FROM viaturas WHERE id=?').run(String(body.id));
      return json(200, {});
    }
  }
  const u = usuarioDa(req);
  if (!u) return json(401, { erro: 'Faça login.' });

  if (rota === 'GET /api/eu') return json(200, publico(u));
  if (rota === 'POST /api/sair') { db.prepare('DELETE FROM sessoes WHERE identidade=?').run(u.identidade); return json(200, {}); }
  if (rota === 'POST /api/perfil') {
    const s = String(body.senha || ''), d = Object.fromEntries(['completo', 'nome', 'posto', 'secao'].map((k) => [k, String(body[k] || '').trim()]));
    const fraca = senhaFraca(s);
    if (fraca) return json(400, { erro: fraca });
    if (Object.values(d).some((v) => !v)) return json(400, { erro: 'Preencha todos os campos.' });
    db.prepare('UPDATE usuarios SET senha=?, completo=?, nome=?, posto=?, secao=?, trocar_senha=0 WHERE identidade=?')
      .run(hash(s), d.completo, d.nome.toUpperCase(), d.posto, d.secao, u.identidade);
    return json(200, {});
  }
  if (u.trocar_senha) return json(403, { erro: 'Troque a senha primeiro.' });

  if (rota === 'GET /api/frota') {
    const pedidos = db.prepare(`SELECT p.*, u.nome, u.posto FROM pedidos p JOIN usuarios u USING(identidade)
      WHERE fim > ? ORDER BY inicio`).all(Date.now() - 86400000);
    return json(200, { viaturas: db.prepare('SELECT * FROM viaturas').all(), pedidos, agora: Date.now() });
  }
  if (rota === 'POST /api/pedido') {
    const p = { viatura: String(body.viatura), inicio: Number(body.inicio), fim: Number(body.fim),
      destino: String(body.destino || '').trim().slice(0, 200), missao: String(body.missao || '').trim().slice(0, 500) };
    const vt = db.prepare('SELECT * FROM viaturas WHERE id=?').get(p.viatura);
    if (!vt) return json(400, { erro: 'Viatura inválida.' });
    if (!vt.disponivel) return json(409, { erro: `Viatura indisponível: ${vt.motivo || 'sem motivo informado'}.` });
    if (!p.destino || !p.missao) return json(400, { erro: 'Informe destino e missão.' });
    const existentes = db.prepare('SELECT p.*, u.nome, u.posto FROM pedidos p JOIN usuarios u USING(identidade) WHERE viatura=?').all(p.viatura);
    const erro = validarPedido(p, Date.now(), existentes);
    if (erro) return json(409, { erro });
    db.prepare('INSERT INTO pedidos (viatura, identidade, inicio, fim, destino, missao, criado) VALUES (?,?,?,?,?,?,?)')
      .run(p.viatura, u.identidade, p.inicio, p.fim, p.destino, p.missao, Date.now());
    return json(200, {});
  }
  if (rota === 'POST /api/cancelar') {
    db.prepare('DELETE FROM pedidos WHERE id=? AND identidade=?').run(Number(body.id), u.identidade);
    return json(200, {});
  }
  json(404, { erro: 'Rota inexistente.' });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    try {
      if (url.startsWith('/api/')) return await api(req, res, `${req.method} ${url}`);
      const img = /^\/img\/([\w-]+\.(jpg|png))$/.exec(url);
      if (img) { res.writeHead(200, { 'Content-Type': `image/${img[2] === 'jpg' ? 'jpeg' : 'png'}`, 'Cache-Control': 'max-age=86400' });
        return res.end(fs.readFileSync(path.join(DIR, 'web/img', img[1]))); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(DIR, 'web/index.html')));
    } catch (e) { console.error(e); res.writeHead(500); res.end('{"erro":"Erro no servidor."}'); }
  }).listen(PORT, () => console.log(`Viaturas CMBEL em http://localhost:${PORT}`));
}
