// ── DESPESAS FUTURAS ──────────────────────────────────────────
// Lista simples de gastos previstos que ainda não viraram transação
// (ex: IPTU do próximo mês), com prioridade alta/média/baixa. Ao marcar
// como concluída, o registro só sai desta lista — não cria uma
// transação automaticamente.
async function loadFuturas() {
  const r = await api('GET', '/api/futuras');
  const tbody = document.getElementById('fu-list');
  if (!r.ok || !r.data.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty">Nenhuma despesa futura</td></tr>'; return; }
  const prioBadge = { alta: 'badge-red', media: 'badge-yellow', baixa: 'badge-blue' };
  tbody.innerHTML = r.data.map(f => `
    <tr>
      <td>${esc(f.descricao)}</td>
      <td style="color:var(--red)">${fmt(f.valor)}</td>
      <td>${fmtDate(f.data_prevista)}</td>
      <td><span class="badge ${prioBadge[f.prioridade]||'badge-blue'}">${f.prioridade}</span></td>
      <td style="display:flex;gap:6px">
        <button class="btn btn-green btn-sm" onclick="concluirFutura(${f.id})">✓</button>
        <button class="btn btn-red btn-sm" onclick="delFutura(${f.id})">✕</button>
      </td>
    </tr>`).join('');
}

async function addFutura() {
  const desc = document.getElementById('fu-desc').value.trim();
  const valor = document.getElementById('fu-valor').value;
  const data = document.getElementById('fu-data').value;
  if (!desc || !valor || !data) return toast('Preencha todos os campos', 'error');
  const r = await api('POST', '/api/futuras', { descricao: desc, valor: parseFloat(valor), data_prevista: data, prioridade: document.getElementById('fu-prio').value });
  if (r.ok) { toast('Despesa futura adicionada!'); document.getElementById('fu-desc').value=''; document.getElementById('fu-valor').value=''; loadFuturas(); }
  else toast(r.erro || 'Erro', 'error');
}

async function concluirFutura(id) {
  const r = await api('PATCH', '/api/futuras/' + id + '/concluir');
  if (r.ok) { toast('Marcada como concluída!'); loadFuturas(); }
}

async function delFutura(id) {
  if (!confirm('Excluir?')) return;
  const r = await api('DELETE', '/api/futuras/' + id);
  if (r.ok) { toast('Excluída!'); loadFuturas(); }
}

