// ── RELATÓRIO ────────────────────────────────────────────────
// Relatório com 4 períodos (hoje/semana/mês/total). REL_CONFIG define os
// textos de cada período; formatChartLabel() sabe formatar o rótulo do
// eixo do gráfico de acordo com o período (dia="DD/MM", semana="Sem N",
// mês="MM/YYYY"), pois o backend devolve os buckets em formatos diferentes.
let relPeriodo = 'mes';

const REL_CONFIG = {
  dia:    { label: 'Relatório de hoje',        chartTitle: 'Últimos 7 dias',        compTitle: 'Por dia (últimos 7 dias)' },
  semana: { label: 'Relatório desta semana',   chartTitle: 'Últimas 8 semanas',     compTitle: 'Por semana' },
  mes:    { label: 'Relatório do mês atual',   chartTitle: 'Evolução dos 12 meses', compTitle: 'Comparação mensal' },
  total:  { label: 'Relatório geral (tudo)',   chartTitle: 'Evolução dos 12 meses', compTitle: 'Comparação mensal' },
};

function setRelPeriodo(p) {
  relPeriodo = p;
  document.querySelectorAll('.rel-periodo-btn').forEach(b => b.classList.toggle('active', b.dataset.periodo === p));
  loadRelatorio();
}

async function exportarRelatorioPDF() {
  const btn = document.getElementById('btn-exportar-pdf');
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Gerando...';

  try {
    const r = await fetch(`/api/relatorio/pdf?periodo=${relPeriodo}`);
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      toast(data.erro || 'Erro ao gerar PDF', 'error');
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-${relPeriodo}-${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    toast('Erro ao gerar PDF: ' + (err?.message || 'tente novamente'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

function formatChartLabel(mes, periodo) {
  if (periodo === 'dia') {
    // mes = "YYYY-MM-DD"
    const [y, m, d] = mes.split('-');
    return `${d}/${m}`;
  }
  if (periodo === 'semana') {
    // mes = "YYYY-WNN"
    const parts = mes.split('-W');
    return `Sem ${parts[1] || mes}`;
  }
  // mes/total: "YYYY-MM"
  return mes.slice(0,7).split('-').reverse().join('/').slice(0,5);
}

async function loadRelatorio() {
  const cfg = REL_CONFIG[relPeriodo] || REL_CONFIG.mes;
  document.getElementById('rel-periodo-label').textContent = cfg.label;
  document.getElementById('rel-chart-title').textContent = cfg.chartTitle;
  document.getElementById('rel-comp-title').textContent = cfg.compTitle;

  const [r, rc] = await Promise.all([
    api('GET', `/api/relatorio?periodo=${relPeriodo}`),
    api('GET', `/api/relatorio/comparacao?periodo=${relPeriodo}`)
  ]);
  if (!r.ok) return;
  const d = r.data;

  document.getElementById('rel-cards').innerHTML = `
    <div class="card"><div class="card-label">Saldo do Período</div><div class="card-value ${parseFloat(d.totais.saldo)>=0?'blue':'red'}">${fmt(d.totais.saldo)}</div></div>
    <div class="card"><div class="card-label">Entradas</div><div class="card-value green">${fmt(d.totais.entradas)}</div></div>
    <div class="card"><div class="card-label">Saídas</div><div class="card-value red">${fmt(d.totais.saidas)}</div></div>
    <div class="card"><div class="card-label">Taxa de Poupança</div><div class="card-value ${parseFloat(d.taxaPoupanca)>=0?'blue':'red'}">${d.taxaPoupanca}%</div></div>`;

  // Gráfico de evolução
  if (rc.ok && rc.data.length) {
    const todos = rc.data;
    const maxVal = Math.max(...todos.map(m => Math.max(m.entradas, m.saidas)), 1);
    document.getElementById('chart-evolucao').innerHTML = todos.map(m => {
      const hE = Math.round((m.entradas / maxVal) * 130);
      const hS = Math.round((m.saidas / maxVal) * 130);
      const label = formatChartLabel(m.mes, relPeriodo);
      return `<div class="chart-col">
        <div class="chart-col-bars">
          <div class="chart-bar entrada" style="height:${hE}px" data-tip="Entradas: ${fmt(m.entradas)}"></div>
          <div class="chart-bar saida" style="height:${hS}px" data-tip="Saídas: ${fmt(m.saidas)}"></div>
        </div>
        <div class="chart-mes">${label}</div>
      </div>`;
    }).join('');
  } else {
    document.getElementById('chart-evolucao').innerHTML = '<div class="empty">Sem dados neste período</div>';
  }

  // Gastos por categoria
  const cats = d.porCategoria.filter(c => c.tipo === 'saida');
  const maxCat = cats.length ? cats[0].total : 1;
  document.getElementById('rel-cats').innerHTML = cats.length ? cats.map(c => `
    <div class="cat-item">
      <div class="cat-bar">
        <div class="cat-name"><span>${esc(c.categoria)}</span><strong>${fmt(c.total)}</strong></div>
        <div class="progress"><div class="progress-bar" style="width:${(c.total/maxCat*100).toFixed(0)}%;background:var(--red)"></div></div>
      </div>
    </div>`).join('') : '<div class="empty">Sem gastos neste período</div>';

  // Comparação por buckets
  const buckets = rc.ok ? rc.data : [];
  document.getElementById('rel-meses').innerHTML = buckets.length ? [...buckets].reverse().map(m => {
    const saldo = m.entradas - m.saidas;
    const label = formatChartLabel(m.mes, relPeriodo);
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
      <span style="color:var(--muted);min-width:60px;font-size:12px">${label}</span>
      <span style="color:var(--green);font-size:12px">+${fmt(m.entradas)}</span>
      <span style="color:var(--red);font-size:12px">-${fmt(m.saidas)}</span>
      <span style="color:${saldo>=0?'var(--blue)':'var(--red)'};font-weight:600;font-size:12px">${fmt(saldo)}</span>
    </div>`;
  }).join('') : '<div class="empty">Sem dados neste período</div>';
}

