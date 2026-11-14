'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../js/dashboard-report-core');
const O = '00000000-0000-4000-8000-000000000001';
const M = '53f8fdfc-0595-4864-af49-5090bf3177db';
const contract = (categoria, cluster = 'Consumer', extra = {}) => ({
  operatore_id: O, categoria_snapshot: categoria, cluster_cliente: cluster,
  stato_inserimento: 'inserimento', codice_rivenditore: core.LEGNAGO, ...extra
});
const repeat = (n, categoria, cluster, extra) => Array.from({length:n}, () => contract(categoria, cluster, extra));
const complete = () => [...repeat(9, 'Fisso'), contract('Fisso', 'Business'),
  ...repeat(10, 'Energia'), ...repeat(10, 'Mobile', 'Business')];
const source = fs.readFileSync(path.join(__dirname, '../moduli/dashboard_pezzi.html'), 'utf8');
const script = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(m => m[1]).find(s => s.includes('const sb')).split('(function init()')[0];
function render({contracts = complete(), metrics, goals, month = 11, year = 2026, operators = [{id:O,nome:'Operatore di prova'}]} = {}) {
  const nodes = new Map();
  const document = {getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, {innerHTML:'',textContent:'',querySelectorAll:()=>[]});
    return nodes.get(id);
  }};
  const safe = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/mirox-safe.js'), 'utf8'), {window:safe});
  const context = vm.createContext({db:{},document,MiroxDashboardReport:core,MiroxSafe:safe.MiroxSafe});
  vm.runInContext(script, context);
  Object.assign(vm.runInContext('DPState', context), {anno:year,mese:month,contrattiMese:contracts,
    metricheGara:metrics || [], obiettivi:goals || [], operatoriInGara:operators,resolveOperatore:id=>id});
  vm.runInContext('renderGare()', context);
  return nodes.get('tabContentGare').innerHTML;
}
module.exports = {O,M,contract,repeat,complete,render,source};
