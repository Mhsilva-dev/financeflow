// src/utils/email.js — Envio de e-mail (SMTP) e modelo do e-mail de redefinição de senha
//
// Configuração no .env:
//   SMTP_HOST, SMTP_PORT (465 = SSL, 587 = STARTTLS), SMTP_USER, SMTP_PASS
//   MAIL_FROM  ex: "FinanceFlow <nao-responda@seudominio.com>"
//   APP_URL    ex: https://seu-dominio.com.br  (base dos links no e-mail)
// Sem SMTP configurado, o e-mail não sai: o link é escrito no log do servidor
// (útil em teste) e emailConfigurado() devolve false.
const nodemailer = require('nodemailer');

let _transporte;

function emailConfigurado() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function transporte() {
  if (_transporte) return _transporte;
  const porta = parseInt(process.env.SMTP_PORT, 10) || 587;
  _transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: porta,
    secure: porta === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  return _transporte;
}

async function enviarEmail({ para, assunto, html, texto }) {
  if (!emailConfigurado()) {
    console.warn(`[Email] SMTP não configurado — e-mail para ${para} não enviado. Conteúdo:\n${texto}`);
    return false;
  }
  await transporte().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: para,
    subject: assunto,
    text: texto,
    html
  });
  return true;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// E-mail de redefinição — HTML simples em tabela (compatível com Gmail/Outlook) no visual do app
function emailRedefinicao({ nome, link, validadeMin }) {
  const primeiroNome = String(nome || '').split(' ')[0] || 'olá';
  const texto =
`Olá, ${primeiroNome}!

Recebemos um pedido para redefinir a senha da sua conta no FinanceFlow.
Para criar uma senha nova, abra o link abaixo (vale por ${validadeMin} minutos e só pode ser usado uma vez):

${link}

Se não foi você, ignore este e-mail — sua senha continua a mesma.

— FinanceFlow`;

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Redefinir senha</title></head>
<body style="margin:0;padding:0;background:#0E0F0D;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0E0F0D;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#151613;border:1px solid #2A2B27;border-radius:12px;font-family:'IBM Plex Sans',Segoe UI,Helvetica,Arial,sans-serif;color:#ECEAE3;">
      <tr><td style="padding:28px 32px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="width:28px;height:28px;border:2px solid #D9A441;border-radius:7px;text-align:center;font-weight:700;color:#D9A441;font-size:15px;line-height:24px;">F</td>
          <td style="padding-left:10px;font-size:16px;font-weight:600;color:#ECEAE3;">FinanceFlow</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:20px 32px 0;">
        <h1 style="margin:0 0 12px;font-size:22px;font-weight:600;color:#ECEAE3;">Redefinir sua senha</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#CFCCC4;">Olá, ${esc(primeiroNome)}! Recebemos um pedido para criar uma senha nova para a sua conta. Toque no botão abaixo para continuar.</p>
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#D9A441;">
          <a href="${esc(link)}" style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:600;color:#1A1406;text-decoration:none;">Criar senha nova</a>
        </td></tr></table>
        <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#A29F95;">O link vale por ${validadeMin} minutos e só pode ser usado uma vez. Se o botão não abrir, copie e cole no navegador:</p>
        <p style="margin:6px 0 0;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${esc(link)}" style="color:#F0C878;">${esc(link)}</a></p>
      </td></tr>
      <tr><td style="padding:24px 32px 28px;">
        <p style="margin:0;padding-top:16px;border-top:1px solid #2A2B27;font-size:12px;line-height:1.6;color:#A29F95;">Se não foi você que pediu, ignore este e-mail — sua senha continua a mesma.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  return { assunto: 'Redefinir sua senha do FinanceFlow', texto, html };
}

module.exports = { enviarEmail, emailConfigurado, emailRedefinicao };
