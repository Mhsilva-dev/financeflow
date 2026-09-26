// ── PAINEL ADMIN ──────────────────────────────────────────────
// Só visível para a conta administradora. Mostra quantos usuários estão
// online agora e a lista de todos os cadastrados. Atualiza sozinho a cada
// 15s enquanto a aba estiver aberta.

let adminUsuarios = [];
let adminFiltro = 'todos';
let adminTimer = null;

async function loadAdmin() {
  await atualizarAdmin();
  clearInterval(adminTimer);
  adminTimer = setInterval(() => {
    if (currentTab === 'admin' && !document.hidden) atualizarAdmin();
  }, 15000);
}

function pararAdmin() {
  clearInterval(adminTimer);
  adminTimer = null;
}

async function atualizarAdmin() {
  const r = await api('GET', '/api/admin/usuarios');
  if (!r.ok) {
    document.getElementById('adm-lista').innerHTML = `<div class="empty">${esc(r.erro || 'Não foi possível carregar')}</div>`;
    return;
  }
  adminUsuarios = r.usuarios;
  const on = r.usuarios.filter(u => u.online).length;
  const rot = { todos: `Todos · ${r.usuarios.length}`, online: `Online · ${on}`, offline: `Offline · ${r.usuarios.length - on}` };
  document.querySelectorAll('#adm-filtros button').forEach(b => { b.textContent = rot[b.dataset.f]; });
  document.getElementById('adm-online').textContent = r.resumo.online;
  document.getElementById('adm-total').textContent  = r.resumo.total;
  document.getElementById('adm-novos').textContent  = r.resumo.novos_7d;
  document.getElementById('adm-ativos').textContent = r.resumo.ativos_30d;
  document.getElementById('adm-atualizado').textContent =
    'Atualizado às ' + new Date().toLocaleTimeString('pt-BR') + ' · atualiza sozinho a cada 15s';
  renderAdmin();
}

function filtrarAdmin(f) {
  adminFiltro = f;
  document.querySelectorAll('#adm-filtros button').forEach(b => b.classList.toggle('active', b.dataset.f === f));
  renderAdmin();
}

// "há 5 min", "há 3 dias"… a partir de 'YYYY-MM-DD HH:MM:SS' (hora local do servidor) ou ISO
function tempoRelativo(data) {
  if (!data) return 'nunca';
  const d = new Date(data.includes('T') ? data : data.replace(' ', 'T'));
  const seg = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (seg < 60) return 'agora';
  if (seg < 3600) return `há ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `há ${Math.floor(seg / 3600)} h`;
  const dias = Math.floor(seg / 86400);
  if (dias < 30) return `há ${dias} dia${dias > 1 ? 's' : ''}`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return `há ${meses} ${meses > 1 ? 'meses' : 'mês'}`;
  const anos = Math.floor(meses / 12);
  return `há ${anos} ano${anos > 1 ? 's' : ''}`;
}

function renderAdmin() {
  const busca = document.getElementById('adm-busca').value.trim().toLowerCase();
  const lista = adminUsuarios
    .filter(u => adminFiltro === 'todos' || (adminFiltro === 'online' ? u.online : !u.online))
    .filter(u => !busca || [u.nome, u.usuario, u.email].some(v => (v || '').toLowerCase().includes(busca)))
    // Online primeiro, depois quem acessou mais recentemente
    .sort((a, b) => (b.online - a.online) || String(b.ultima_atividade || b.ultimo_acesso || '').localeCompare(String(a.ultima_atividade || a.ultimo_acesso || '')));

  const el = document.getElementById('adm-lista');
  if (!lista.length) { el.innerHTML = '<div class="empty">Nenhum usuário encontrado</div>'; return; }

  el.innerHTML = `<div class="admin-tabela">
    <div class="admin-linha admin-cab"><span>Usuário</span><span>Status</span><span>Último acesso</span><span>Cadastro</span><span class="dir">Transações</span></div>
    ${lista.map(u => {
    const ultimo = u.online
      ? (u.dispositivos > 0 ? `${u.dispositivos} dispositivo${u.dispositivos > 1 ? 's' : ''}` : 'ativo agora')
      : tempoRelativo(u.ultima_atividade || u.ultimo_acesso);
    return `
    <div class="admin-linha">
      <div class="admin-user-id">
        <span class="avatar">${esc(iniciais(u.nome))}</span>
        <div class="admin-user-txt">
          <div class="admin-user-nome">${esc(u.nome)}${u.papel === 'admin' ? '<span class="tag-admin">ADMIN</span>' : ''}</div>
          <div class="admin-user-sub">@${esc(u.usuario)}${u.email ? ' · ' + esc(u.email) : ''}</div>
        </div>
      </div>
      <span class="admin-status"><span class="dot-online ${u.online ? '' : 'off'}"></span><span class="${u.online ? 'txt-green' : 'muted'}">${u.online ? 'Online' : 'Offline'}</span></span>
      <span class="admin-cel" data-rot="Último acesso">${esc(ultimo)}</span>
      <span class="admin-cel num" data-rot="Cadastro">${fmtDate(u.created_at)}</span>
      <span class="admin-cel num dir" data-rot="Transações">${u.transacoes}</span>
    </div>`;
  }).join('')}</div>`;
}
