// src/utils/exportarDados.js — Planilha (.xlsx) com todos os dados de um usuário
// Usada por "Baixar meus dados" (Minha conta). Uma aba por tipo de dado, só do
// próprio usuário, sem campos internos (ids de outras tabelas, hashes etc.).
const ExcelJS = require('exceljs');

const MOEDA = '"R$" #,##0.00;[Red]-"R$" #,##0.00';

const STATUS = {
  pago: 'Pago', recebido: 'Recebido', pendente: 'Pendente', a_pagar: 'A pagar', a_receber: 'A receber'
};
const TIPO_INV = { acao: 'Ação', fii: 'FII', cripto: 'Cripto', renda_fixa: 'Renda fixa' };

// Cada aba: título, colunas { header, key, width, moeda? } e as linhas já prontas
function abas(db, uid) {
  const bancos = db.prepare('SELECT * FROM bancos WHERE usuario_id = ? ORDER BY nome').all(uid);
  const nomeBanco = Object.fromEntries(bancos.map(b => [b.id, `${b.nome} (${b.titular || 'Você'})`]));

  return [
    {
      titulo: 'Transações',
      colunas: [
        { header: 'Data', key: 'data', width: 12 },
        { header: 'Descrição', key: 'descricao', width: 40 },
        { header: 'Tipo', key: 'tipo', width: 10 },
        { header: 'Categoria', key: 'categoria', width: 18 },
        { header: 'Valor', key: 'valor', width: 14, moeda: true },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Banco', key: 'banco', width: 24 },
        { header: 'Origem', key: 'origem', width: 12 }
      ],
      linhas: db.prepare('SELECT * FROM transacoes WHERE usuario_id = ? ORDER BY data DESC, id DESC').all(uid).map(t => ({
        data: t.data, descricao: t.descricao, tipo: t.tipo === 'entrada' ? 'Entrada' : 'Saída',
        categoria: t.categoria, valor: t.valor, status: STATUS[t.status] || t.status || 'Pago',
        banco: nomeBanco[t.banco_id] || '', origem: t.origem
      }))
    },
    {
      titulo: 'Bancos',
      colunas: [
        { header: 'Banco', key: 'nome', width: 24 },
        { header: 'Titular', key: 'titular', width: 16 },
        { header: 'Agência', key: 'agencia', width: 10 },
        { header: 'Conta', key: 'conta', width: 14 },
        { header: 'Saldo', key: 'saldo', width: 14, moeda: true }
      ],
      linhas: bancos
    },
    {
      titulo: 'Parcelas',
      colunas: [
        { header: 'Descrição', key: 'descricao', width: 36 },
        { header: 'Valor total', key: 'valor_total', width: 14, moeda: true },
        { header: 'Nº de parcelas', key: 'num_parcelas', width: 14 },
        { header: 'Parcelas pagas', key: 'parcelas_pagas', width: 14 },
        { header: 'Categoria', key: 'categoria', width: 16 },
        { header: 'Início', key: 'data_inicio', width: 12 }
      ],
      linhas: db.prepare('SELECT * FROM parcelas WHERE usuario_id = ? ORDER BY data_inicio DESC').all(uid)
    },
    {
      titulo: 'Contas futuras',
      colunas: [
        { header: 'Descrição', key: 'descricao', width: 36 },
        { header: 'Valor', key: 'valor', width: 14, moeda: true },
        { header: 'Data prevista', key: 'data_prevista', width: 14 },
        { header: 'Prioridade', key: 'prioridade', width: 12 },
        { header: 'Concluída', key: 'concluida', width: 10 }
      ],
      linhas: db.prepare('SELECT * FROM despesas_futuras WHERE usuario_id = ? ORDER BY data_prevista').all(uid)
        .map(f => ({ ...f, concluida: f.concluida ? 'Sim' : 'Não' }))
    },
    {
      titulo: 'Investimentos',
      colunas: [
        { header: 'Tipo', key: 'tipo', width: 12 },
        { header: 'Ticker', key: 'ticker', width: 10 },
        { header: 'Nome', key: 'nome', width: 30 },
        { header: 'Quantidade', key: 'quantidade', width: 12 },
        { header: 'Preço médio', key: 'preco_medio', width: 14, moeda: true },
        { header: 'Valor aplicado', key: 'valor_aplicado', width: 16, moeda: true },
        { header: 'Rentabilidade', key: 'rentabilidade_info', width: 16 },
        { header: 'Vencimento', key: 'vencimento', width: 12 },
        { header: 'Banco/Corretora', key: 'banco', width: 24 }
      ],
      linhas: db.prepare('SELECT * FROM investimentos WHERE usuario_id = ? ORDER BY created_at DESC').all(uid)
        .map(i => ({ ...i, tipo: TIPO_INV[i.tipo] || i.tipo, banco: nomeBanco[i.banco_id] || '' }))
    }
  ];
}

async function gerarPlanilhaDados(db, uid) {
  const user = db.prepare('SELECT nome, usuario, email, created_at FROM usuarios WHERE id = ?').get(uid);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FinanceFlow';
  wb.created = new Date();

  const perfil = wb.addWorksheet('Minha conta');
  perfil.columns = [{ header: 'Campo', key: 'campo', width: 22 }, { header: 'Valor', key: 'valor', width: 40 }];
  perfil.addRows([
    { campo: 'Nome', valor: user.nome },
    { campo: 'Usuário', valor: user.usuario },
    { campo: 'E-mail', valor: user.email || '' },
    { campo: 'Conta criada em', valor: user.created_at },
    { campo: 'Exportado em', valor: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) }
  ]);
  perfil.getRow(1).font = { bold: true };

  for (const aba of abas(db, uid)) {
    const ws = wb.addWorksheet(aba.titulo);
    ws.columns = aba.colunas.map(({ header, key, width }) => ({ header, key, width }));
    ws.addRows(aba.linhas);
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    aba.colunas.filter(c => c.moeda).forEach(c => { ws.getColumn(c.key).numFmt = MOEDA; });
  }

  return wb.xlsx.writeBuffer();
}

module.exports = { gerarPlanilhaDados };
