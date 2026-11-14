/* Integración tributaria: sincronización real del RCV (RUT + Clave Tributaria) e importación del archivo oficial RCV (CSV / Excel). */
(function () {
  var IN = 'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-950';
  function e(x) { return (typeof esc === 'function') ? esc(x) : String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clp(n) { return (typeof formatCLP === 'function') ? formatCLP(n) : '$' + Math.round(n || 0).toLocaleString('es-CL'); }
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t); }

  function statusBox() {
    var b = document.getElementById('sii-sync-status');
    if (!b) {
      b = document.createElement('div'); b.id = 'sii-sync-status';
      var sec = document.getElementById('view-sii');
      var anchor = document.getElementById('commdocs-section');
      sec.insertBefore(b, anchor || sec.children[1] || null);
    }
    return b;
  }
  function show(kind, html) {
    var c = { err: 'border-rose-200 bg-rose-50 text-rose-700', ok: 'border-emerald-200 bg-emerald-50 text-emerald-700', info: 'border-blue-200 bg-blue-50 text-blue-700' }[kind];
    var b = statusBox(); b.className = 'rounded-xl border p-3 text-xs ' + c; b.innerHTML = html;
  }
  async function readJson(r) { var j = null; try { j = await r.json(); } catch (x) { } if (!r.ok) throw new Error((j && (j.detail || j.message)) || ('Error HTTP ' + r.status)); return j; }

  window.siiPeriodMonthQuery = function () {
    if (typeof getGlobalPeriodQuery === 'function') return getGlobalPeriodQuery('month');
    var el = document.getElementById('sii-period') || document.getElementById('global-period-selector');
    return el && el.value ? '?month=' + el.value : '';
  };
  window.siiPeriodQuery = function () {
    if (typeof getGlobalPeriodQuery === 'function') return getGlobalPeriodQuery('both');
    var el = document.getElementById('sii-period') || document.getElementById('global-period-selector');
    if (!el || !el.value) return '';
    var p = el.value.split('-'); return '?year=' + parseInt(p[0], 10) + '&month=' + parseInt(p[1], 10);
  };
  window.siiPeriodChanged = async function () {
    var el = document.getElementById('sii-period');
    if (el && typeof onGlobalPeriodChange === 'function') {
      await onGlobalPeriodChange(el.value);
    } else {
      if (typeof renderSII === 'function') await renderSII();
      if (typeof renderDashboard === 'function') { try { await renderDashboard(); } catch (x) { } }
    }
  };
  function setPeriod(per) { // 'YYYYMM'
    if (per && per.length === 6) {
      var val = per.slice(0, 4) + '-' + per.slice(4);
      if (typeof onGlobalPeriodChange === 'function') onGlobalPeriodChange(val);
      else {
        var el = document.getElementById('sii-period'); if (el) el.value = val;
        var gel = document.getElementById('global-period-selector'); if (gel) gel.value = val;
      }
    }
  }

  window.siiSyncView = async function () {
    show('info', 'Conectando con el SII con el RUT y la Clave Tributaria guardados…');
    try {
      var r = await readJson(await fetch('/api/integrations/sii/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ months: 2 }) }));
      for (var i = 0; i < 600; i++) {
        await new Promise(function (res) { setTimeout(res, 1500); });
        var j = await readJson(await fetch('/api/integrations/job/' + r.job_id));
        var warn = j.errors && j.errors.length ? '<details class="mt-1" open><summary>' + j.errors.length + ' aviso(s) del SII</summary><div class="text-[11px] text-slate-700 mt-1">' + j.errors.map(e).join('<br>') + '</div></details>' : '';
        if (j.status === 'LISTO') { show('ok', '<svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> ' + e(j.message) + warn); toast(j.message); if (typeof renderSII === 'function') await renderSII(); if (typeof renderDashboard === 'function') { try { await renderDashboard(); } catch (x) { } } return; }
        if (j.status === 'ERROR') { show('err', '<b>No se pudo sincronizar con el SII:</b> ' + e(j.message) + warn + '<div class="mt-1 text-slate-700">Revisa RUT / Clave Tributaria en <b>Configuración → Integraciones</b>, o use <b>Importar Archivo RCV</b> como respaldo.</div>'); toast(j.message, 'error'); return; }
        show('info', e(j.message) + (j.total ? ' (' + j.done + '/' + j.total + ')' : '') + warn);
      }
      show('err', 'La sincronización tardó demasiado. Intenta nuevamente o importa el archivo RCV.');
    } catch (err) {
      show('err', '<b>No se pudo sincronizar con el SII:</b> ' + e(err.message) + '<div class="mt-1 text-slate-700">Si el problema persiste, use <b>Importar Archivo RCV (CSV / Excel)</b>.</div>');
      toast(err.message, 'error');
    }
  };
  window.simulateRcvSync = window.siiSyncView; // compatibilidad: ya no existe sincronización simulada

  window.rcvImportOpen = function () {
    var now = new Date(), cur = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    pfModal('Importar Archivo RCV (SII)',
      '<div class="space-y-3 text-xs"><p class="text-slate-600">Suba el archivo descargado del portal del SII (Registro de Compras y Ventas) con <b>Descargar Detalles</b> (facturas con folio) o <b>Descargar Resumen</b> (solo totales). Formatos: CSV o Excel (.xlsx).</p>' +
      '<div><label class="text-slate-600">Archivo</label><input id="rcv-file" type="file" accept=".csv,.xlsx,.xlsm,.txt" class="' + IN + '"></div>' +
      '<div class="grid grid-cols-2 gap-3"><div><label class="text-slate-600">Tipo de registro</label><select id="rcv-op" class="' + IN + '"><option value="">Detectar automáticamente</option><option value="COMPRA">Compras</option><option value="VENTA">Ventas</option></select></div>' +
      '<div><label class="text-slate-600">Período (solo para Resumen)</label><input id="rcv-per" type="month" value="' + cur + '" class="' + IN + '"></div></div>' +
      '<div id="rcv-msg" class="hidden"></div>' +
      '<div class="flex justify-end gap-2"><button onclick="closePfModal()" class="px-3 py-2 rounded-lg bg-slate-100 text-slate-900">Cerrar</button><button id="rcv-go" onclick="rcvImportRun()" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">Importar</button></div></div>');
  };

  window.rcvImportRun = async function () {
    var f = document.getElementById('rcv-file').files[0], msg = document.getElementById('rcv-msg'), btn = document.getElementById('rcv-go');
    msg.classList.remove('hidden');
    if (!f) { msg.className = 'text-rose-700'; msg.textContent = 'Selecciona un archivo.'; return; }
    var fd = new FormData(); fd.append('file', f);
    var op = document.getElementById('rcv-op').value; if (op) fd.append('operation', op);
    fd.append('period', document.getElementById('rcv-per').value);
    btn.disabled = true; msg.className = 'text-blue-700'; msg.textContent = 'Procesando archivo…';
    try {
      var j = await readJson(await fetch('/api/integrations/rcv/import', { method: 'POST', body: fd }));
      closePfModal(); setPeriod(j.period);
      show('ok', '<svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> ' + e(j.message) + '<div class="mt-1">Documentos: <b>' + j.documents + '</b> · Neto <b>' + clp(j.net) + '</b> · IVA <b>' + clp(j.iva) + '</b> · Total <b>' + clp(j.total) + '</b></div>');
      toast(j.message);
      if (typeof renderSII === 'function') await renderSII();
      if (typeof renderDashboard === 'function') { try { await renderDashboard(); } catch (x) { } }
    } catch (err) { msg.className = 'text-rose-700'; msg.textContent = err.message; btn.disabled = false; }
  };

  // Sin selector de período en el HTML original: se agrega junto a los botones
  function ensureToolbar() {
    if (document.getElementById('sii-period')) return;
    var btn = document.getElementById('sii-import-btn'); if (!btn) return;
    var d = new Date(); var inp = document.createElement('input');
    inp.type = 'month'; inp.id = 'sii-period'; inp.title = 'Período para la proyección F29';
    inp.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    inp.className = 'bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-900';
    inp.onchange = window.siiPeriodChanged;
    btn.parentNode.insertBefore(inp, btn.parentNode.firstChild);
  }
  ensureToolbar();
})();
