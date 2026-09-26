// src/routes/transacoes/importacao.js
// Duas formas de trazer transações de fora do app: foto de comprovante
// lida por IA (Gemini) e importação de arquivo (OFX/CSV/XLSX/PDF).
const express = require('express');
const router  = express.Router();
const { getDb } = require('../../db');
const { analisarFotoGemini, analisarExtratoPDF } = require('../../gemini');
const { parseExtrato } = require('../../utils/importExtrato');
const { detectarBancoOFX, detectarBancoPorTexto } = require('../../utils/detectarBanco');
const { upload, uploadExtrato, encontrarOuCriarBanco, REGEX_MES, transacoesDoPDF } = require('./helpers');

// ── POST /foto — Análise de comprovante via IA ───────────────────────────────
router.post('/foto', upload.single('foto'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, erro: 'Nenhuma foto enviada' });
  }

  const base64    = req.file.buffer.toString('base64');
  const mime      = req.file.mimetype;
  const resultado = await analisarFotoGemini(base64, mime);

  if (!resultado) {
    return res.status(422).json({ ok: false, erro: 'Não foi possível ler o comprovante. Tente uma foto mais nítida.' });
  }

  res.json({ ok: true, data: resultado });
});

// ── POST /importar — Importa extrato/planilha OFX/CSV/XLSX/PDF (gratuito, sem Open Finance) ──
// modo 'adicionar' (padrão): mantém o que já existe, só acrescenta o que não existir (uso: extrato de um banco específico)
// modo 'substituir': para cada mês presente no arquivo, remove as transações importadas anteriormente daquele mês e
//                    coloca as da planilha no lugar — pensado pra planilha geral de gastos cobrindo vários meses de
//                    uma vez, sem virar bagunça a cada reenvio. Nunca mexe em lançamentos manuais ou de parcelas.
// Banco: se bancoId não for informado, tenta detectar automaticamente (nome do arquivo, conteúdo OFX/texto,
//        ou o que o Gemini identificar no PDF) e cria o banco na hora se ele ainda não existir.
router.post('/importar', uploadExtrato.single('arquivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, erro: 'Nenhum arquivo enviado' });

  const bancoIdManual  = req.body.bancoId ? parseInt(req.body.bancoId, 10) : null;
  const modoSubstituir = req.body.modo === 'substituir';
  const titular = req.body.titular ? String(req.body.titular).trim().slice(0, 60) : 'Você';
  const ehPdf  = /\.pdf$/i.test(req.file.originalname);
  const ehXlsx = /\.xlsx$/i.test(req.file.originalname);
  const texto  = (ehPdf || ehXlsx) ? null : req.file.buffer.toString('utf8');

  if (req.body.mesReferencia && !REGEX_MES.test(req.body.mesReferencia)) {
    return res.status(400).json({ ok: false, erro: 'Mês de referência inválido. Use o formato YYYY-MM' });
  }
  const mesReferencia = req.body.mesReferencia || null;

  let lidas;
  let nomeBancoDetectado = null;

  try {
    if (ehPdf) {
      const resultado = await analisarExtratoPDF(req.file.buffer.toString('base64'));
      if (!resultado) throw new Error('pdf_ilegivel');
      nomeBancoDetectado = resultado.banco || null;
      lidas = transacoesDoPDF(resultado);
    } else {
      lidas = await parseExtrato(texto, req.file.originalname, req.file.buffer, mesReferencia);
      // Planilha de orçamento não pertence a um banco só — não tenta detectar/criar banco pra ela
      const ehOrcamento = lidas.length > 0 && lidas[0].idExterno?.startsWith('orcamento:');
      if (!ehOrcamento) {
        const ehOFX = /\.ofx$/i.test(req.file.originalname) || /<OFX>/i.test(texto || '');
        nomeBancoDetectado = ehOFX
          ? detectarBancoOFX(texto)
          : detectarBancoPorTexto(`${req.file.originalname} ${texto || ''}`);
      }
    }
  } catch (err) {
    if (err.message === 'MES_REFERENCIA_REQUERIDO') {
      return res.status(422).json({
        ok: false,
        erro: 'Essa planilha parece ser um orçamento mensal (sem data por lançamento). Informe o mês de referência e envie novamente.',
        precisaMesReferencia: true
      });
    }
    return res.status(400).json({ ok: false, erro: 'Não foi possível ler o arquivo. Verifique o formato.' });
  }

  if (!lidas.length) {
    return res.status(422).json({ ok: false, erro: 'Nenhuma transação encontrada no arquivo. Confira se há colunas de data e valor reconhecíveis.' });
  }

  const db = getDb();
  let bancoId = bancoIdManual;
  let bancoCriado = false;
  let bancoNome = null;
  let bancoTitular = null;

  if (bancoId) {
    const banco = db.prepare('SELECT nome, titular FROM bancos WHERE id = ? AND usuario_id = ?').get(bancoId, req.uid);
    if (!banco) return res.status(404).json({ ok: false, erro: 'Banco não encontrado' });
    bancoNome    = banco ? banco.nome : null;
    bancoTitular = banco ? banco.titular : null;
  } else if (nomeBancoDetectado) {
    const achado = encontrarOuCriarBanco(db, req.uid, nomeBancoDetectado, titular);
    bancoId      = achado.bancoId;
    bancoCriado  = achado.criado;
    bancoNome    = nomeBancoDetectado;
    bancoTitular = titular;
  }

  const insertTx = db.prepare(`
    INSERT OR IGNORE INTO transacoes (descricao, tipo, categoria, valor, data, origem, banco_id, id_externo, usuario_id)
    VALUES (?, ?, ?, ?, ?, 'importado', ?, ?, ?)
  `);

  if (modoSubstituir) {
    const meses = [...new Set(lidas.map(tx => tx.data.slice(0, 7)))];
    const delStmt = db.prepare(`DELETE FROM transacoes WHERE usuario_id = ? AND origem = 'importado' AND strftime('%Y-%m', data) = ?`);

    const resultado = db.transaction(() => {
      let removidas = 0;
      for (const mes of meses) removidas += delStmt.run(req.uid, mes).changes;

      let count = 0;
      for (const tx of lidas) {
        const info = insertTx.run(
          tx.descricao.slice(0, 200), tx.tipo, tx.categoria || 'Outros', tx.valor, tx.data, bancoId, tx.idExterno, req.uid
        );
        if (info.changes > 0) count++;
      }
      return { importadas: count, removidas };
    })();

    return res.json({
      ok: true,
      importadas: resultado.importadas,
      total: lidas.length,
      duplicadas: lidas.length - resultado.importadas,
      removidas: resultado.removidas,
      meses_afetados: meses.sort(),
      banco_id: bancoId,
      banco_nome: bancoNome,
      banco_titular: bancoTitular,
      banco_criado: bancoCriado
    });
  }

  const importadas = db.transaction(() => {
    let count = 0;
    for (const tx of lidas) {
      const info = insertTx.run(
        tx.descricao.slice(0, 200),
        tx.tipo,
        tx.categoria || 'Outros',
        tx.valor,
        tx.data,
        bancoId,
        tx.idExterno,
        req.uid
      );
      if (info.changes > 0) count++;
    }
    return count;
  })();

  res.json({
    ok: true,
    importadas,
    total: lidas.length,
    duplicadas: lidas.length - importadas,
    banco_id: bancoId,
    banco_nome: bancoNome,
    banco_titular: bancoTitular,
    banco_criado: bancoCriado
  });
});

module.exports = router;
