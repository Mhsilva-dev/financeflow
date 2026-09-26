// ── INSTALAÇÃO DO APP (PWA) ──────────────────────────────────
// Usado pelo app (index.html) e pela página de apresentação (landing.html).
// Todo elemento com a classe "js-instalar" vira um botão de instalar:
//  - Chrome/Edge (Android e computador): abre a janela de instalação do navegador;
//  - iPhone/iPad, navegador dentro do WhatsApp/Instagram ou sem suporte: mostra
//    o passo a passo certo para aquele aparelho.
// Os botões somem quando o app já está aberto instalado.

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

let promptInstalacao = null;

const ua = navigator.userAgent || '';
const ehIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ehAndroid = /Android/i.test(ua);
const ehCelular = ehIOS || ehAndroid || /Mobi/i.test(ua);
const navegadorInterno = /FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)|GSA\//i.test(ua);
const ehSafariIOS = ehIOS && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua) && !navegadorInterno;

function appJaInstalado() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// Mostra os botões quando faz sentido: sempre no celular (há instruções),
// no computador só quando o navegador oferece a instalação.
function atualizarBotoesInstalar() {
  const mostrar = !appJaInstalado() && (ehCelular || !!promptInstalacao);
  document.querySelectorAll('.js-instalar').forEach(el => { el.hidden = !mostrar; });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  promptInstalacao = e;
  atualizarBotoesInstalar();
});

window.addEventListener('appinstalled', () => {
  promptInstalacao = null;
  fecharAjudaInstalar();
  atualizarBotoesInstalar();
  if (typeof toast === 'function') toast('App instalado! Procure o FinanceFlow na tela inicial.');
});

document.addEventListener('DOMContentLoaded', atualizarBotoesInstalar);

async function instalarApp() {
  if (promptInstalacao) {
    promptInstalacao.prompt();
    await promptInstalacao.userChoice.catch(() => {});
    promptInstalacao = null;
    atualizarBotoesInstalar();
    return;
  }
  abrirAjudaInstalar();
}

// Passo a passo conforme o aparelho/navegador
function passosInstalar() {
  if (navegadorInterno) {
    return {
      titulo: 'Abra no navegador para instalar',
      texto: 'Você abriu o link por dentro de outro app (WhatsApp, Instagram…), que não permite instalar.',
      passos: [
        'Toque nos <b>três pontinhos</b> (⋮ ou ⋯) no canto da tela.',
        ehIOS ? 'Escolha <b>Abrir no Safari</b>.' : 'Escolha <b>Abrir no Chrome</b> (ou "Abrir no navegador").',
        'Na página que abrir, toque de novo em <b>Instalar app</b>.'
      ]
    };
  }
  if (ehIOS && !ehSafariIOS) {
    return {
      titulo: 'No iPhone, instale pelo Safari',
      texto: 'O iPhone só permite instalar apps de sites pelo Safari.',
      passos: [
        `Copie o endereço <b>${location.host}</b>.`,
        'Abra o <b>Safari</b> e cole o endereço.',
        'Toque em <b>Compartilhar</b> (quadrado com seta para cima) e depois em <b>Adicionar à Tela de Início</b>.'
      ]
    };
  }
  if (ehIOS) {
    return {
      titulo: 'Instalar no iPhone',
      texto: 'Leva 10 segundos:',
      passos: [
        'Toque no botão <b>Compartilhar</b> <span class="inst-ico">(quadrado com seta para cima)</span> na barra do Safari.',
        'Role a lista e toque em <b>Adicionar à Tela de Início</b>.',
        'Toque em <b>Adicionar</b>. O FinanceFlow aparece na tela inicial.'
      ]
    };
  }
  if (ehAndroid) {
    return {
      titulo: 'Instalar no Android',
      texto: 'Pelo menu do Chrome:',
      passos: [
        'Toque nos <b>três pontinhos (⋮)</b> no canto superior direito.',
        'Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.',
        'Confirme em <b>Instalar</b>. Se a opção não aparecer, abra o site no <b>Google Chrome</b>.'
      ]
    };
  }
  return {
    titulo: 'Instalar no computador',
    texto: 'No Chrome ou no Edge:',
    passos: [
      'Clique no ícone de <b>instalar</b> (monitor com seta) no fim da barra de endereço,',
      'ou abra o menu <b>⋮</b> › <b>Transmitir, salvar e compartilhar</b> › <b>Instalar página como app</b>.',
      'Confirme em <b>Instalar</b>.'
    ]
  };
}

function abrirAjudaInstalar() {
  const info = passosInstalar();
  let modal = document.getElementById('modal-instalar');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-instalar';
    modal.className = 'modal-overlay';
    modal.addEventListener('click', e => { if (e.target === modal) fecharAjudaInstalar(); });
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal inst-modal" role="dialog" aria-modal="true" aria-labelledby="inst-titulo">
      <div class="modal-title">
        <span id="inst-titulo">${info.titulo}</span>
        <button type="button" class="inst-fechar" onclick="fecharAjudaInstalar()" aria-label="Fechar">✕</button>
      </div>
      <div class="inst-app">
        <img src="/icons/ff-icon-192.png" alt="" width="52" height="52">
        <div><strong>FinanceFlow</strong><small>Abre em tela cheia, como um app</small></div>
      </div>
      <p class="inst-texto">${info.texto}</p>
      <ol class="inst-passos">${info.passos.map(p => `<li><span>${p}</span></li>`).join('')}</ol>
      <button type="button" class="btn btn-primary inst-ok" onclick="fecharAjudaInstalar()">Entendi</button>
    </div>`;
  modal.classList.add('open');
}

function fecharAjudaInstalar() {
  document.getElementById('modal-instalar')?.classList.remove('open');
}
