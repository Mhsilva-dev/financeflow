// src/routes/transacoes/helpers.js
// Funções e constantes compartilhadas entre os sub-routers de transações
// (listagem, crud, lote, importacao). Nada aqui monta rota — é só lógica
// reaproveitada para não duplicar validação/formatação entre os arquivos.
const multer = require('multer');

// Multer em memória — não salva arquivo em disco, apenas passa o buffer para a IA
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // máx 10 MB
  fileFilter: (req, file, cb) => {
    // Aceita apenas imagens
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Apenas imagens são permitidas'));
    }
    cb(null, true);
  }
});

// Upload de extrato OFX/CSV/Excel/PDF — até 8 MB
const uploadExtrato = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/\.(ofx|csv|txt|xlsx|pdf)$/i.test(file.originalname)) {
      return cb(new Error('Envie um arquivo .ofx, .csv, .xlsx ou .pdf'));
    }
    cb(null, true);
  }
});

// Acha um banco existente por nome + titular (ignora acentuação/caixa) ou cria um novo automaticamente.
// O mesmo banco (ex: Nubank) pode existir mais de uma vez, um por titular — o extrato do marido
// nunca deve cair em cima do extrato da esposa só porque o nome do banco é igual.
function encontrarOuCriarBanco(db, uid, nomeDetectado, titular) {
  if (!nomeDetectado) return { bancoId: null, criado: false };

  const normalizar = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const titularAlvo = titular ? normalizar(titular) : normalizar('Você');
  const alvo = normalizar(nomeDetectado);
  const existente = db.prepare('SELECT id, nome, titular FROM bancos WHERE usuario_id = ?').all(uid)
    .find(b => normalizar(b.nome) === alvo && normalizar(b.titular || 'Você') === titularAlvo);

  if (existente) return { bancoId: existente.id, criado: false };

  const result = db.prepare(`
    INSERT INTO bancos (nome, agencia, conta, saldo, cor, titular, usuario_id)
    VALUES (?, '0001', '****', 0, '#8a9ab5', ?, ?)
  `).run(nomeDetectado, titular || 'Você', uid);

  return { bancoId: result.lastInsertRowid, criado: true };
}

// Só aceita banco_id que pertença ao usuário — senão grava null (evita apontar pro banco de outra conta)
function bancoDoUsuario(db, uid, bancoId) {
  const id = parseInt(bancoId, 10);
  if (isNaN(id)) return null;
  return db.prepare('SELECT 1 FROM bancos WHERE id = ? AND usuario_id = ?').get(id, uid) ? id : null;
}

// Tipos e formatos válidos para validação de entrada
const TIPOS_VALIDOS   = new Set(['entrada', 'saida']);
const STATUS_VALIDOS  = new Set(['pago', 'pendente', 'a_pagar', 'recebido', 'a_receber']);
const REGEX_MES       = /^\d{4}-(0[1-9]|1[0-2])$/;
const REGEX_DATA      = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// Valida e monta a query de listagem de transações — usado pelo JSON e pelo PDF, pra nunca divergir.
// Retorna { erro } se algum filtro for inválido, senão { sql, params, filtros } pronto pro db.prepare().all(...params).
function montarQueryTransacoes(query, uid) {
  const { tipo, categoria, busca, mes, status, banco_id } = query;
  const limit = Math.min(parseInt(query.limit) || 100, 500);

  if (mes && !REGEX_MES.test(mes)) return { erro: 'Formato de mês inválido. Use YYYY-MM' };
  if (tipo && !TIPOS_VALIDOS.has(tipo)) return { erro: 'Tipo inválido. Use "entrada" ou "saida"' };
  if (status && !STATUS_VALIDOS.has(status)) return { erro: 'Status inválido. Use "pago", "pendente" ou "a_pagar"' };
  if (banco_id && isNaN(parseInt(banco_id, 10))) return { erro: 'banco_id inválido' };

  let sql      = 'SELECT * FROM transacoes WHERE usuario_id = ?';
  const params = [uid];

  if (mes)       { sql += " AND strftime('%Y-%m', data) = ?"; params.push(mes); }
  if (tipo)      { sql += ' AND tipo = ?';                    params.push(tipo); }
  if (categoria) { sql += ' AND categoria = ?';               params.push(categoria); }
  if (busca)     { sql += ' AND descricao LIKE ?';            params.push(`%${busca}%`); }
  if (status)    { sql += ' AND status = ?';                  params.push(status); }
  if (banco_id)  { sql += ' AND banco_id = ?';                params.push(parseInt(banco_id, 10)); }

  sql += ' ORDER BY CASE WHEN tipo=\'entrada\' THEN 0 ELSE 1 END ASC, data DESC, created_at DESC LIMIT ?';
  params.push(limit);

  return { sql, params, filtros: { mes, tipo, categoria, busca, status } };
}

// Avança a data exatamente 1 mês respeitando fim de mês
function proximoMes(dataStr) {
  const [ano, mes, dia] = dataStr.slice(0, 10).split('-').map(Number);
  const d = new Date(ano, mes, dia); // mes já é 1-based, new Date usa 0-based → já avança 1 mês
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Converte o resultado do Gemini (analisarExtratoPDF) pro mesmo formato dos outros parsers
function transacoesDoPDF(resultado) {
  return (resultado.transacoes || [])
    .filter(tx => tx.data && tx.valor)
    .map(tx => {
      const valor = Math.abs(parseFloat(tx.valor)) || 0;
      const descricao = tx.descricao || 'Transação importada';
      return {
        data: tx.data,
        descricao,
        valor,
        tipo: tx.tipo === 'entrada' ? 'entrada' : 'saida',
        categoria: null,
        idExterno: `pdf:${tx.data}|${descricao}|${valor}`
      };
    })
    .filter(tx => tx.valor > 0);
}

// Tratamento de erro do multer (ex: arquivo muito grande ou formato rejeitado no fileFilter)
// Montado como último middleware do router principal — precisa dos 4 argumentos
// para o Express reconhecer como error handler.
function tratarErroUpload(err, req, res, next) {
  if (err.message === 'Apenas imagens são permitidas' || err.message === 'Envie um arquivo .ofx, .csv, .xlsx ou .pdf') {
    return res.status(400).json({ ok: false, erro: err.message });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ ok: false, erro: 'Arquivo muito grande. Máximo 8 MB para extrato, 10 MB para foto.' });
  }
  next(err);
}

module.exports = {
  upload,
  uploadExtrato,
  encontrarOuCriarBanco,
  bancoDoUsuario,
  TIPOS_VALIDOS,
  STATUS_VALIDOS,
  REGEX_MES,
  REGEX_DATA,
  montarQueryTransacoes,
  proximoMes,
  transacoesDoPDF,
  tratarErroUpload
};
