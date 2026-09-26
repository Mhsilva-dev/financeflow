// ── TRANSAÇÕES ──────────────────────────────────────────────
// CRUD de lançamentos (entradas/saídas), com o ciclo de status por
// clique (toggleStatus): saídas giram pago → pendente → a_pagar → pago,
// entradas giram recebido → a_receber → recebido. Também concentra as
// ações em lote do mês (pagar tudo, duplicar, excluir) e a leitura de
// comprovante por foto via IA (uploadFoto).
let _filtroStatus = '';
let _ultimaListaTransacoes = [];
let _editandoId = null;

// Ciclos de status separados por tipo
const STATUS_SAIDA = {
  pago:     { label: 'Pago',     cls: 'pago',    next: 'pendente' },
  pendente: { label: 'Pendente', cls: 'pendente', next: 'a_pagar' },
  a_pagar:  { label: 'A Pagar', cls: 'a_pagar',  next: 'pago'    },
};
const STATUS_ENTRADA = {
  recebido:  { label: 'Recebido',  cls: 'recebido',  next: 'a_receber' },
  a_receber: { label: 'A Receber', cls: 'a_receber', next: 'recebido'  },
};

function statusInfo(t) {
  if (t.tipo === 'entrada') {
    return STATUS_ENTRADA[t.status] || STATUS_ENTRADA.recebido;
  }
  return STATUS_SAIDA[t.status] || STATUS_SAIDA.pago;
}

function setStatusFilter(status) {
  _filtroStatus = status;
  document.querySelectorAll('#t-status-pills .status-pill').forEach(btn => {
    btn.className = 'status-pill';
    if (btn.dataset.status === status) {
      btn.classList.add(status ? `active-${status}` : 'active');
    }
  });
  loadTransacoes();
}

function statusChip(t) {
  const info = statusInfo(t);
  return `<button class="status-chip ${info.cls}" title="Clique para alterar status" onclick="toggleStatus(${t.id},'${t.status}','${t.tipo}')">${info.label}</button>`;
}

async function toggleStatus(id, statusAtual, tipo) {
  const mapa = tipo === 'entrada' ? STATUS_ENTRADA : STATUS_SAIDA;
  const prox = (mapa[statusAtual] || Object.values(mapa)[0]).next;
  const r = await api('PATCH', `/api/transacoes/${id}/status`, { status: prox });
  if (r.ok) loadTransacoes();
  else toast(r.erro || 'Erro ao atualizar status', 'error');
}

// Atualiza opções do select de status conforme o tipo escolhido no formulário
function atualizarOpcoesStatus() {
  const tipo = document.getElementById('t-tipo').value;
  const sel  = document.getElementById('t-status');
  if (tipo === 'entrada') {
    sel.innerHTML = `
      <option value="recebido">Recebido</option>
      <option value="a_receber">A Receber</option>`;
  } else {
    sel.innerHTML = `
      <option value="pago">Pago</option>
      <option value="pendente">Pendente</option>
      <option value="a_pagar">A Pagar</option>`;
  }
}

async function loadTransacoes() {
  const busca = document.getElementById('f-busca').value;
  const tipo  = document.getElementById('f-tipo').value;
  const cat   = document.getElementById('f-cat').value;
  let url = `/api/transacoes?limit=500&mes=${mesStr()}`;
  if (busca)        url += '&busca='    + encodeURIComponent(busca);
  if (tipo)         url += '&tipo='     + tipo;
  if (cat)          url += '&categoria='+ encodeURIComponent(cat);

  const r = await api('GET', url);
  const tbody = document.getElementById('t-list');
  if (!r.ok) { tbody.innerHTML = '<tr><td colspan="7" class="empty">Erro ao carregar</td></tr>'; return; }

  // Calcula resumo de status (todos os dados sem filtro de status)
  const todos   = r.data;
  const cPago      = todos.filter(t => t.status === 'pago' || t.status === 'recebido' || (!t.status && t.tipo === 'saida'));
  const cAReceber  = todos.filter(t => t.status === 'a_receber');
  const cPend      = todos.filter(t => t.status === 'pendente');
  const cPagar     = todos.filter(t => t.status === 'a_pagar');
  document.getElementById('t-count-pago').textContent      = `${cPago.length} (${fmt(cPago.reduce((s,t)=>s+t.valor,0))})`;
  document.getElementById('t-count-a_receber').textContent = `${cAReceber.length} (${fmt(cAReceber.reduce((s,t)=>s+t.valor,0))})`;
  document.getElementById('t-count-pendente').textContent  = `${cPend.length} (${fmt(cPend.reduce((s,t)=>s+t.valor,0))})`;
  document.getElementById('t-count-a_pagar').textContent   = cPagar.length;
  document.getElementById('t-valor-a_pagar').textContent   = fmt(cPagar.reduce((s,t)=>s+t.valor,0));

  // Aplica filtro de status no frontend (já tem todos os dados)
  const lista = _filtroStatus ? todos.filter(t => (t.status||'pago') === _filtroStatus) : todos;
  _ultimaListaTransacoes = todos;
  if (!lista.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty">Nenhuma transação encontrada</td></tr>'; return; }

  tbody.innerHTML = lista.map(t => {
    const st = t.status || 'pago';
    return `
    <tr class="row-${st}">
      <td>${fmtDate(t.data)}</td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(t.descricao)}">${esc(t.descricao)}</td>
      <td><span class="badge badge-blue">${esc(t.categoria)}</span></td>
      <td><span class="badge ${t.tipo==='entrada'?'badge-green':'badge-red'}">${t.tipo==='entrada'?'Entrada':'Saída'}</span></td>
      <td style="color:${t.tipo==='entrada'?'var(--green)':'var(--red)'}; font-weight:700; white-space:nowrap">
        ${t.tipo==='entrada'?'+':'-'}${fmt(t.valor)}
      </td>
      <td>${statusChip(t)}</td>
      <td style="display:flex;gap:4px">
        <button class="btn btn-ghost btn-sm" onclick="editarTransacao(${t.id})" title="Editar">✎</button>
        <button class="btn btn-ghost btn-sm" onclick="duplicarTransacao(${t.id})" title="Duplicar para o próximo mês">⧉</button>
        <button class="btn btn-red btn-sm" onclick="delTransacao(${t.id})">✕</button>
      </td>
    </tr>`;
  }).join('');
}

async function exportarTransacoesPDF() {
  const btn = document.getElementById('btn-exportar-transacoes-pdf');
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Gerando...';

  const busca = document.getElementById('f-busca').value;
  const tipo  = document.getElementById('f-tipo').value;
  const cat   = document.getElementById('f-cat').value;
  let url = `/api/transacoes/pdf?limit=500&mes=${mesStr()}`;
  if (busca)         url += '&busca='    + encodeURIComponent(busca);
  if (tipo)          url += '&tipo='     + tipo;
  if (cat)           url += '&categoria='+ encodeURIComponent(cat);
  if (_filtroStatus) url += '&status='   + _filtroStatus;

  try {
    const r = await fetch(url);
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      toast(data.erro || 'Erro ao gerar PDF', 'error');
      return;
    }
    const blob = await r.blob();
    const linkUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = linkUrl;
    a.download = `transacoes-${mesStr()}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(linkUrl);
  } catch (err) {
    toast('Erro ao gerar PDF: ' + (err?.message || 'tente novamente'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

async function addTransacao() {
  const desc = document.getElementById('t-desc').value.trim();
  const valor = document.getElementById('t-valor').value;
  if (!desc || !valor) return toast('Preencha descrição e valor', 'error');
  const payload = {
    descricao: desc,
    tipo:      document.getElementById('t-tipo').value,
    categoria: document.getElementById('t-cat').value,
    valor:     parseFloat(valor),
    data:      document.getElementById('t-data').value || today(),
    status:    document.getElementById('t-status').value,
    banco_id:  document.getElementById('t-banco').value || null
  };

  const r = _editandoId
    ? await api('PUT', `/api/transacoes/${_editandoId}`, payload)
    : await api('POST', '/api/transacoes', payload);

  if (r.ok) {
    toast(_editandoId ? 'Transação atualizada!' : 'Transação adicionada!');
    if (_editandoId) cancelarEdicao(); else {
      document.getElementById('t-desc').value  = '';
      document.getElementById('t-valor').value = '';
    }
    loadTransacoes();
  } else toast(r.erro || 'Erro ao salvar', 'error');
}

function editarTransacao(id) {
  const t = _ultimaListaTransacoes.find(x => x.id === id);
  if (!t) return toast('Transação não encontrada nesta lista', 'error');

  _editandoId = id;
  document.getElementById('t-desc').value   = t.descricao;
  document.getElementById('t-tipo').value   = t.tipo;
  atualizarOpcoesStatus();
  document.getElementById('t-cat').value    = t.categoria;
  document.getElementById('t-valor').value  = t.valor;
  document.getElementById('t-data').value   = t.data.slice(0, 10);
  document.getElementById('t-status').value = t.status || 'pago';
  document.getElementById('t-banco').value  = t.banco_id || '';

  document.querySelector('#tab-transacoes .section-title').textContent = 'Editar Transação';
  const btn = document.getElementById('btn-salvar-transacao');
  btn.textContent = 'Salvar Edição';
  document.getElementById('btn-cancelar-edicao').style.display = 'inline-block';
  document.getElementById('form-transacao').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelarEdicao() {
  _editandoId = null;
  document.getElementById('t-desc').value  = '';
  document.getElementById('t-valor').value = '';
  document.getElementById('t-status').value = 'pago';
  document.querySelector('#tab-transacoes .section-title').textContent = 'Nova Transação';
  document.getElementById('btn-salvar-transacao').textContent = 'Adicionar';
  document.getElementById('btn-cancelar-edicao').style.display = 'none';
}

async function delTransacao(id) {
  if (!confirm('Excluir transação?')) return;
  const r = await api('DELETE', '/api/transacoes/' + id);
  if (r.ok) { toast('Excluída!'); loadTransacoes(); }
}

async function duplicarTransacao(id) {
  const r = await api('POST', `/api/transacoes/${id}/duplicar`);
  if (r.ok) {
    toast(`Copiada para ${r.mes.split('-').reverse().join('/')} como Pendente!`);
    loadTransacoes();
  } else toast(r.erro || 'Erro ao duplicar', 'error');
}

async function pagarMesInteiro() {
  const mes = mesStr();
  const [ano, m] = mes.split('-');
  const nomesMes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const nomeMes = nomesMes[parseInt(m) - 1];
  if (!confirm(`Marcar todas as pendências de ${nomeMes}/${ano} como pagas/recebidas?\n\nSaídas "Pendente"/"A Pagar" viram "Pago", entradas "A Receber" viram "Recebido". Lançamentos já quitados não são alterados.`)) return;
  const r = await api('PATCH', '/api/transacoes/pagar-mes', { mes });
  if (r.ok) {
    toast(r.atualizadas > 0 ? `${r.atualizadas} transação(ões) marcada(s) como quitada(s)!` : 'Nada pendente neste mês.');
    loadTransacoes();
    loadDashboard();
  } else toast(r.erro || 'Erro ao pagar o mês', 'error');
}

async function excluirMesInteiro() {
  const mes = mesStr();
  const [ano, m] = mes.split('-');
  const nomesMes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const nomeMes = nomesMes[parseInt(m) - 1];

  const lista = await api('GET', `/api/transacoes?limit=500&mes=${mes}`);
  const total = lista.ok ? lista.data.length : 0;
  if (total === 0) return toast(`Não há transações em ${nomeMes}/${ano}.`);

  const temParcela = lista.data.some(t => t.parcela_id);
  const avisoParcela = temParcela ? '\n\nEsse mês tem parcelas de compras parceladas — o progresso delas na aba Parcelas pode ficar incorreto depois.' : '';

  if (!confirm(`Apagar TODAS as ${total} transação(ões) de ${nomeMes}/${ano}?\n\nEssa ação não pode ser desfeita.${avisoParcela}`)) return;
  if (!confirm(`Tem certeza mesmo? ${total} transação(ões) de ${nomeMes}/${ano} serão apagadas permanentemente.`)) return;

  const r = await api('DELETE', '/api/transacoes/mes', { mes });
  if (r.ok) {
    toast(`${r.removidas} transação(ões) de ${nomeMes}/${ano} apagada(s).`);
    loadTransacoes();
    loadDashboard();
  } else toast(r.erro || 'Erro ao excluir o mês', 'error');
}

async function duplicarMes() {
  const mes = mesStr();
  const [ano, m] = mes.split('-');
  const nomesMes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const nomeMes = nomesMes[parseInt(m) - 1];
  if (!confirm(`Copiar todas as transações de ${nomeMes}/${ano} para o mês seguinte?\n\nSerão criadas como "Pendente" para você confirmar depois.`)) return;
  const r = await api('POST', '/api/transacoes/duplicar-mes', { mes });
  if (r.ok) {
    const destino = r.mes_destino.split('-').reverse().join('/');
    toast(`${r.copiadas} transação(ões) copiada(s) para ${destino}!`);
    loadTransacoes();
  } else toast(r.erro || 'Erro ao duplicar mês', 'error');
}

async function uploadFoto(input) {
  if (!input.files[0]) return;
  toast('Analisando foto com IA...');
  const form = new FormData();
  form.append('foto', input.files[0]);
  const r = await fetch('/api/transacoes/foto', { method:'POST', body:form });
  const data = await r.json();
  if (data.ok) {
    const d = data.data;
    document.getElementById('t-desc').value = d.descricao || '';
    document.getElementById('t-valor').value = d.valor || '';
    if (d.categoria) {
      const sel = document.getElementById('t-cat');
      for (let o of sel.options) if (o.value === d.categoria) { sel.value = d.categoria; break; }
    }
    toast('Comprovante lido! Confira e salve.');
  } else toast('Não foi possível ler a foto', 'error');
  input.value = '';
}

