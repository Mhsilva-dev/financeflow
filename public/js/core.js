// ── CORE / APP SHELL ──────────────────────────────────────────
// Infraestrutura compartilhada por todas as telas: registro do Service
// Worker (PWA), helpers de formatação, wrapper de chamadas à API,
// controle do mês selecionado e navegação entre abas (desktop + sidebar
// mobile). Este arquivo deve ser carregado ANTES dos demais (dashboard.js,
// transacoes.js, etc.) porque eles dependem de fmt(), api(), mesStr()...

// Service worker e instalação do app: ver js/instalar.js

const API = '';

// ── UTILS ────────────────────────────────────────────────────
function fmt(v) {
  return 'R$ ' + parseFloat(v||0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
}
function fmtDate(d) {
  if (!d) return '';
  return d.slice(0,10).split('-').reverse().join('/');
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
// Escapa texto para inserir com segurança em innerHTML
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, type='success') {
  const el = document.createElement('div');
  el.className = `toast-msg ${type}`;
  el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
async function api(method, path, body) {
  try {
    const opts = { method, headers: {'Content-Type':'application/json'}, credentials: 'include' };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(API + path, opts);
    if (r.status === 401) { location.href = '/entrar'; return {}; }
    return r.json();
  } catch(e) {
    toast('Erro de conexão', 'error');
    return { ok: false, erro: 'Erro de conexão' };
  }
}

// ── MÊS ATUAL ──────────────────────────────────────────────
const MESES_NOME = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
let currentMes = new Date().getMonth() + 1;
let currentAno = new Date().getFullYear();
let currentTab = 'dashboard';

function mesStr() { return `${currentAno}-${String(currentMes).padStart(2,'0')}`; }

function updateMonthNav() {
  document.getElementById('month-label').textContent = `${MESES_NOME[currentMes-1]} ${currentAno}`;
  const now = new Date();
  const isHoje = currentMes === now.getMonth()+1 && currentAno === now.getFullYear();
  document.getElementById('btn-hoje').style.display = isHoje ? 'none' : 'inline-flex';
}

function prevMes() {
  currentMes--; if (currentMes < 1) { currentMes = 12; currentAno--; }
  updateMonthNav(); reloadTab();
}
function nextMes() {
  currentMes++; if (currentMes > 12) { currentMes = 1; currentAno++; }
  updateMonthNav(); reloadTab();
}
function resetMes() {
  const now = new Date(); currentMes = now.getMonth()+1; currentAno = now.getFullYear();
  updateMonthNav(); reloadTab();
}
function reloadTab() {
  const loaders = { dashboard: loadDashboard, transacoes: loadTransacoes, relatorio: loadRelatorio, ia: atualizarContextoChat };
  if (loaders[currentTab]) loaders[currentTab]();
}

// Botão "Nova transação" (cabeçalho e barra inferior): abre a aba e foca o formulário
function novaTransacao() {
  showTab('transacoes');
  setTimeout(() => document.getElementById('t-desc')?.focus(), 50);
}

// ── MOBILE SIDEBAR ──────────────────────────────────────────
function toggleMobileSidebar() {
  const isOpen = document.getElementById('mobile-sidebar').classList.toggle('open');
  document.getElementById('mobile-overlay').classList.toggle('open');
  document.body.style.overflow = isOpen ? 'hidden' : '';
}
function closeMobileSidebar() {
  document.getElementById('mobile-sidebar').classList.remove('open');
  document.getElementById('mobile-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

// ── TABS ────────────────────────────────────────────────────
// Título do cabeçalho de cada aba e se ela depende do mês selecionado
const TITULOS_ABA = {
  dashboard: 'Painel', transacoes: 'Transações', parcelas: 'Parcelas', futuras: 'Contas futuras',
  bancos: 'Bancos', investimentos: 'Investimentos', relatorio: 'Relatório', ia: 'Assistente', admin: 'Administração'
};
const ABAS_COM_MES = new Set(['dashboard', 'transacoes', 'relatorio', 'ia']);

function showTab(name) {
  currentTab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelectorAll('.sidebar nav button, #mobile-nav button, #bottom-nav button').forEach(b => {
    const alvo = b.dataset.tab || (b.getAttribute('onclick') || '').match(/^showTab\('(\w+)'\)$/)?.[1];
    b.classList.toggle('active', alvo === name);
  });
  document.getElementById('page-titulo').textContent = TITULOS_ABA[name] || '';
  document.getElementById('month-nav').classList.toggle('sem-mes', !ABAS_COM_MES.has(name));
  window.scrollTo(0, 0);
  closeMobileSidebar();
  const loaders = { dashboard: loadDashboard, transacoes: loadTransacoes, parcelas: loadParcelas,
    futuras: loadFuturas, bancos: loadBancos, relatorio: loadRelatorio,
    investimentos: () => { loadMercado(); loadInvestimentos(); }, admin: loadAdmin, ia: abrirChat };
  if (name !== 'admin') pararAdmin();
  if (loaders[name]) loaders[name]();
}
