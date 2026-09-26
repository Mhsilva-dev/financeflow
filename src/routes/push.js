// src/routes/push.js — Inscrição de dispositivos para notificações push
const express = require('express');
const router  = express.Router();
const { getDb } = require('../db');
const { exigirLogin } = require('../middleware/auth');

// ── GET /vapid-public-key — Chave pública para o navegador criar a inscrição ──
router.get('/vapid-public-key', (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(503).json({ ok: false, erro: 'Notificações push não configuradas no servidor' });
  }
  res.json({ ok: true, publicKey: process.env.VAPID_PUBLIC_KEY });
});

// ── POST /subscribe — Salva (ou atualiza) a inscrição de um dispositivo ──────
// Endpoints válidos são sempre HTTPS de um serviço de push dos navegadores.
// Sem essa checagem, um usuário poderia cadastrar um endereço interno e o
// servidor faria requisições para ele ao mandar notificações.
const HOSTS_PUSH = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/, /^web\.push\.apple\.com$/];

function endpointValido(endpoint) {
  try {
    const u = new URL(String(endpoint));
    return u.protocol === 'https:' && !u.port && HOSTS_PUSH.some(r => r.test(u.hostname));
  } catch (_) { return false; }
}

router.post('/subscribe', exigirLogin, (req, res) => {
  const { endpoint, keys } = req.body;

  if (!endpointValido(endpoint) || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string'
      || keys.p256dh.length > 200 || keys.auth.length > 100) {
    return res.status(400).json({ ok: false, erro: 'Inscrição inválida' });
  }

  const db = getDb();
  db.prepare(`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, usuario_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, usuario_id = excluded.usuario_id
  `).run(endpoint, keys.p256dh, keys.auth, req.uid);

  res.json({ ok: true });
});

// ── DELETE /subscribe — Remove a inscrição (usuário desativou notificações) ──
router.delete('/subscribe', exigirLogin, (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ ok: false, erro: 'endpoint obrigatório' });
  getDb().prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND usuario_id = ?').run(endpoint, req.uid);
  res.json({ ok: true });
});

module.exports = router;
