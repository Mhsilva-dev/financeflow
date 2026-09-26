// ── ASSISTENTE (IA) ──────────────────────────────────────────
// Chat com o assistente financeiro. O servidor deixa a IA consultar os dados
// do usuário (resumo de um mês, transações, contas a vencer...), então aqui só
// mandamos a pergunta, o mês que está na tela e o histórico da conversa —
// assim "qual meu saldo?" fala do mês selecionado e "e em outubro?" entende
// que é a mesma pergunta para outro mês.

let chatHistorico = [];   // [{ role: 'user'|'model', texto }]
let chatOcupado = false;

function nomeMesChat(deslocamento = 0) {
  const d = new Date(currentAno, currentMes - 1 + deslocamento, 1);
  return `${MESES_NOME[d.getMonth()].toLowerCase()}${d.getFullYear() !== new Date().getFullYear() ? ' de ' + d.getFullYear() : ''}`;
}

function atualizarContextoChat() {
  const rotulo = `${MESES_NOME[currentMes - 1]} de ${currentAno}`;
  document.getElementById('chat-mes-label').textContent = rotulo;
  const sugestoes = [
    `Qual é meu saldo de ${nomeMesChat()}?`,
    `Onde eu mais gastei em ${nomeMesChat()}?`,
    `Me dá uma estratégia para ${nomeMesChat(1)}`,
    `O que ainda falta pagar este mês?`,
    `Compare ${nomeMesChat()} com ${nomeMesChat(-1)}`,
    `Me dê dicas para economizar em ${nomeMesChat()}`
  ];
  document.getElementById('chat-sugestoes').innerHTML = sugestoes
    .map(t => `<button type="button" class="chat-chip" onclick="perguntar(this.textContent)">${esc(t)}</button>`).join('');
}

function abrirChat() {
  atualizarContextoChat();
  if (!chatHistorico.length && !document.getElementById('chat-box').children.length) {
    adicionarMsg('ai', `Olá${perfilAtual?.nome ? ', ' + perfilAtual.nome.split(' ')[0] : ''}! Pergunte sobre qualquer mês — saldo, gastos, contas a pagar — ou peça uma estratégia. Se você não disser o mês, eu considero o que está selecionado acima.`);
  }
  setTimeout(() => document.getElementById('chat-input').focus(), 50);
}

function limparChat() {
  chatHistorico = [];
  document.getElementById('chat-box').innerHTML = '';
  abrirChat();
}

// Markdown mínimo e seguro: escapa tudo e só então aplica negrito, itálico e listas
function renderMarkdown(texto) {
  const linhas = esc(texto).split('\n');
  let html = '', emLista = false;
  for (let l of linhas) {
    l = l.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
         .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<strong>$2</strong>')
         .replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, '$1<em>$2</em>')
         .replace(/^#{1,4}\s+(.*)$/, '<strong>$1</strong>');
    const item = l.match(/^\s*(?:[-•]|\d+\.)\s+(.*)$/);
    if (item) {
      if (!emLista) { html += '<ul>'; emLista = true; }
      html += `<li>${item[1]}</li>`;
    } else {
      if (emLista) { html += '</ul>'; emLista = false; }
      html += l.trim() ? `<p>${l}</p>` : '';
    }
  }
  return html + (emLista ? '</ul>' : '');
}

function adicionarMsg(tipo, texto, extraClasse = '') {
  const box = document.getElementById('chat-box');
  const el = document.createElement('div');
  el.className = `chat-msg ${tipo} ${extraClasse}`.trim();
  if (tipo === 'user') el.textContent = texto; else el.innerHTML = renderMarkdown(texto);
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

function perguntar(texto) {
  document.getElementById('chat-input').value = texto;
  sendChat();
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg || chatOcupado) return;
  chatOcupado = true;
  document.getElementById('chat-enviar').disabled = true;
  input.value = '';

  adicionarMsg('user', msg);
  const carregando = adicionarMsg('ai', 'Consultando seus dados...', 'loading');

  const r = await api('POST', '/api/ia/chat', { mensagem: msg, mes: mesStr(), historico: chatHistorico.slice(-12) });
  carregando.remove();

  const resposta = r.ok ? r.resposta : (r.erro || 'Não consegui responder agora. Tente de novo.');
  adicionarMsg('ai', resposta);
  if (r.ok && !r.sem_ia) chatHistorico.push({ role: 'user', texto: msg }, { role: 'model', texto: resposta });

  chatOcupado = false;
  document.getElementById('chat-enviar').disabled = false;
  input.focus();
}

// Atalho antigo (botão "Dicas") — agora passa pelo mesmo chat, focado no mês da tela
function loadDicas() {
  perguntar(`Me dê dicas para economizar em ${nomeMesChat()}`);
}
