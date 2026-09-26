// ── DASHBOARD ───────────────────────────────────────────────
// Tela inicial: cards de saldo/entradas/saídas do mês, gráfico de
// categorias, últimas transações e o alerta de limite de gasto mensal
// (com notificações push do navegador). Depende de core.js (api, fmt,
// mesStr) e é chamada por showTab('dashboard') em core.js.
async function loadDashboard() {
  const r = await api('GET', `/api/transacoes/totais?mes=${mesStr()}`);
  if (!r.ok) return;
  const d = r.data;

  const ant  = d.saldo_anterior ?? 0;

  // Saldo do mês (entradas - saídas)
  const elSaldo = document.getElementById('d-saldo');
  elSaldo.textContent = fmt(d.saldo);
  elSaldo.className = 'card-value ' + (d.saldo >= 0 ? 'accent' : 'red');

  // Saldo anterior
  const elAnt = document.getElementById('d-saldo-anterior');
  elAnt.textContent = fmt(ant);
  elAnt.style.color = ant >= 0 ? '' : 'var(--red)';

  document.getElementById('d-entradas').textContent = fmt(d.entradas);
  document.getElementById('d-saidas').textContent   = fmt(d.saidas);

  // Indicador no month-nav
  const navAnt = document.getElementById('month-saldo-ant');
  const navVal = document.getElementById('month-saldo-ant-val');
  if (Math.abs(ant) >= 0.005) {  // ignora resíduo de arredondamento (ex: 1e-12)
    navAnt.style.display = 'block';
    navVal.textContent   = fmt(ant);
    navVal.style.color   = ant >= 0 ? '' : 'var(--red)';
  } else {
    navAnt.style.display = 'none';
  }

  const max = d.categorias.length ? d.categorias[0].total : 1;
  document.getElementById('d-categorias').innerHTML = d.categorias.length ? d.categorias.map(c => `
    <div class="cat-item">
      <div class="cat-bar">
        <div class="cat-name"><span>${esc(c.categoria)}</span><strong>${fmt(c.total)}</strong></div>
        <div class="progress"><div class="progress-bar" style="width:${(c.total/max*100).toFixed(0)}%;background:var(--accent)"></div></div>
      </div>
    </div>`).join('') : '<div class="empty">Nenhum gasto registrado</div>';

  const tr = await api('GET', `/api/transacoes?limit=8&mes=${mesStr()}`);
  if (tr.ok) {
    const PENDENTE = { pendente: 'Pendente', a_pagar: 'A pagar', a_receber: 'A receber' };
    document.getElementById('d-ultimas').innerHTML = tr.data.length ? tr.data.map(t => `
      <div class="tx-row">
        <span class="num dim">${fmtDate(t.data).slice(0,5)}</span>
        <div class="tx-desc">
          <div>${esc(t.descricao)}</div>
          <small>${esc(t.categoria)}${PENDENTE[t.status] ? ` · <b class="tx-pend">${PENDENTE[t.status]}</b>` : ''}</small>
        </div>
        <span class="num ${t.tipo==='entrada'?'pos':''}">${t.tipo==='entrada'?'+':'−'} ${fmt(t.valor).replace('R$ ','')}</span>
      </div>`).join('') : '<div class="empty">Nenhuma transação neste mês</div>';
  }

  renderGrafico(d.historico || []);
  loadLimiteGasto();
  carregarPrimeirosPassos();
}

// Barras de entradas x saídas dos últimos 6 meses (dados de /totais → historico)
function renderGrafico(hist) {
  const el = document.getElementById('d-grafico');
  if (!hist.length) { el.innerHTML = '<div class="empty">Sem histórico ainda</div>'; return; }
  const max = Math.max(...hist.map(h => Math.max(h.entradas, h.saidas)), 1);
  const nomeMes = m => MESES_NOME[parseInt(m.slice(5), 10) - 1].slice(0, 3).toLowerCase();
  el.innerHTML = `<div class="chart">${hist.map(h => `
    <div class="chart-col${h.mes === mesStr() ? ' atual' : ''}">
      <div class="chart-col-bars">
        <div class="chart-bar entrada" style="height:${Math.max(2, h.entradas / max * 100)}%" data-tip="Entradas ${fmt(h.entradas)}"></div>
        <div class="chart-bar saida" style="height:${Math.max(2, h.saidas / max * 100)}%" data-tip="Saídas ${fmt(h.saidas)}"></div>
      </div>
      <div class="chart-mes">${nomeMes(h.mes)}</div>
    </div>`).join('')}</div>`;
}

// ── ALERTA DE GASTO MENSAL (push) ────────────────────────────
async function loadLimiteGasto() {
  const r = await api('GET', '/api/limite-gasto');
  if (!r.ok) return;

  const btnRemover = document.getElementById('btn-remover-limite');
  const progresso  = document.getElementById('lg-progresso');

  if (r.valor == null) {
    document.getElementById('lg-valor').value = '';
    btnRemover.style.display = 'none';
    progresso.style.display  = 'none';
    return;
  }

  document.getElementById('lg-valor').value = r.valor;
  btnRemover.style.display = 'inline-flex';
  progresso.style.display  = 'block';

  const pct = Math.min(100, Math.round((r.gasto_atual / r.valor) * 100));
  document.getElementById('lg-texto').textContent = `${fmt(r.gasto_atual)} de ${fmt(r.valor)}`;
  document.getElementById('lg-pct').textContent    = `${pct}%`;
  const barra = document.getElementById('lg-barra');
  barra.style.width = pct + '%';
  barra.style.background = pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--yellow)' : 'var(--green)';
}

async function salvarLimiteGasto() {
  const valor = document.getElementById('lg-valor').value;
  if (!valor || parseFloat(valor) <= 0) { toast('Informe um valor válido', 'error'); return; }
  const r = await api('POST', '/api/limite-gasto', { valor: parseFloat(valor) });
  if (r.ok) { toast('Limite salvo!'); loadLimiteGasto(); }
  else toast(r.erro || 'Erro ao salvar', 'error');
}

async function removerLimiteGasto() {
  if (!confirm('Remover o limite de gasto mensal?')) return;
  const r = await api('DELETE', '/api/limite-gasto');
  if (r.ok) { toast('Limite removido!'); loadLimiteGasto(); }
}

// ── NOTIFICAÇÕES PUSH ─────────────────────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function atualizarBotaoNotificacoes() {
  const btn = document.getElementById('btn-ativar-notif');
  if (!btn || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    if (btn) btn.style.display = 'none';
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  btn.textContent = sub ? 'Notificações ativadas' : 'Ativar notificações no celular';
}

async function ativarNotificacoes() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast('Seu navegador não suporta notificações push', 'error');
    return;
  }

  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') {
    toast('Permissão de notificação negada', 'error');
    return;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();

    if (!sub) {
      const { publicKey } = await api('GET', '/api/push/vapid-public-key');
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
    }

    await api('POST', '/api/push/subscribe', sub.toJSON());
    toast('Notificações ativadas neste dispositivo!');
    atualizarBotaoNotificacoes();
  } catch (err) {
    toast('Erro ao ativar notificações', 'error');
  }
}

