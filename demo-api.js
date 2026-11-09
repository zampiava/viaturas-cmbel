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
        { id: 1, viatura: '5ton', identidade: '100000002', inicio: +agora - H, fim: +agora + 3 * H, destino: 'Depósito da 8ª RM', missao: 'Transporte de material escolar' },
        { id: 2, viatura: 'spin', identidade: '100000001', inicio: d(3, 8), fim: d(3, 12), destino: 'Aeroporto de Belém', missao: 'Buscar palestrante' },
        { id: 3, viatura: 'spin', identidade: '100000002', inicio: d(3, 14), fim: d(3, 17), destino: 'Base Naval de Val-de-Cães', missao: 'Visita com alunos' },
      ],
      seq: 4, sessao: null,
    };
  }
  const salvar = () => { try { localStorage.setItem(K, JSON.stringify(db)); } catch {} };
  const VIATURAS = [{ id: '5ton', nome: 'Caminhão 5 Ton', tipo: 'caminhao' }, { id: 'spin', nome: 'Chevrolet Spin', tipo: 'van' }, { id: 'versa', nome: 'Nissan Versa', tipo: 'sedan' }];
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
      const id = normId(b.identidade), u = db.usuarios[id];
      if (!u) return [401, { erro: 'Identidade sem conta. Toque em "Criar conta" primeiro.' }];
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
    if (r === 'GET /api/frota') return [200, { viaturas: VIATURAS, pedidos: db.pedidos.filter((p) => p.fim > Date.now() - 24 * H).sort((a, c) => a.inicio - c.inicio).map(com), agora: Date.now() }];
    if (r === 'POST /api/pedido') {
      const p = { viatura: b.viatura, inicio: +b.inicio, fim: +b.fim, destino: String(b.destino || '').trim(), missao: String(b.missao || '').trim() };
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
