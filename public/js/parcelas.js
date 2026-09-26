// ── PARCELAS ────────────────────────────────────────────────
// Compras parceladas (ex: TV em 12x). Cada parcela é registrada uma vez
// no backend com valor total e número de parcelas; aqui só exibimos o
// progresso (quantas já foram pagas) e permitimos quitar a próxima.
async function loadParcelas() {
  const r = await api('GET', '/api/parcelas');
  const el = document.getElementById('p-list');
  if (!r.ok || !r.data.length) { el.innerHTML = '<div class="empty">Nenhuma parcela cadastrada</div>'; return; }
  el.innerHTML = r.data.map(p => {
    const mensal = p.valor_total / p.num_parcelas;
    const pct = Math.round(p.parcelas_pagas / p.num_parcelas * 100);
    const restam = p.num_parcelas - p.parcelas_pagas;
    return `
    <div style="background:var(--bg3);border-radius:10px;padding:16px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:10px;">
        <div>
          <div style="font-weight:600">${esc(p.descricao)}</div>
          <div style="font-size:12px;color:var(--muted)">${esc(p.categoria)} · ${fmt(mensal)}/mês · ${restam} restante(s)</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          ${restam > 0 ? `<button class="btn btn-green btn-sm" onclick="pagarParcela(${p.id})">Pagar parcela</button>` : '<span class="badge badge-green">Quitado ✓</span>'}
          <button class="btn btn-red btn-sm" onclick="delParcela(${p.id})">✕</button>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:4px">
        <span>${p.parcelas_pagas}/${p.num_parcelas} pagas</span>
        <span>${pct}%</span>
      </div>
      <div class="progress"><div class="progress-bar" style="width:${pct}%;background:var(--blue)"></div></div>
    </div>`;
  }).join('');
}

async function addParcela() {
  const desc = document.getElementById('p-desc').value.trim();
  const total = document.getElementById('p-total').value;
  const num = document.getElementById('p-num').value;
  if (!desc || !total || !num) return toast('Preencha todos os campos', 'error');
  const r = await api('POST', '/api/parcelas', {
    descricao: desc, valor_total: parseFloat(total),
    num_parcelas: parseInt(num), categoria: document.getElementById('p-cat').value,
    data_inicio: document.getElementById('p-data').value || today()
  });
  if (r.ok) { toast('Parcela adicionada!'); document.getElementById('p-desc').value=''; document.getElementById('p-total').value=''; document.getElementById('p-num').value=''; loadParcelas(); }
  else toast(r.erro || 'Erro', 'error');
}

async function pagarParcela(id) {
  const r = await api('PATCH', '/api/parcelas/' + id + '/pagar');
  if (r.ok) { toast('Parcela paga!'); loadParcelas(); }
}

async function delParcela(id) {
  if (!confirm('Excluir parcela?')) return;
  const r = await api('DELETE', '/api/parcelas/' + id);
  if (r.ok) { toast('Excluída!'); loadParcelas(); }
}

