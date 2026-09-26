// src/routes/admin.js — Painel administrativo: usuários cadastrados e quem está online
// Só a conta administradora acessa (exigirAdmin).
const express = require('express');
const router  = express.Router();
const { getDb } = require('../db');
const { exigirAdmin, ultimaAtividade } = require('../middleware/auth');

// Considera online quem tem o app aberto (WebSocket conectado)
// ou fez alguma requisição nos últimos 5 minutos
const JANELA_ONLINE_MS = 5 * 60 * 1000;

router.use(exigirAdmin);

// ── GET /usuarios — Lista de usuários com status online e resumo de uso ──────
router.get('/usuarios', (req, res) => {
  const db = getDb();
  const conexoes = global.conexoesPorUsuario ? global.conexoesPorUsuario() : new Map();
  const agora = Date.now();

  const usuarios = db.prepare(`
    SELECT u.id, u.nome, u.usuario, u.email, u.papel, u.created_at, u.ultimo_acesso,
      (SELECT COUNT(*) FROM transacoes t WHERE t.usuario_id = u.id)   AS transacoes,
      (SELECT COUNT(*) FROM bancos b WHERE b.usuario_id = u.id)       AS bancos,
      (SELECT MAX(t.created_at) FROM transacoes t WHERE t.usuario_id = u.id) AS ultimo_lancamento
    FROM usuarios u
    ORDER BY u.created_at DESC
  `).all().map(u => {
    const ultimaReq  = ultimaAtividade.get(u.id) || null;
    const dispositivos = conexoes.get(u.id) || 0;
    return {
      ...u,
      dispositivos,
      online: dispositivos > 0 || (ultimaReq !== null && agora - ultimaReq < JANELA_ONLINE_MS),
      ultima_atividade: ultimaReq ? new Date(ultimaReq).toISOString() : null
    };
  });

  const diasAtras = d => {
    const x = new Date(); x.setDate(x.getDate() - d);
    return x.toISOString().slice(0, 10);
  };

  res.json({
    ok: true,
    resumo: {
      total:        usuarios.length,
      online:       usuarios.filter(u => u.online).length,
      novos_7d:     usuarios.filter(u => u.created_at >= diasAtras(7)).length,
      ativos_30d:   usuarios.filter(u => u.online || (u.ultimo_acesso && u.ultimo_acesso >= diasAtras(30))).length
    },
    usuarios
  });
});

module.exports = router;
