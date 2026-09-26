// ── IMPORTAÇÃO DE ARQUIVOS ────────────────────────────────────
// Duas rotas de upload que usam o mesmo endpoint no backend
// (/api/transacoes/importar), mas com comportamentos diferentes:
//   1) importarPlanilha() — planilha solta (sem vínculo a banco),
//      pode conter vários meses; para cada mês encontrado, SUBSTITUI
//      as transações importadas anteriormente daquele mês.
//   2) importarExtrato() — extrato de um banco específico (OFX/CSV/
//      PDF/Excel); detecta duplicadas em vez de substituir, e pode
//      criar o banco automaticamente se não existir ainda.

// ── IMPORTAR PLANILHA DE GASTOS (multi-mês, substitui por mês) ───────────────
async function importarPlanilha() {
  const input = document.getElementById('planilha-arquivo');
  const btn = document.getElementById('btn-importar-planilha');
  const status = document.getElementById('planilha-status');
  const mesWrap = document.getElementById('planilha-mes-wrap');
  const mesInput = document.getElementById('planilha-mes-referencia');
  if (!input.files.length) return toast('Escolha um arquivo OFX, CSV ou Excel primeiro', 'error');

  const formData = new FormData();
  formData.append('arquivo', input.files[0]);
  formData.append('modo', 'substituir');
  if (mesInput.value) formData.append('mesReferencia', mesInput.value);

  btn.disabled = true;
  btn.textContent = 'Importando...';
  status.style.display = 'block';
  status.textContent = 'Lendo planilha...';

  try {
    const r = await fetch('/api/transacoes/importar', { method: 'POST', body: formData });
    const data = await r.json();
    if (!data.ok) {
      if (data.precisaMesReferencia) {
        mesWrap.style.display = 'flex';
        mesInput.focus();
      }
      toast(data.erro || 'Erro ao importar', 'error');
      return;
    }

    const meses = (data.meses_afetados || []).join(', ');
    toast(`${data.importadas} lançamentos importados em ${data.meses_afetados?.length || 0} mês(es)!`);
    status.textContent = `Meses substituídos: ${meses}. ${data.removidas} lançamentos antigos removidos, ${data.importadas} novos inseridos.`;
    input.value = '';
    mesWrap.style.display = 'none';
    mesInput.value = '';
    loadTransacoes();
    loadDashboard();
  } catch (err) {
    toast('Erro ao enviar arquivo: ' + (err?.message || 'tente novamente'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Importar e Substituir os Meses';
  }
}

// ── BANCOS ──────────────────────────────────────────────────
async function importarExtrato() {
  const bancoSel = document.getElementById('extrato-banco');
  const titularSel = document.getElementById('extrato-titular');
  const input = document.getElementById('extrato-arquivo');
  const btn = document.getElementById('btn-importar-extrato');
  const status = document.getElementById('extrato-status');
  if (!input.files.length) return toast('Escolha um arquivo OFX, CSV, PDF ou Excel primeiro', 'error');

  const formData = new FormData();
  formData.append('arquivo', input.files[0]);
  if (bancoSel.value) formData.append('bancoId', bancoSel.value);
  formData.append('titular', titularSel.value);

  btn.disabled = true;
  btn.textContent = 'Importando...';
  status.style.display = 'block';
  status.textContent = 'Lendo arquivo...';

  try {
    const r = await fetch('/api/transacoes/importar', { method: 'POST', body: formData });
    const data = await r.json();
    if (!data.ok) { toast(data.erro || 'Erro ao importar', 'error'); return; }

    const bancoMsg = data.banco_nome
      ? (data.banco_criado
          ? ` — banco "${data.banco_nome}" (${data.banco_titular}) criado automaticamente`
          : ` — banco: ${data.banco_nome}${data.banco_titular ? ' (' + data.banco_titular + ')' : ''}`)
      : '';
    toast(`${data.importadas} transações importadas! (${data.duplicadas} já existiam)${bancoMsg}`);
    status.textContent = `${data.importadas} novas de ${data.total} encontradas no arquivo.${bancoMsg}`;
    input.value = '';
    bancoSel.value = '';
    await loadBancos();
    await carregarSelectsBancos();
    showTab('dashboard');
  } catch (err) {
    toast('Erro ao enviar arquivo: ' + (err?.message || 'tente novamente'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Importar';
  }
}

