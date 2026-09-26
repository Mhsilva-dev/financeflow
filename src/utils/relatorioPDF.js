// src/utils/relatorioPDF.js — Gera o relatório financeiro em PDF
const { renderizarPDF, fmtMoeda, escapeHTML } = require('./pdf');

const LABEL_PERIODO = {
  dia:    'Relatório de hoje',
  semana: 'Relatório da semana',
  mes:    'Relatório do mês atual',
  total:  'Relatório geral (tudo)'
};

function fmtMes(mes) {
  const [ano, m] = String(mes).split('-');
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return m ? `${nomes[parseInt(m, 10) - 1]}/${ano}` : mes;
}

function gerarHTMLRelatorio(dados, periodo) {
  const { totais, porCategoria, porMes, taxaPoupanca } = dados;
  const dataGeracao = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  const gastosPorCategoria = porCategoria.filter(c => c.tipo === 'saida');
  const maiorGasto = gastosPorCategoria[0]?.total || 0;

  const linhasCategoria = gastosPorCategoria.length
    ? gastosPorCategoria.map(c => `
        <tr>
          <td>${escapeHTML(c.categoria || 'Outros')}</td>
          <td class="num">${c.qtd}</td>
          <td class="num">${fmtMoeda(c.total)}</td>
          <td class="barra-cel"><div class="barra" style="width:${maiorGasto ? Math.round((c.total / maiorGasto) * 100) : 0}%"></div></td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="vazio">Nenhum gasto no período</td></tr>';

  const linhasMeses = porMes.length
    ? [...porMes].reverse().map(m => `
        <tr>
          <td>${fmtMes(m.mes)}</td>
          <td class="num entrada">${fmtMoeda(m.entradas)}</td>
          <td class="num saida">${fmtMoeda(m.saidas)}</td>
          <td class="num ${m.entradas - m.saidas >= 0 ? 'entrada' : 'saida'}">${fmtMoeda(m.entradas - m.saidas)}</td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="vazio">Sem dados no período</td></tr>';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Arial, sans-serif; color: #1a1a2e; margin: 0; padding: 32px 40px; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { color: #6b7280; font-size: 12px; margin: 0 0 24px; }
  .cards { display: flex; gap: 12px; margin-bottom: 24px; }
  .card { flex: 1; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; }
  .card .label { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
  .card .valor { font-size: 16px; font-weight: 700; }
  .entrada { color: #16a34a; }
  .saida { color: #dc2626; }
  h2 { font-size: 14px; margin: 24px 0 8px; padding-bottom: 6px; border-bottom: 2px solid #1a1a2e; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; color: #6b7280; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
  td { padding: 6px 8px; border-bottom: 1px solid #f3f4f6; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .barra-cel { width: 120px; }
  .barra { height: 8px; background: #1a1a2e; border-radius: 4px; }
  .vazio { text-align: center; color: #9ca3af; padding: 16px; }
  .rodape { margin-top: 24px; font-size: 10px; color: #9ca3af; }
</style>
</head>
<body>
  <h1>FinanceFlow Pro — Relatório Financeiro</h1>
  <p class="sub">${LABEL_PERIODO[periodo] || 'Relatório'} · gerado em ${dataGeracao}</p>

  <div class="cards">
    <div class="card"><div class="label">Entradas</div><div class="valor entrada">${fmtMoeda(totais.entradas)}</div></div>
    <div class="card"><div class="label">Saídas</div><div class="valor saida">${fmtMoeda(totais.saidas)}</div></div>
    <div class="card"><div class="label">Saldo</div><div class="valor ${totais.saldo >= 0 ? 'entrada' : 'saida'}">${fmtMoeda(totais.saldo)}</div></div>
    <div class="card"><div class="label">Taxa de poupança</div><div class="valor">${taxaPoupanca}%</div></div>
  </div>

  <h2>Gastos por Categoria</h2>
  <table>
    <thead><tr><th>Categoria</th><th class="num">Qtd.</th><th class="num">Total</th><th></th></tr></thead>
    <tbody>${linhasCategoria}</tbody>
  </table>

  <h2>Comparação Mensal</h2>
  <table>
    <thead><tr><th>Mês</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Saldo</th></tr></thead>
    <tbody>${linhasMeses}</tbody>
  </table>

  <p class="rodape">Total de ${totais.total_transacoes} transação(ões) no período.</p>
</body>
</html>`;
}

async function gerarPDFRelatorio(dados, periodo) {
  return renderizarPDF(gerarHTMLRelatorio(dados, periodo));
}

module.exports = { gerarPDFRelatorio, gerarHTMLRelatorio };
