// src/utils/transacoesPDF.js — Gera a lista de transações filtrada em PDF
const { renderizarPDF, fmtMoeda, escapeHTML } = require('./pdf');

function fmtData(iso) {
  const [ano, m, d] = String(iso).split('-');
  return d ? `${d}/${m}/${ano}` : iso;
}

const LABEL_TIPO   = { entrada: 'Entrada', saida: 'Saída' };
const LABEL_STATUS = { pago: 'Pago', recebido: 'Recebido', pendente: 'Pendente', a_pagar: 'A pagar', a_receber: 'A receber' };

function gerarHTMLTransacoes(transacoes, filtros) {
  const dataGeracao = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  const entradas = transacoes.filter(t => t.tipo === 'entrada').reduce((s, t) => s + t.valor, 0);
  const saidas   = transacoes.filter(t => t.tipo === 'saida').reduce((s, t) => s + t.valor, 0);

  const linhas = transacoes.length
    ? transacoes.map(t => `
        <tr>
          <td>${fmtData(t.data)}</td>
          <td>${escapeHTML(t.descricao)}</td>
          <td>${escapeHTML(t.categoria || 'Outros')}</td>
          <td>${LABEL_STATUS[t.status] || 'Pago'}</td>
          <td class="num ${t.tipo === 'entrada' ? 'entrada' : 'saida'}">${t.tipo === 'entrada' ? '+' : '-'}${fmtMoeda(t.valor)}</td>
        </tr>`).join('')
    : '<tr><td colspan="5" class="vazio">Nenhuma transação encontrada</td></tr>';

  const filtrosAtivos = Object.entries(filtros).filter(([, v]) => v);
  const subLabel = filtrosAtivos.length
    ? filtrosAtivos.map(([k, v]) => `${k}: ${escapeHTML(k === 'tipo' ? (LABEL_TIPO[v] || v) : v)}`).join(' · ')
    : 'Todas as transações';

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
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; color: #6b7280; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
  td { padding: 6px 8px; border-bottom: 1px solid #f3f4f6; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .vazio { text-align: center; color: #9ca3af; padding: 16px; }
  .rodape { margin-top: 16px; font-size: 10px; color: #9ca3af; }
</style>
</head>
<body>
  <h1>FinanceFlow Pro — Transações</h1>
  <p class="sub">${subLabel} · gerado em ${dataGeracao}</p>

  <div class="cards">
    <div class="card"><div class="label">Entradas</div><div class="valor entrada">${fmtMoeda(entradas)}</div></div>
    <div class="card"><div class="label">Saídas</div><div class="valor saida">${fmtMoeda(saidas)}</div></div>
    <div class="card"><div class="label">Saldo</div><div class="valor ${entradas - saidas >= 0 ? 'entrada' : 'saida'}">${fmtMoeda(entradas - saidas)}</div></div>
  </div>

  <table>
    <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Status</th><th class="num">Valor</th></tr></thead>
    <tbody>${linhas}</tbody>
  </table>

  <p class="rodape">Total de ${transacoes.length} transação(ões).</p>
</body>
</html>`;
}

async function gerarPDFTransacoes(transacoes, filtros) {
  return renderizarPDF(gerarHTMLTransacoes(transacoes, filtros));
}

module.exports = { gerarPDFTransacoes, gerarHTMLTransacoes };
