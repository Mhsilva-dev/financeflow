// src/utils/datas.js — "Hoje" e "mês atual" no fuso de Brasília
// new Date().toISOString() é UTC: depois das 21h (horário de Brasília) ele já
// devolve o dia seguinte — e no último dia do mês, o mês seguinte.
const FUSO = 'America/Sao_Paulo';

function hojeLocal() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function mesLocal() {
  return hojeLocal().slice(0, 7);
}

module.exports = { FUSO, hojeLocal, mesLocal };
