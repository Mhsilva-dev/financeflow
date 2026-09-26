// ── BOAS-VINDAS: TOUR GUIADO + PRIMEIROS PASSOS ───────────────
// Quem acabou de criar a conta vê um tour que destaca cada parte do app
// (com "Pular" sempre à mão) e, no painel, uma lista de primeiros passos
// que se marca sozinha conforme a pessoa usa. Os dois ficam salvos na
// conta (tour_visto / checklist_oculto), então não reaparecem em outro
// aparelho. "Ver o tour de novo" fica em Minha conta e no menu Mais.

const ehTelaPequena = () => window.matchMedia('(max-width: 1024px)').matches;

// Cada passo: alvo (desktop / celular), título e texto. Sem alvo = cartão central.
function passosDoTour() {
  const nome = (perfilAtual?.nome || '').split(' ')[0];
  return [
    {
      titulo: nome ? `Que bom ter você aqui, ${nome}!` : 'Que bom ter você aqui!',
      texto: 'Em menos de um minuto você conhece o FinanceFlow e já sai sabendo organizar o seu mês. Vamos juntos?',
      botao: 'Começar o tour'
    },
    {
      alvo: '.month-switch',
      titulo: 'Tudo é organizado por mês',
      texto: 'Use as setas para ir e voltar entre os meses. O painel, as transações e o relatório sempre mostram o mês escolhido aqui.'
    },
    {
      alvo: '.kpis',
      titulo: 'Seu mês em quatro números',
      texto: 'Quanto entrou, quanto saiu e o que sobrou. O saldo anterior é o dinheiro que veio dos meses passados.'
    },
    {
      alvo: '.page-head-actions .btn-primary', alvoCelular: '.bottom-add',
      titulo: 'Lançar é rapidinho',
      texto: 'Toque aqui para registrar um gasto ou uma entrada. Você marca se já pagou ou se ainda vai pagar, e o painel se atualiza na hora.'
    },
    {
      alvo: '.sidebar nav button[onclick="showTab(\'bancos\')"]', alvoCelular: '#bottom-nav button:last-child',
      titulo: 'Traga o extrato do banco',
      texto: ehTelaPequena()
        ? 'Em Mais › Bancos você importa o extrato (OFX, CSV, Excel ou PDF) e as transações entram sozinhas, sem duplicar.'
        : 'Em Bancos você importa o extrato (OFX, CSV, Excel ou PDF) e as transações entram sozinhas, sem duplicar.'
    },
    {
      alvo: '#card-limite',
      titulo: 'Um limite para o mês',
      texto: 'Defina quanto quer gastar no máximo. Se passar, avisamos no seu celular — sem sustos no fim do mês.'
    },
    {
      alvo: '.sidebar nav button[onclick="showTab(\'ia\')"]', alvoCelular: '#bottom-nav button:last-child',
      titulo: 'Converse com a assistente',
      texto: 'Pergunte "quanto gastei com mercado em setembro?" ou peça uma estratégia para o próximo mês. Ela responde com os seus números.'
    },
    {
      alvo: '.sidebar .user-chip', alvoCelular: '.topbar-avatar',
      titulo: 'Do seu jeito',
      texto: 'Em Minha conta você troca para o tema claro, escolhe a cor, muda a senha e baixa todos os seus dados quando quiser.'
    },
    {
      titulo: 'Tudo pronto!',
      texto: 'O melhor primeiro passo é lançar uma transação ou importar o extrato do banco. No painel deixamos uma listinha para te guiar.',
      botao: 'Lançar minha primeira transação',
      botaoSecundario: 'Explorar sozinho',
      acao: () => novaTransacao()
    }
  ];
}

let tourPassos = [];
let tourIndice = 0;
let tourEl = null;

function iniciarTour() {
  if (currentTab !== 'dashboard') showTab('dashboard');
  closeMobileSidebar?.();
  document.getElementById('modal-config')?.classList.remove('open');
  tourPassos = passosDoTour();
  tourIndice = 0;
  if (!tourEl) {
    tourEl = document.createElement('div');
    tourEl.id = 'tour';
    tourEl.innerHTML = `
      <div class="tour-bloqueio"></div>
      <div class="tour-foco" aria-hidden="true"></div>
      <div class="tour-balao" role="dialog" aria-modal="true" aria-labelledby="tour-titulo" aria-describedby="tour-texto">
        <div class="tour-topo">
          <span class="tour-contador" id="tour-contador"></span>
          <button type="button" class="tour-pular" onclick="encerrarTour()">Pular tour</button>
        </div>
        <h3 id="tour-titulo"></h3>
        <p id="tour-texto"></p>
        <div class="tour-pontos" id="tour-pontos"></div>
        <div class="tour-acoes" id="tour-acoes"></div>
      </div>`;
    document.body.appendChild(tourEl);
    window.addEventListener('resize', () => tourEl.classList.contains('ativo') && posicionarTour());
    document.addEventListener('keydown', e => {
      if (!tourEl.classList.contains('ativo')) return;
      if (e.key === 'Escape') encerrarTour();
      if (e.key === 'ArrowRight') irPassoTour(1);
      if (e.key === 'ArrowLeft') irPassoTour(-1);
    });
  }
  tourEl.classList.add('ativo');
  document.body.classList.add('tour-aberto');
  mostrarPassoTour();
}

function alvoDoPasso(p) {
  const seletor = ehTelaPequena() && p.alvoCelular ? p.alvoCelular : p.alvo;
  if (!seletor) return null;
  const el = document.querySelector(seletor);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}

function mostrarPassoTour() {
  const p = tourPassos[tourIndice];
  // Passo com alvo que não existe nesta tela (ex: sem limite de gasto visível): pula
  if (p.alvo && !alvoDoPasso(p)) {
    tourPassos.splice(tourIndice, 1);
    return mostrarPassoTour();
  }
  const total = tourPassos.length;
  const ultimo = tourIndice === total - 1;
  const primeiro = tourIndice === 0;

  document.getElementById('tour-titulo').textContent = p.titulo;
  document.getElementById('tour-texto').textContent = p.texto;
  document.getElementById('tour-contador').textContent = primeiro || ultimo ? '' : `${tourIndice} de ${total - 2}`;
  document.getElementById('tour-pontos').innerHTML = tourPassos
    .map((_, i) => `<span class="${i === tourIndice ? 'ativo' : i < tourIndice ? 'feito' : ''}"></span>`).join('');
  document.querySelector('.tour-pular').hidden = ultimo;

  const acoes = document.getElementById('tour-acoes');
  if (ultimo) {
    acoes.innerHTML = `
      <button type="button" class="btn btn-ghost" onclick="encerrarTour()">${p.botaoSecundario}</button>
      <button type="button" class="btn btn-primary" onclick="encerrarTour(true)">${p.botao}</button>`;
  } else if (primeiro) {
    acoes.innerHTML = `
      <button type="button" class="btn btn-ghost" onclick="encerrarTour()">Agora não</button>
      <button type="button" class="btn btn-primary" onclick="irPassoTour(1)">${p.botao}</button>`;
  } else {
    acoes.innerHTML = `
      <button type="button" class="btn btn-ghost" onclick="irPassoTour(-1)">Voltar</button>
      <button type="button" class="btn btn-primary" onclick="irPassoTour(1)">Próximo</button>`;
  }

  const alvo = alvoDoPasso(p);
  // Barras fixas (lateral, topo, inferior) já estão na tela — só rola para o resto
  const fixo = alvo && alvo.closest('.sidebar, .topbar, .bottom-nav');
  if (alvo && !fixo) alvo.scrollIntoView({ block: 'center', behavior: 'smooth' });
  tourEl.classList.toggle('centro', !alvo);
  // Espera a rolagem terminar antes de medir
  setTimeout(posicionarTour, alvo && !fixo ? 350 : 0);
  setTimeout(() => acoes.querySelector('.btn-primary')?.focus(), 50);
}

function posicionarTour() {
  const p = tourPassos[tourIndice];
  const foco = tourEl.querySelector('.tour-foco');
  const balao = tourEl.querySelector('.tour-balao');
  const alvo = alvoDoPasso(p);

  if (!alvo) {
    foco.style.cssText = 'opacity:0';
    balao.style.cssText = '';
    return;
  }

  const r = alvo.getBoundingClientRect();
  const folga = 8;
  foco.style.cssText = `opacity:1; top:${r.top - folga}px; left:${r.left - folga}px; width:${r.width + folga * 2}px; height:${r.height + folga * 2}px;`;

  // Coloca o balão onde couber: abaixo, acima, à direita ou à esquerda do alvo
  const vw = window.innerWidth, vh = window.innerHeight, m = 16;
  const bw = Math.min(360, vw - m * 2);
  balao.style.width = bw + 'px';
  const bh = balao.offsetHeight;
  const cabe = {
    baixo: r.bottom + folga + m + bh < vh,
    cima: r.top - folga - m - bh > 0,
    direita: r.right + folga + m + bw < vw,
    esquerda: r.left - folga - m - bw > 0
  };
  const clampX = x => Math.max(m, Math.min(x, vw - bw - m));
  const clampY = y => Math.max(m, Math.min(y, vh - bh - m));
  let top, left;
  if (cabe.direita && r.left < 260) { left = r.right + folga + m; top = clampY(r.top + r.height / 2 - bh / 2); }
  else if (cabe.baixo) { top = r.bottom + folga + m; left = clampX(r.left + r.width / 2 - bw / 2); }
  else if (cabe.cima) { top = r.top - folga - m - bh; left = clampX(r.left + r.width / 2 - bw / 2); }
  else if (cabe.direita) { left = r.right + folga + m; top = clampY(r.top); }
  else if (cabe.esquerda) { left = r.left - folga - m - bw; top = clampY(r.top); }
  else { top = clampY(vh - bh - m); left = clampX((vw - bw) / 2); }
  balao.style.top = top + 'px';
  balao.style.left = left + 'px';
}

function irPassoTour(delta) {
  const novo = tourIndice + delta;
  if (novo < 0 || novo >= tourPassos.length) return;
  tourIndice = novo;
  mostrarPassoTour();
}

function encerrarTour(executarAcao) {
  const p = tourPassos[tourIndice];
  tourEl?.classList.remove('ativo', 'centro');
  document.body.classList.remove('tour-aberto');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (perfilAtual && !perfilAtual.tour_visto) {
    perfilAtual.tour_visto = 1;
    api('PUT', '/api/auth/onboarding', { tour_visto: 1 });
  }
  if (executarAcao && p?.acao) p.acao();
}

// ── PRIMEIROS PASSOS (card no painel) ─────────────────────────
const PASSOS_INICIAIS = [
  { id: 'banco', titulo: 'Cadastre seu banco', texto: 'Separe o dinheiro por conta e titular.', acao: "showTab('bancos')" },
  { id: 'transacao', titulo: 'Lance sua primeira transação', texto: 'Ou importe o extrato e deixe tudo entrar sozinho.', acao: 'novaTransacao()' },
  { id: 'limite', titulo: 'Defina um limite de gasto', texto: 'Avisamos quando o mês passar do combinado.', acao: 'focarLimiteGasto()' },
  { id: 'app', titulo: 'Instale o app no celular', texto: 'Abre em tela cheia, com avisos de vencimento.', acao: 'instalarApp()' }
];

async function carregarPrimeirosPassos() {
  const card = document.getElementById('primeiros-passos');
  if (!card) return;
  if (!perfilAtual || perfilAtual.checklist_oculto) { card.hidden = true; return; }

  const r = await api('GET', '/api/auth/primeiros-passos');
  if (!r.ok) { card.hidden = true; return; }
  const feito = { ...r, app: typeof appJaInstalado === 'function' && appJaInstalado() };
  const concluidos = PASSOS_INICIAIS.filter(p => feito[p.id]).length;

  if (concluidos === PASSOS_INICIAIS.length) {
    card.hidden = false;
    card.innerHTML = `
      <div class="pp-completo">
        <div class="welcome-mark"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg></div>
        <div><strong>Você completou os primeiros passos!</strong><span>Seu FinanceFlow está pronto. Agora é só acompanhar o mês.</span></div>
        <button type="button" class="btn btn-ghost btn-sm" onclick="ocultarPrimeirosPassos()">Fechar</button>
      </div>`;
    return;
  }

  card.hidden = false;
  card.innerHTML = `
    <div class="pp-cab">
      <div>
        <span class="section-title">Primeiros passos</span>
        <span class="pp-sub">${concluidos} de ${PASSOS_INICIAIS.length} concluídos</span>
      </div>
      <button type="button" class="link pp-ocultar" onclick="ocultarPrimeirosPassos()">Ocultar</button>
    </div>
    <div class="progress pp-barra"><div class="progress-bar" style="width:${concluidos / PASSOS_INICIAIS.length * 100}%;background:var(--accent)"></div></div>
    <div class="pp-lista">
      ${PASSOS_INICIAIS.map(p => `
        <button type="button" class="pp-item ${feito[p.id] ? 'feito' : ''}" onclick="${p.acao}" ${feito[p.id] ? 'disabled' : ''}>
          <span class="pp-check">${feito[p.id] ? '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>' : ''}</span>
          <span class="pp-txt"><strong>${p.titulo}</strong><small>${p.texto}</small></span>
        </button>`).join('')}
    </div>
    <button type="button" class="link pp-tour" onclick="iniciarTour()">Ver o tour de novo</button>`;
}

function ocultarPrimeirosPassos() {
  document.getElementById('primeiros-passos').hidden = true;
  if (perfilAtual) perfilAtual.checklist_oculto = 1;
  api('PUT', '/api/auth/onboarding', { checklist_oculto: 1 });
}

function focarLimiteGasto() {
  showTab('dashboard');
  const input = document.getElementById('lg-valor');
  input.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setTimeout(() => input.focus(), 300);
}
