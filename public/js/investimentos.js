// ── INVESTIMENTOS ─────────────────────────────────────────────
// Carteira de investimentos (ações, FIIs, cripto, renda fixa). A barra
// de cotações (loadMercado) busca preços em tempo real; o formulário se
// adapta ao tipo escolhido (renda fixa não tem ticker/quantidade, usa
// valor aplicado + rentabilidade). pedirRecomendacaoIA() pede uma
// análise da carteira para o assistente de IA.
function fmtPct(v) {
  const n = parseFloat(v || 0);
  return (n >= 0 ? '+' : '') + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}
function fmtQtd(v) {
  const n = parseFloat(v || 0);
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 8 });
}

const TIPO_LABEL = { acao: 'Ação', fii: 'FII', cripto: 'Cripto', renda_fixa: 'Renda Fixa' };

async function loadMercado() {
  const el = document.getElementById('inv-ticker-bar');
  if (!el) return;
  const r = await api('GET', '/api/investimentos/mercado');
  if (!r.ok) { el.innerHTML = '<div class="empty">Não foi possível carregar as cotações agora.</div>'; return; }

  const itens = [
    { label: 'Dólar',    key: 'USD', fmt: v => 'R$ ' + v.toFixed(4) },
    { label: 'Euro',     key: 'EUR', fmt: v => 'R$ ' + v.toFixed(4) },
    { label: 'Bitcoin',  key: 'BTC', fmt: v => fmt(v) },
    { label: 'Ethereum', key: 'ETH', fmt: v => fmt(v) }
  ];

  el.innerHTML = itens.map(it => {
    const d = r.data[it.key];
    if (!d) return `<div class="ticker-chip"><div class="ticker-chip-label">${it.label}</div><div class="ticker-chip-val">—</div></div>`;
    const pctClasse = d.variacao_pct > 0 ? 'up' : d.variacao_pct < 0 ? 'down' : 'flat';
    return `
      <div class="ticker-chip">
        <div class="ticker-chip-label">${it.label}${d.defasado ? ' *' : ''}</div>
        <div class="ticker-chip-val">${it.fmt(d.preco)}</div>
        <div class="ticker-chip-pct ${pctClasse}">${d.variacao_pct ? fmtPct(d.variacao_pct) : '—'}</div>
      </div>`;
  }).join('');
}

function atualizarFormInvestimento() {
  const tipo = document.getElementById('inv-tipo').value;
  const rendaFixa = tipo === 'renda_fixa';
  document.getElementById('inv-grupo-ticker').style.display = rendaFixa ? 'none' : '';
  document.getElementById('inv-grupo-qtd').style.display = rendaFixa ? 'none' : '';
  document.getElementById('inv-grupo-preco').style.display = rendaFixa ? 'none' : '';
  document.getElementById('inv-grupo-valor-aplicado').style.display = rendaFixa ? '' : 'none';
  document.getElementById('inv-grupo-rentabilidade').style.display = rendaFixa ? '' : 'none';
}

function investimentoCard(inv) {
  const isRendaFixa = inv.tipo === 'renda_fixa';
  const plClasse = inv.lucro >= 0 ? 'up' : 'down';
  const detalhe = isRendaFixa
    ? (inv.rentabilidade_info || 'Renda fixa')
    : `${fmtQtd(inv.quantidade)} ${esc(inv.ticker)} · Preço médio ${fmt(inv.preco_medio)}${inv.preco_atual != null ? ` · Atual ${fmt(inv.preco_atual)}` : ''}`;

  return `
    <div class="inv-card">
      <div>
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px">
          <span class="inv-tipo-badge ${inv.tipo}">${TIPO_LABEL[inv.tipo]}</span>
          <span style="font-weight:700">${esc(inv.nome)}</span>
          ${inv.defasado ? '<span title="Cotação pode estar desatualizada" class="badge badge-yellow">desatualizada</span>' : ''}
        </div>
        <div style="font-size:12px; color:var(--muted)">${detalhe}</div>
      </div>
      <div style="display:flex; align-items:center; gap:20px">
        <div style="text-align:right">
          <div style="font-weight:700">${fmt(inv.valor_atual)}</div>
          <div class="inv-pl ${plClasse}" style="font-size:12px">${fmt(inv.lucro)} (${fmtPct(inv.lucro_pct)})</div>
        </div>
        <div style="display:flex; gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="editarInvestimento(${inv.id})" title="Editar">✎</button>
          <button class="btn btn-red btn-sm" onclick="delInvestimento(${inv.id})" title="Excluir">✕</button>
        </div>
      </div>
    </div>`;
}

async function loadInvestimentos() {
  const [rLista, rResumo] = await Promise.all([
    api('GET', '/api/investimentos'),
    api('GET', '/api/investimentos/resumo')
  ]);

  if (rResumo.ok) {
    const s = rResumo.data;
    document.getElementById('inv-total-investido').textContent = fmt(s.valor_investido);
    document.getElementById('inv-total-atual').textContent = fmt(s.valor_atual);
    const lucroEl = document.getElementById('inv-total-lucro');
    lucroEl.textContent = fmt(s.lucro);
    lucroEl.style.color = s.lucro >= 0 ? 'var(--green)' : 'var(--red)';
    const lucroPctEl = document.getElementById('inv-total-lucro-pct');
    lucroPctEl.textContent = fmtPct(s.lucro_pct);
    lucroPctEl.style.color = s.lucro >= 0 ? 'var(--green)' : 'var(--red)';
  }

  const el = document.getElementById('inv-lista');
  if (!rLista.ok || !rLista.data.length) {
    el.innerHTML = '<div class="empty">Nenhum investimento cadastrado ainda.</div>';
    return;
  }
  el.innerHTML = rLista.data.map(investimentoCard).join('');
}

let _invEditId = null;

function limparFormInvestimento() {
  ['inv-ticker', 'inv-nome', 'inv-quantidade', 'inv-preco-medio', 'inv-valor-aplicado', 'inv-rentabilidade'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('inv-tipo').value = 'acao';
  document.getElementById('inv-banco').value = '';
  atualizarFormInvestimento();
}

function cancelarEdicaoInvestimento() {
  _invEditId = null;
  document.getElementById('inv-form-titulo').textContent = 'Adicionar Posição';
  document.getElementById('inv-btn-salvar').textContent = 'Adicionar';
  document.getElementById('inv-btn-cancelar').style.display = 'none';
  document.getElementById('inv-tipo').disabled = false;
  limparFormInvestimento();
}

async function salvarInvestimento() {
  const tipo = document.getElementById('inv-tipo').value;
  const nome = document.getElementById('inv-nome').value.trim();
  if (!nome) return toast('Nome é obrigatório', 'error');

  const ticker = document.getElementById('inv-ticker').value.trim();
  if (tipo !== 'renda_fixa' && !ticker) return toast('Ticker é obrigatório para esse tipo', 'error');

  const payload = {
    tipo, nome,
    ticker: tipo !== 'renda_fixa' ? ticker : undefined,
    quantidade: parseFloat(document.getElementById('inv-quantidade').value) || 0,
    preco_medio: parseFloat(document.getElementById('inv-preco-medio').value) || 0,
    valor_aplicado: tipo === 'renda_fixa' ? (parseFloat(document.getElementById('inv-valor-aplicado').value) || 0) : undefined,
    rentabilidade_info: document.getElementById('inv-rentabilidade').value.trim() || undefined,
    banco_id: document.getElementById('inv-banco').value || undefined
  };

  const r = _invEditId
    ? await api('PATCH', `/api/investimentos/${_invEditId}`, payload)
    : await api('POST', '/api/investimentos', payload);

  if (r.ok) {
    toast(_invEditId ? 'Posição atualizada!' : 'Posição adicionada!');
    cancelarEdicaoInvestimento();
    loadInvestimentos();
  } else toast(r.erro || 'Erro', 'error');
}

async function editarInvestimento(id) {
  const r = await api('GET', '/api/investimentos');
  if (!r.ok) return toast('Erro ao carregar', 'error');
  const inv = r.data.find(i => i.id === id);
  if (!inv) return toast('Investimento não encontrado', 'error');

  _invEditId = id;
  document.getElementById('inv-tipo').value = inv.tipo;
  document.getElementById('inv-tipo').disabled = true;
  atualizarFormInvestimento();
  document.getElementById('inv-ticker').value = inv.ticker || '';
  document.getElementById('inv-nome').value = inv.nome;
  document.getElementById('inv-quantidade').value = inv.quantidade || '';
  document.getElementById('inv-preco-medio').value = inv.preco_medio || '';
  document.getElementById('inv-valor-aplicado').value = inv.valor_aplicado || '';
  document.getElementById('inv-rentabilidade').value = inv.rentabilidade_info || '';
  document.getElementById('inv-banco').value = inv.banco_id || '';

  document.getElementById('inv-form-titulo').textContent = 'Editar Posição';
  document.getElementById('inv-btn-salvar').textContent = 'Salvar';
  document.getElementById('inv-btn-cancelar').style.display = '';
  document.getElementById('tab-investimentos').scrollIntoView({ behavior: 'smooth' });
}

async function delInvestimento(id) {
  if (!confirm('Excluir esta posição da carteira?')) return;
  const r = await api('DELETE', `/api/investimentos/${id}`);
  if (r.ok) { toast('Posição removida!'); loadInvestimentos(); }
  else toast(r.erro || 'Erro', 'error');
}

async function pedirRecomendacaoIA() {
  const btn = document.getElementById('btn-recomendacao-ia');
  const el = document.getElementById('inv-ia-resultado');
  btn.disabled = true;
  btn.textContent = 'Analisando...';
  el.innerHTML = '<div class="empty">Analisando sua carteira e saldo livre...</div>';

  const r = await api('POST', '/api/investimentos/recomendacao', {});
  btn.disabled = false;
  btn.textContent = 'Pedir sugestão';

  if (!r.ok) { el.innerHTML = `<div class="empty">${r.erro || 'IA indisponível no momento.'}</div>`; return; }

  const d = r.data;
  const sugestoes = (d.sugestoes || []).map(s => `
    <div class="inv-sugestao">
      <div class="inv-sugestao-titulo">${esc(s.titulo)}</div>
      <div class="inv-sugestao-desc">${esc(s.descricao)}</div>
    </div>`).join('');

  const comentarios = (d.comentarios_ativos || []).map(c => `
    <div class="inv-sugestao" style="border-left-color:var(--purple)">
      <div class="inv-sugestao-titulo">${esc(c.ticker)}</div>
      <div class="inv-sugestao-desc">${esc(c.comentario)}</div>
    </div>`).join('');

  el.innerHTML = `
    <div class="inv-ia-box">
      <div style="margin-bottom:14px">${d.resumo || ''}</div>
      ${sugestoes}
      ${comentarios}
      <div class="inv-ia-disclaimer">Apoio educacional baseado nos seus dados — não é recomendação financeira registrada (CVM).</div>
    </div>`;
}

