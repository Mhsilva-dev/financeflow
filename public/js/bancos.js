// ── BANCOS / CONTAS ────────────────────────────────────────────
// CRUD das contas bancárias (agrupadas por titular na tela) e o modal
// de "ver detalhes" que mostra o extrato de transações de um banco.
// BANK_COLORS só serve para sugerir automaticamente a cor do banco
// mais conhecido (Nubank, Itaú, etc.) enquanto o usuário digita o nome.
const BANK_COLORS = {
  nubank: '#8a05be', itau: '#ec7000', 'itaú': '#ec7000', bradesco: '#cc092f',
  'banco do brasil': '#f7dc0f', bb: '#f7dc0f', santander: '#ec0000',
  inter: '#ff7a00', c6: '#000000', caixa: '#0070ad', xp: '#000000', btg: '#001f3f'
};
function sugerirCorBanco(nomeInput, corInput) {
  const key = nomeInput.value.trim().toLowerCase();
  const match = Object.keys(BANK_COLORS).find(k => key.includes(k));
  if (match) corInput.value = BANK_COLORS[match];
}

let _bancoEditId = null;

async function carregarSelectsBancos() {
  const r = await api('GET', '/api/bancos');
  if (!r.ok) return;
  const opcoes = r.data.map(b => `<option value="${b.id}">${esc(b.nome)}${b.titular ? ' — ' + esc(b.titular) : ''}</option>`).join('');

  const selTransacao = document.getElementById('t-banco');
  if (selTransacao) { const atual = selTransacao.value; selTransacao.innerHTML = '<option value="">Nenhum</option>' + opcoes; selTransacao.value = atual; }

  const selExtrato = document.getElementById('extrato-banco');
  if (selExtrato) { const atual = selExtrato.value; selExtrato.innerHTML = '<option value="">Detectar banco automaticamente</option>' + opcoes; selExtrato.value = atual; }

  const selInv = document.getElementById('inv-banco');
  if (selInv) { const atual = selInv.value; selInv.innerHTML = '<option value="">Nenhum</option>' + opcoes; selInv.value = atual; }
}

function bancoCard(b) {
  const saldoCor = parseFloat(b.saldo) >= 0 ? 'var(--green)' : 'var(--red)';
  return `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:20px;border-top:4px solid ${b.cor||'#3b82f6'}">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
        <div>
          <div style="font-weight:700;font-size:16px">${esc(b.nome)}</div>
          <div style="font-size:12px;color:var(--muted)">
            ${b.agencia ? `Ag: ${esc(b.agencia)} · ` : ''}${b.conta ? `Cc: ${esc(b.conta)}` : ''}
            ${b.ultima_sync ? `<br>Sincronizado: ${fmtDate(b.ultima_sync.slice(0,10))}` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="editarBanco(${b.id})" title="Editar">✎</button>
          <button class="btn btn-red btn-sm" onclick="delBanco(${b.id})" title="Excluir">✕</button>
        </div>
      </div>
      <div style="font-size:22px;font-weight:700;color:${saldoCor};margin-bottom:8px">${fmt(b.saldo)}</div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:11px;color:var(--muted)">${b.total_transacoes||0} transaç${b.total_transacoes===1?'ão':'ões'}</span>
        <button class="btn btn-primary btn-sm" onclick="abrirDetalheBanco(${b.id})">Ver detalhes</button>
      </div>
    </div>`;
}

async function loadBancos() {
  const r = await api('GET', '/api/bancos');
  const el = document.getElementById('b-grupos');
  if (!r.ok || !r.data.length) { el.innerHTML = '<div class="empty">Nenhuma conta cadastrada. Importe um extrato ou adicione manualmente.</div>'; return; }

  const grupos = {};
  r.data.forEach(b => { const t = b.titular || 'Você'; (grupos[t] = grupos[t] || []).push(b); });

  el.innerHTML = Object.keys(grupos).sort().map(titular => {
    const bancos = grupos[titular];
    const subtotal = bancos.reduce((s, b) => s + parseFloat(b.saldo || 0), 0);
    return `
      <div class="bank-group-header">
        <span class="bank-group-title">${esc(titular)}</span>
        <span class="bank-group-subtotal" style="color:${subtotal>=0?'var(--green)':'var(--red)'}">${fmt(subtotal)}</span>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:16px; margin-bottom:8px;">
        ${bancos.map(bancoCard).join('')}
      </div>`;
  }).join('');

  carregarSelectsBancos();
}

function limparFormBanco() {
  ['b-nome','b-agencia','b-conta','b-saldo'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('b-cor').value = '#3b82f6';
  document.getElementById('b-titular').value = 'Você';
}

async function salvarBanco() {
  const nome = document.getElementById('b-nome').value.trim();
  if (!nome) return toast('Nome do banco obrigatório', 'error');
  const payload = {
    nome, agencia: document.getElementById('b-agencia').value,
    conta: document.getElementById('b-conta').value,
    saldo: parseFloat(document.getElementById('b-saldo').value)||0,
    cor: document.getElementById('b-cor').value,
    titular: document.getElementById('b-titular').value.trim() || 'Você'
  };
  const r = _bancoEditId
    ? await api('PATCH', `/api/bancos/${_bancoEditId}`, payload)
    : await api('POST', '/api/bancos', payload);

  if (r.ok) {
    toast(_bancoEditId ? 'Conta atualizada!' : 'Conta adicionada!');
    cancelarEdicaoBanco();
    loadBancos();
  } else toast(r.erro || 'Erro', 'error');
}

async function editarBanco(id) {
  const r = await api('GET', `/api/bancos/${id}`);
  if (!r.ok) return toast(r.erro || 'Erro ao carregar banco', 'error');
  const b = r.data;
  document.getElementById('b-nome').value = b.nome;
  document.getElementById('b-agencia').value = b.agencia || '';
  document.getElementById('b-conta').value = b.conta || '';
  document.getElementById('b-saldo').value = b.saldo;
  document.getElementById('b-cor').value = b.cor || '#3b82f6';
  document.getElementById('b-titular').value = b.titular || 'Você';
  _bancoEditId = id;
  document.getElementById('b-form-titulo').textContent = 'Editar Conta';
  document.getElementById('b-btn-salvar').textContent = 'Salvar Alterações';
  document.getElementById('b-btn-cancelar').style.display = 'inline-flex';
  document.getElementById('form-transacao')?.scrollIntoView?.({ behavior: 'smooth' });
}

function cancelarEdicaoBanco() {
  _bancoEditId = null;
  limparFormBanco();
  document.getElementById('b-form-titulo').textContent = 'Adicionar Conta';
  document.getElementById('b-btn-salvar').textContent = 'Adicionar';
  document.getElementById('b-btn-cancelar').style.display = 'none';
}

async function delBanco(id) {
  if (!confirm('Excluir conta?')) return;
  const r = await api('DELETE', '/api/bancos/' + id);
  if (r.ok) { toast('Excluída!'); loadBancos(); }
  else toast(r.erro || 'Erro ao excluir', 'error');
}

// ── VISUALIZAR BANCO (extrato) ───────────────────────────────
let _bancoDetalheId = null;

async function abrirDetalheBanco(id) {
  _bancoDetalheId = id;
  const r = await api('GET', `/api/bancos/${id}`);
  if (!r.ok) return toast(r.erro || 'Erro ao carregar banco', 'error');
  const b = r.data;

  document.getElementById('bd-titulo').textContent = b.nome;
  document.getElementById('bd-header').innerHTML = `
    <div style="height:4px;border-radius:4px;background:${b.cor||'#3b82f6'};margin-bottom:12px"></div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--muted)">
      <span>${b.titular || 'Você'}</span>
      ${b.agencia ? `<span>Agência: ${esc(b.agencia)}</span>` : ''}
      ${b.conta ? `<span>Conta: ${esc(b.conta)}</span>` : ''}
    </div>`;

  document.getElementById('bd-busca').value = '';
  document.getElementById('modal-banco-detalhe').classList.add('open');
  loadDetalheBanco();
}

async function loadDetalheBanco() {
  if (!_bancoDetalheId) return;
  const busca = document.getElementById('bd-busca').value;
  const r = await api('GET', `/api/transacoes?banco_id=${_bancoDetalheId}&limit=500${busca ? '&busca=' + encodeURIComponent(busca) : ''}`);
  const tbody = document.getElementById('bd-list');
  if (!r.ok) { tbody.innerHTML = ''; return; }

  const entradas = r.data.filter(t => t.tipo === 'entrada').reduce((s,t) => s + t.valor, 0);
  const saidas   = r.data.filter(t => t.tipo === 'saida').reduce((s,t) => s + t.valor, 0);
  document.getElementById('bd-saldo').textContent    = fmt(entradas - saidas);
  document.getElementById('bd-entradas').textContent = fmt(entradas);
  document.getElementById('bd-saidas').textContent   = fmt(saidas);
  document.getElementById('bd-total').textContent     = r.data.length;

  if (!r.data.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty">Nenhuma transação encontrada para este banco.</td></tr>'; return; }

  tbody.innerHTML = r.data.map(t => `
    <tr>
      <td>${fmtDate(t.data)}</td>
      <td>${esc(t.descricao)}</td>
      <td><span class="badge badge-blue">${esc(t.categoria)}</span></td>
      <td><span class="badge ${t.tipo==='entrada'?'badge-green':'badge-red'}">${t.tipo==='entrada'?'Entrada':'Saída'}</span></td>
      <td style="color:${t.tipo==='entrada'?'var(--green)':'var(--red)'}">${t.tipo==='entrada'?'+':'-'} ${fmt(t.valor)}</td>
      <td>${statusInfo(t).label}</td>
    </tr>`).join('');
}

function fecharDetalheBanco() {
  document.getElementById('modal-banco-detalhe').classList.remove('open');
  _bancoDetalheId = null;
}

