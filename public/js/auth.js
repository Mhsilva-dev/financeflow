// ── SESSÃO, CONTA E TEMPO REAL ──────────────────────────────────
// Login/cadastro/logout, edição da conta e a conexão WebSocket que avisa
// (via toast) quando uma nova transação chega em tempo real — por
// exemplo, uma importação feita em outra aba/dispositivo. startApp() é
// o ponto de entrada chamado após login bem-sucedido ou sessão válida.

// ── WEBSOCKET (notificações em tempo real) ────────────────────
let wsConn;
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  wsConn = new WebSocket(`${proto}//${location.host}/ws`);
  wsConn.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data);
      if (d.type === 'nova_transacao') toast('Nova transação: ' + (d.data?.descricao || ''));
    } catch(err) {}
  };
  wsConn.onclose = () => setTimeout(connectWS, 3000);
}

// ── MINHA CONTA ───────────────────────────────────────────────
let perfilAtual = null;

function iniciais(nome) {
  const partes = String(nome || '?').trim().split(/\s+/);
  return ((partes[0]?.[0] || '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase() || '?';
}

function aplicarPerfil(p) {
  perfilAtual = p;
  document.getElementById('user-name').textContent = p.nome;
  document.getElementById('user-avatar').textContent = iniciais(p.nome);
  document.getElementById('user-avatar-m').textContent = iniciais(p.nome);
  document.querySelectorAll('.admin-only').forEach(el => { el.hidden = p.papel !== 'admin'; });
  aplicarAparencia(p.tema, p.cor);
}

// ── APARÊNCIA (tema e cor de destaque) ─────────────────────────
// O escuro com latão é o padrão. A escolha fica salva na conta (vale em
// qualquer aparelho) e também no aparelho, para aplicar antes do login.
const COR_TEMA_NAVEGADOR = { escuro: '#0E0F0D', claro: '#F4F2EC' };

function aplicarAparencia(tema, cor) {
  tema = tema || 'escuro';
  cor = cor || 'latao';
  const raiz = document.documentElement;
  if (tema === 'escuro') delete raiz.dataset.tema; else raiz.dataset.tema = tema;
  if (cor === 'latao') delete raiz.dataset.cor; else raiz.dataset.cor = cor;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COR_TEMA_NAVEGADOR[tema]);
  try { localStorage.setItem('ff-tema', tema); localStorage.setItem('ff-cor', cor); } catch (e) {}
  document.querySelectorAll('#cfg-temas .tema-opcao').forEach(b => b.classList.toggle('ativo', b.dataset.tema === tema));
  document.querySelectorAll('#cfg-cores .cor-opcao').forEach(b => b.classList.toggle('ativo', b.dataset.cor === cor));
}

async function escolherAparencia(mudanca) {
  const p = perfilAtual || {};
  const novo = { tema: mudanca.tema || p.tema, cor: mudanca.cor || p.cor };
  aplicarAparencia(novo.tema, novo.cor);   // aplica na hora; salva em seguida
  if (perfilAtual) Object.assign(perfilAtual, novo);
  const r = await api('PUT', '/api/auth/aparencia', mudanca);
  if (!r.ok) toast(r.erro || 'Não foi possível salvar a aparência', 'error');
}

async function baixarMeusDados() {
  const btn = document.getElementById('btn-exportar-dados');
  const texto = btn.textContent;
  btn.disabled = true; btn.textContent = 'Gerando planilha...';
  try {
    const r = await fetch('/api/auth/exportar', { credentials: 'include' });
    if (!r.ok) throw new Error();
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `financeflow-meus-dados-${today()}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Planilha baixada');
  } catch (e) {
    toast('Não foi possível gerar a planilha', 'error');
  }
  btn.disabled = false; btn.textContent = texto;
}

function openConfig() {
  const p = perfilAtual || {};
  document.getElementById('cfg-avatar').textContent = iniciais(p.nome);
  document.getElementById('cfg-nome-atual').textContent = p.nome || '';
  document.getElementById('cfg-sub-atual').textContent = [p.usuario && '@' + p.usuario, p.email].filter(Boolean).join(' · ');
  document.getElementById('cfg-nome').value = p.nome || '';
  document.getElementById('cfg-email').value = p.email || '';
  document.getElementById('cfg-usuario').value = p.usuario || '';
  // A conta administradora (a original) não pode ser excluída
  document.getElementById('cfg-danger').style.display = p.papel === 'admin' ? 'none' : '';
  aplicarAparencia(p.tema, p.cor);
  document.getElementById('modal-config').classList.add('open');
}
function closeConfig() {
  document.getElementById('modal-config').classList.remove('open');
  ['cfg-senha-atual','cfg-nova-senha','cfg-nova-senha2'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('cfg-erro').textContent = '';
}
async function salvarConfig() {
  const errEl = document.getElementById('cfg-erro');
  errEl.textContent = '';
  const p = perfilAtual || {};
  const nome = document.getElementById('cfg-nome').value.trim();
  const email = document.getElementById('cfg-email').value.trim().toLowerCase();
  const usuario = document.getElementById('cfg-usuario').value.trim();
  const senhaAtual = document.getElementById('cfg-senha-atual').value;
  const novaSenha = document.getElementById('cfg-nova-senha').value;
  const novaSenha2 = document.getElementById('cfg-nova-senha2').value;
  if (!senhaAtual) { errEl.textContent = 'Informe a senha atual para salvar'; return; }
  if (novaSenha && novaSenha !== novaSenha2) { errEl.textContent = 'As novas senhas não coincidem'; return; }
  if (novaSenha && novaSenha.length < 6) { errEl.textContent = 'Nova senha deve ter pelo menos 6 caracteres'; return; }
  if (usuario && usuario.length < 3) { errEl.textContent = 'Usuário deve ter pelo menos 3 caracteres'; return; }
  // Só envia o que mudou
  const r = await api('PUT', '/api/auth/trocar', {
    senha_atual:  senhaAtual,
    nova_senha:   novaSenha || undefined,
    novo_nome:    nome && nome !== p.nome ? nome : undefined,
    novo_email:   email && email !== p.email ? email : undefined,
    novo_usuario: usuario && usuario !== p.usuario ? usuario : undefined
  });
  if (r.ok) { aplicarPerfil(r); toast('Conta atualizada!'); closeConfig(); }
  else { errEl.textContent = r.erro || 'Erro ao salvar'; }
}

async function excluirConta() {
  const senha = prompt('Para excluir sua conta e TODOS os seus dados, digite sua senha:');
  if (!senha) return;
  if (!confirm('Tem certeza? Essa ação é permanente e não pode ser desfeita.')) return;
  const r = await api('DELETE', '/api/auth/conta', { senha });
  if (r.ok) { alert('Sua conta foi excluída.'); location.href = '/'; }
  else toast(r.erro || 'Não foi possível excluir a conta', 'error');
}

// ── TELA DE ENTRADA ───────────────────────────────────────────
// Modos da tela de entrada: login | registro | esqueci | esqueci-ok | redefinir | link-invalido
const TELAS_AUTH = {
  login: 'form-login', registro: 'form-registro', esqueci: 'form-esqueci',
  'esqueci-ok': 'form-esqueci-ok', redefinir: 'form-redefinir', 'link-invalido': 'form-link-invalido'
};
const FOCO_AUTH = { login: 'login-user', registro: 'reg-nome', esqueci: 'esq-email', redefinir: 'red-senha' };

function trocarModoAuth(modo) {
  const tabs = document.getElementById('auth-tabs');
  tabs.dataset.modo = modo;
  tabs.hidden = !(modo === 'login' || modo === 'registro');
  tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.modo === modo));
  Object.entries(TELAS_AUTH).forEach(([m, id]) => { document.getElementById(id).hidden = m !== modo; });
  ['login-error', 'reg-error', 'esq-error', 'red-error'].forEach(id => { document.getElementById(id).textContent = ''; });
  // Leva o e-mail/usuário digitado no login para o "esqueci a senha"
  if (modo === 'esqueci') {
    const digitado = document.getElementById('login-user').value.trim();
    if (digitado.includes('@') && !document.getElementById('esq-email').value) document.getElementById('esq-email').value = digitado;
  }
  if (FOCO_AUTH[modo]) document.getElementById(FOCO_AUTH[modo]).focus();
}

// ── ESQUECI A SENHA / REDEFINIR ───────────────────────────────
async function pedirRedefinicao() {
  const email = document.getElementById('esq-email').value.trim().toLowerCase();
  const errEl = document.getElementById('esq-error');
  const btn = document.getElementById('esq-btn');
  errEl.textContent = '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { errEl.textContent = 'Informe um e-mail válido'; return; }
  carregando(btn, true, 'Enviando');
  try {
    const data = await postAuth('/api/auth/esqueci', { email });
    if (data.ok) {
      document.getElementById('esq-email-enviado').textContent = email;
      trocarModoAuth('esqueci-ok');
    } else {
      errEl.textContent = data.erro || 'Não foi possível enviar agora';
    }
  } catch (e) {
    errEl.textContent = 'Erro de conexão. Tente novamente.';
  }
  carregando(btn, false);
}

function tokenRedefinicao() {
  return new URLSearchParams(location.search).get('token') || '';
}

async function abrirRedefinicao() {
  try {
    const r = await fetch('/api/auth/redefinir/validar?token=' + encodeURIComponent(tokenRedefinicao()));
    const data = await r.json();
    trocarModoAuth(data.valido ? 'redefinir' : 'link-invalido');
  } catch (e) {
    trocarModoAuth('link-invalido');
  }
}

async function salvarNovaSenha() {
  const senha = document.getElementById('red-senha').value;
  const senha2 = document.getElementById('red-senha2').value;
  const errEl = document.getElementById('red-error');
  const btn = document.getElementById('red-btn');
  errEl.textContent = '';
  if (senha.length < 6) { errEl.textContent = 'A senha deve ter pelo menos 6 caracteres'; return; }
  if (senha !== senha2) { errEl.textContent = 'As senhas não coincidem'; return; }
  carregando(btn, true, 'Salvando');
  try {
    const data = await postAuth('/api/auth/redefinir', { token: tokenRedefinicao(), senha });
    if (data.ok) {
      history.replaceState(null, '', '/app');   // tira o token da barra de endereço
      startApp(data);
      toast('Senha alterada! Você já está na sua conta.');
    } else if (data.expirado) {
      trocarModoAuth('link-invalido');
    } else {
      errEl.textContent = data.erro || 'Não foi possível salvar a senha';
    }
  } catch (e) {
    errEl.textContent = 'Erro de conexão. Tente novamente.';
  }
  carregando(btn, false);
}

function alternarSenha(btn) {
  const input = btn.parentElement.querySelector('input');
  const mostrar = input.type === 'password';
  input.type = mostrar ? 'text' : 'password';
  btn.classList.toggle('on', mostrar);
  btn.textContent = mostrar ? 'Ocultar' : 'Mostrar';
  btn.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
}

function medirSenha(senha, prefixo = 'reg') {
  let nivel = 0;
  if (senha.length >= 6) nivel++;
  if (senha.length >= 10) nivel++;
  if (/[A-Z]/.test(senha) && /[a-z]/.test(senha)) nivel++;
  if (/\d/.test(senha) && /[^A-Za-z0-9]/.test(senha)) nivel++;
  if (senha.length < 6) nivel = senha ? 1 : 0;
  const rotulos = ['Use letras, números e símbolos para uma senha forte.', 'Fraca', 'Razoável', 'Boa', 'Forte'];
  document.getElementById(prefixo + '-forca').dataset.nivel = nivel;
  document.getElementById(prefixo + '-forca-txt').textContent = senha.length && senha.length < 6 ? 'Mínimo de 6 caracteres' : rotulos[nivel];
}

function carregando(btn, ativo, textoAtivo) {
  if (ativo) { btn.dataset.texto = btn.textContent; btn.textContent = textoAtivo; }
  else if (btn.dataset.texto) btn.textContent = btn.dataset.texto;
  btn.disabled = ativo;
  btn.classList.toggle('carregando', ativo);
}

async function postAuth(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body)
  });
  return r.json();
}

// ── AUTH ─────────────────────────────────────────────────────
function startApp(perfil) {
  document.getElementById('login-screen').style.display = 'none';
  aplicarPerfil(perfil);
  updateMonthNav();
  loadDashboard();
  carregarSelectsBancos();
  connectWS();
  atualizarBotaoNotificacoes();
  setInterval(() => { if (currentTab === 'investimentos') loadMercado(); }, 60000);
  // Conta nova: tour de boas-vindas (espera o painel desenhar para medir os elementos)
  if (!perfil.tour_visto) setTimeout(iniciarTour, 900);
}

async function checkAuth() {
  if (location.pathname === '/redefinir') return abrirRedefinicao();

  // Esconde "Criar conta" se o cadastro estiver fechado no servidor
  fetch('/api/auth/config').then(r => r.json()).then(c => {
    if (c.registro_aberto) return;
    document.querySelector('#auth-tabs [data-modo="registro"]').remove();
    document.getElementById('auth-tabs').classList.add('single');
    document.getElementById('auth-switch-registro').remove();
  }).catch(() => {});
  try {
    const r = await fetch('/api/auth/me', { credentials: 'include' });
    const data = await r.json();
    if (data.ok) return startApp(data);
  } catch(e) {}
  // Veio do "Criar conta grátis" da página de apresentação
  if (location.hash === '#cadastro') trocarModoAuth('registro');
}

async function doLogin() {
  const usuario = document.getElementById('login-user').value.trim();
  const senha = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  errEl.textContent = '';
  if (!usuario || !senha) { errEl.textContent = 'Preencha usuário e senha'; return; }
  carregando(btn, true, 'Entrando');
  try {
    const data = await postAuth('/api/auth/login', { usuario, senha });
    if (data.ok) startApp(data);
    else errEl.textContent = data.erro || 'Usuário ou senha incorretos';
  } catch(e) {
    errEl.textContent = 'Erro de conexão. Tente novamente.';
  }
  carregando(btn, false);
}

async function doRegistro() {
  const campo = id => document.getElementById(id);
  const nome = campo('reg-nome').value.trim();
  const usuario = campo('reg-usuario').value.trim().toLowerCase();
  const email = campo('reg-email').value.trim().toLowerCase();
  const senha = campo('reg-senha').value;
  const senha2 = campo('reg-senha2').value;
  const errEl = campo('reg-error');
  const btn = campo('reg-btn');

  document.querySelectorAll('#form-registro input').forEach(i => i.classList.remove('invalido'));
  const falha = (id, msg) => { campo(id).classList.add('invalido'); campo(id).focus(); errEl.textContent = msg; };
  errEl.textContent = '';

  if (nome.length < 2) return falha('reg-nome', 'Informe seu nome');
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) return falha('reg-usuario', 'Usuário: 3 a 30 caracteres (letras, números, . _ -)');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return falha('reg-email', 'Informe um e-mail válido');
  if (senha.length < 6) return falha('reg-senha', 'A senha deve ter pelo menos 6 caracteres');
  if (senha !== senha2) return falha('reg-senha2', 'As senhas não coincidem');

  carregando(btn, true, 'Criando sua conta');
  try {
    const data = await postAuth('/api/auth/registro', { nome, usuario, email, senha });
    if (data.ok) {
      startApp(data);   // conta nova: tour_visto = 0, o tour abre sozinho
    } else {
      errEl.textContent = data.erro || 'Não foi possível criar a conta';
    }
  } catch(e) {
    errEl.textContent = 'Erro de conexão. Tente novamente.';
  }
  carregando(btn, false);
}


async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  location.href = '/entrar';
}
