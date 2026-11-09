// Versão de DEMONSTRAÇÃO: imita o servidor dentro do navegador (dados só neste aparelho).
// ponytail: senhas sem criptografia e regras só no navegador — serve para apresentar, não para uso real.
(() => {
  const H = 36e5, K = 'viaturas-demo';
  const carregar = () => { try { return JSON.parse(localStorage.getItem(K)); } catch { return null; } };
  let db = carregar();
  if (!db) {
    const d = (dias, h) => { const x = new Date(); x.setDate(x.getDate() + dias); x.setHours(h, 0, 0, 0); return +x; };
    const agora = new Date(); agora.setMinutes(0, 0, 0);
    db = {
      usuarios: {
        '100000001': { senha: 'demo-123456', nome: 'OLIVEIRA', posto: 'Cap', completo: 'Exemplo Oliveira', secao: 'Div Adm' },
        '100000002': { senha: 'demo-123456', nome: 'SANTOS', posto: '2º Sgt', completo: 'Exemplo Santos', secao: 'Corpo de Alunos' },
      },
      pedidos: [
        { id: 1, viatura: 'ambulancia', identidade: '100000002', inicio: +agora - H, fim: +agora + 3 * H, destino: 'Depósito da 8ª RM', missao: 'Transporte de material escolar' },
        { id: 2, viatura: 'onibus', identidade: '100000001', inicio: d(3, 8), fim: d(3, 12), destino: 'Aeroporto de Belém', missao: 'Buscar palestrante' },
        { id: 3, viatura: 'onibus', identidade: '100000002', inicio: d(3, 14), fim: d(3, 17), destino: 'Base Naval de Val-de-Cães', missao: 'Visita com alunos' },
      ],
      seq: 4, sessao: null,
      viaturas: [['onibus', 'Ônibus', 'onibus', 1], ['ambulancia', 'Ambulância', 'ambulancia', 1], ['doblo', 'Fiat Doblò', 'doblo', 1], ['cmt', 'Viatura do Cmt', 'sedan', 1],
        ['5ton', 'Caminhão 5 Ton', 'caminhao', 0], ['spin', 'Chevrolet Spin', 'van', 0], ['versa', 'Nissan Versa', 'sedan', 0]]
        .map(([id, nome, tipo, disponivel]) => ({ id, nome, tipo, placa: '', disponivel, motivo: disponivel ? null : 'Aguardando informação da Fiscalização' })),
    };
  }
  const salvar = () => { try { localStorage.setItem(K, JSON.stringify(db)); } catch {} };
  if (!db.viaturas) { localStorage.removeItem(K); location.reload(); } // demo antiga salva no aparelho
  const normId = (v) => { const x = String(v || '').replace(/[\s.\-/]/g, ''); return /^\d{6,12}$/.test(x) ? x : null; };
  const comp = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const fraca = (s) => (s.length < 6 ? 'A nova senha precisa ter pelo menos 6 caracteres.'
    : s === '123' || /^(\d)\1+$/.test(s) || '1234567890'.includes(s) ? 'Escolha uma senha menos óbvia (evite sequências ou números repetidos).' : null);
  const pub = (id) => { const u = db.usuarios[id]; return { identidade: id, nome: u.nome, posto: u.posto, trocarSenha: !!u.trocar }; };
  const com = (p) => ({ ...p, nome: db.usuarios[p.identidade]?.nome, posto: db.usuarios[p.identidade]?.posto });

  function rota(r, b) {
    if (r === 'POST /api/criar-conta') {
      const id = normId(b.identidade);
      if (!id) return [400, { erro: 'Digite a identidade militar (somente números, de 6 a 12 dígitos).' }];
      if (db.usuarios[id]) return [409, { erro: 'Essa identidade já tem conta. Volte e entre com sua senha.' }];
      db.usuarios[id] = { senha: '123', trocar: true }; return [201, {}];
    }
    if (r === 'POST /api/login') {
      const id = normId(b.identidade);
      if (!id) return [400, { erro: 'Digite a identidade militar (somente números).' }];
      if (!db.usuarios[id] && b.senha === '123') db.usuarios[id] = { senha: '123', trocar: true };
      const u = db.usuarios[id];
      if (!u) return [401, { erro: 'Identidade sem conta. No primeiro acesso use a senha 123.' }];
      if (u.senha !== b.senha) return [401, { erro: 'Identidade ou senha inválidas.' }];
      db.sessao = id; return [200, pub(id)];
    }
    if (r === 'POST /api/recuperar-senha') {
      const u = db.usuarios[normId(b.identidade)], inv = 'Os dados não conferem com o cadastro desta identidade.';
      if (!u) return [400, { erro: inv }];
      if (!u.completo) return [400, { erro: 'Esta conta ainda não tem dados cadastrados. Procure a Informática para redefinir a senha.' }];
      if (!['completo', 'nome', 'posto', 'secao'].every((c) => comp(b[c]) === comp(u[c]))) return [400, { erro: inv }];
      const f = fraca(String(b.senha || '')); if (f) return [400, { erro: f }];
      u.senha = b.senha; u.trocar = false; return [200, {}];
    }
    if (r.startsWith('POST /api/fiscal/')) {
      if (String(b.usuario_fiscal || '').trim().toUpperCase() !== 'FISCAL' || b.senha_fiscal !== 'FISCAL2026') return [401, { erro: 'Usuário ou senha da Fiscalização incorretos.' }];
      if (r === 'POST /api/fiscal/entrar') return [200, { viaturas: db.viaturas, pedidos: [...db.pedidos].sort((a, c) => a.inicio - c.inicio).map(com),
        usuarios: Object.entries(db.usuarios).map(([identidade, u]) => ({ identidade, ...u, senha: undefined })) }];
      if (r === 'POST /api/fiscal/pedido') {
        const p = db.pedidos.find((x) => x.id === +b.id); if (!p) return [404, { erro: 'Missão não encontrada.' }];
        const n = { viatura: b.viatura, inicio: +b.inicio, fim: +b.fim, destino: String(b.destino || '').trim(), missao: String(b.missao || '').trim() };
        if (!(n.fim > n.inicio)) return [409, { erro: 'A volta precisa ser depois da saída.' }];
        const c = db.pedidos.find((x) => x.id !== p.id && x.viatura === n.viatura && n.inicio < x.fim && n.fim > x.inicio);
        if (c) return [409, { erro: `Viatura já reservada nesse horário (${com(c).posto} ${com(c).nome}).` }];
        Object.assign(p, n);
      }
      if (r === 'POST /api/fiscal/pedido-excluir') db.pedidos = db.pedidos.filter((x) => x.id !== +b.id);
      if (r === 'POST /api/fiscal/usuario') Object.assign(db.usuarios[b.identidade], { completo: b.completo, nome: String(b.nome).toUpperCase(), posto: b.posto, secao: b.secao });
      if (r === 'POST /api/fiscal/usuario-zerar') Object.assign(db.usuarios[b.identidade], { senha: '123', trocar: true });
      if (r === 'POST /api/fiscal/usuario-excluir') { delete db.usuarios[b.identidade]; db.pedidos = db.pedidos.filter((x) => x.identidade !== b.identidade); if (db.sessao === b.identidade) db.sessao = null; }
      if (r === 'POST /api/fiscal/viatura') {
        const nome = String(b.nome || '').trim(), disp = b.disponivel ? 1 : 0, motivo = String(b.motivo || '').trim();
        if (!nome) return [400, { erro: 'Informe nome e tipo da viatura.' }];
        if (!disp && !motivo) return [400, { erro: 'Informe o motivo da indisponibilidade.' }];
        const v = { id: b.id || `vt${Date.now().toString(36)}`, nome, tipo: b.tipo, placa: String(b.placa || '').trim(), disponivel: disp, motivo: disp ? null : motivo };
        const i = db.viaturas.findIndex((x) => x.id === v.id); i >= 0 ? (db.viaturas[i] = v) : db.viaturas.push(v);
      }
      if (r === 'POST /api/fiscal/remover') { db.viaturas = db.viaturas.filter((v) => v.id !== b.id); db.pedidos = db.pedidos.filter((p) => p.viatura !== b.id); }
      return [200, {}];
    }
    const id = db.sessao;
    if (!id || !db.usuarios[id]) return [401, { erro: 'Faça login.' }];
    const u = db.usuarios[id];
    if (r === 'GET /api/eu') return [200, pub(id)];
    if (r === 'POST /api/sair') { db.sessao = null; return [200, {}]; }
    if (r === 'POST /api/perfil') {
      const f = fraca(String(b.senha || '')); if (f) return [400, { erro: f }];
      if (['completo', 'nome', 'posto', 'secao'].some((k) => !String(b[k] || '').trim())) return [400, { erro: 'Preencha todos os campos.' }];
      Object.assign(u, { senha: b.senha, completo: b.completo.trim(), nome: b.nome.trim().toUpperCase(), posto: b.posto, secao: b.secao.trim(), trocar: false });
      return [200, {}];
    }
    if (u.trocar) return [403, { erro: 'Troque a senha primeiro.' }];
    if (r === 'GET /api/frota') return [200, { viaturas: db.viaturas, pedidos: db.pedidos.filter((p) => p.fim > Date.now() - 24 * H).sort((a, c) => a.inicio - c.inicio).map(com), agora: Date.now() }];
    if (r === 'POST /api/pedido') {
      const p = { viatura: b.viatura, inicio: +b.inicio, fim: +b.fim, destino: String(b.destino || '').trim(), missao: String(b.missao || '').trim() };
      const vt = db.viaturas.find((v) => v.id === p.viatura);
      if (!vt) return [400, { erro: 'Viatura inválida.' }];
      if (!vt.disponivel) return [409, { erro: `Viatura indisponível: ${vt.motivo}.` }];
      if (!p.destino || !p.missao) return [400, { erro: 'Informe destino e missão.' }];
      if (!(p.fim > p.inicio)) return [409, { erro: 'A volta precisa ser depois da saída.' }];
      if (p.inicio - Date.now() < 48 * H) return [409, { erro: 'O pedido precisa de 48 horas de antecedência.' }];
      const c = db.pedidos.find((x) => x.viatura === p.viatura && p.inicio < x.fim && p.fim > x.inicio);
      if (c) return [409, { erro: `Viatura já reservada nesse horário (${com(c).posto} ${com(c).nome}).` }];
      db.pedidos.push({ ...p, id: db.seq++, identidade: id }); return [200, {}];
    }
    if (r === 'POST /api/cancelar') { db.pedidos = db.pedidos.filter((p) => !(p.id === +b.id && p.identidade === id)); return [200, {}]; }
    return [404, { erro: 'Rota inexistente.' }];
  }

  window.fetch = async (url, opt = {}) => {
    const [status, corpo] = rota(`${opt.method || 'GET'} ${url}`, opt.body ? JSON.parse(opt.body) : {});
    salvar();
    return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
  };
})();
