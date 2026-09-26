// src/push.js — Envio de notificações push (Web Push API) para o alerta de limite de gasto
const webpush = require('web-push');
const { getDb } = require('./db');

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn('[Push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas — notificações push ficarão indisponíveis');
}

// Manda a notificação para todos os dispositivos inscritos de um usuário.
// Inscrições mortas (410/404 — usuário desinstalou ou revogou permissão) são limpas na hora.
async function enviarPush(uid, titulo, corpo, dados = {}) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;

  const db   = getDb();
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE usuario_id = ?').all(uid);
  if (!subs.length) return;

  const payload = JSON.stringify({ title: titulo, body: corpo, ...dados });
  const remover = db.prepare('DELETE FROM push_subscriptions WHERE id = ?');

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        remover.run(sub.id);
      } else {
        console.error('[Push] Erro ao enviar:', err.message);
      }
    }
  }));
}

module.exports = { enviarPush };
