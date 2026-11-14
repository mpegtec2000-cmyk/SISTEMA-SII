/* Seguimiento y control de cotizaciones: tablero Kanban, lista avanzada, ficha lateral con bitácora, alertas y KPIs. */
(function () {
  var pp = { view: localStorage.getItem('ppView') || 'kanban', data: null, f: { date_from: '', date_to: '', client: '', status: '', owner: '', min_amount: '', max_amount: '', q: '', kind: '' }, openId: null };
  window.pp = pp;
  var COLORS = { BORRADOR: 'border-slate-500', ENVIADA: 'border-blue-500', EN_NEGOCIACION: 'border-amber-500', ACEPTADA: 'border-emerald-500', RECHAZADA: 'border-rose-500', FACTURADA: 'border-violet-500' };
  var BADGE = { BORRADOR: 'bg-slate-600/40 text-slate-900', ENVIADA: 'bg-blue-50 text-blue-700', EN_NEGOCIACION: 'bg-amber-50 text-amber-700', ACEPTADA: 'bg-emerald-50 text-emerald-700', RECHAZADA: 'bg-rose-50 text-rose-700', FACTURADA: 'bg-violet-50 text-violet-700' };
  var LBL_PRIV = { BORRADOR: 'Borrador', ENVIADA: 'Enviada al cliente', EN_NEGOCIACION: 'En negociación', ACEPTADA: 'Aceptada', RECHAZADA: 'Rechazada', FACTURADA: 'Facturada' };
  var LBL_MP = { BORRADOR: 'Borrador', ENVIADA: 'Publicada', EN_NEGOCIACION: 'En revisión', ACEPTADA: 'Adjudicada', RECHAZADA: 'Perdida', FACTURADA: 'Facturada' };
  var COLS = ['BORRADOR', 'ENVIADA', 'EN_NEGOCIACION', 'ACEPTADA', 'RECHAZADA', 'FACTURADA'];
  var IN = 'w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-950 outline-none focus:border-blue-500';
  var BTN = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-colors';
  function clp(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-CL'); }
  function lbl(q, s) { return (q && q.type === 'MERCADO_PUBLICO' ? LBL_MP : LBL_PRIV)[s || q.status] || s; }
  function toast(m, t) { showToast(m, t); }
  async function api(url, opts) {
    var res = await fetch(url, opts), body = null;
    try { body = await res.json(); } catch (e) { /* sin cuerpo */ }
    if (!res.ok) throw new Error((body && (body.detail || body.message)) || ('Error ' + res.status));
    return body;
  }
  function jo(method, obj) { return { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) }; }

  // --- se engancha a la navegación existente
  var _sw = switchTab;
  switchTab = async function (t) {
    await _sw(t);
    if (t === 'pipeline') await renderPipeline();
  };

  window.renderPipeline = async function () {
    var host = document.getElementById('view-pipeline'); if (!host) return;
    var qs = Object.keys(pp.f).filter(function (k) { return pp.f[k] !== '' && pp.f[k] !== null; }).map(function (k) { return k + '=' + encodeURIComponent(pp.f[k]); }).join('&');
    try { pp.data = await api('/api/pipeline/board' + (qs ? '?' + qs : '')); }
    catch (e) { host.innerHTML = '<p class="text-rose-700 text-sm">' + esc(e.message) + '</p>'; return; }
    draw();
    if (pp.openId) openQuote(pp.openId, true);
  };

  function kpiCard(title, value, sub, cls) {
    return '<div class="bg-white border border-slate-200 rounded-xl p-4"><div class="text-[11px] text-slate-600">' + title + '</div><div class="text-2xl font-heading font-extrabold ' + cls + '">' + value + '</div><div class="text-[11px] text-slate-500">' + sub + '</div></div>';
  }

  function draw() {
    var host = document.getElementById('view-pipeline'), d = pp.data, k = d.kpis, items = d.items;
    var alerts = d.alerts || [];
    var hasF = Object.keys(pp.f).some(function (x) { return pp.f[x] !== ''; });
    host.innerHTML =
      '<div class="flex flex-wrap items-center justify-between gap-3"><div><h2 class="font-heading font-extrabold text-xl text-slate-950"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg> Seguimiento de Cotizaciones, Muestras y Conversaciones</h2>' +
      '<p class="text-xs text-slate-600">Pipeline comercial: control de ofertas enviadas, entregas de muestras físicas y registro de conversaciones para no dejar ningún negocio pendiente.</p></div>' +
      '<div class="flex flex-wrap gap-2">' +
      '<button onclick="if(typeof openNewQuotationModal===\'function\')openNewQuotationModal();else if(typeof cdOpen===\'function\')cdOpen(\'COTIZACION\');" class="' + BTN + ' bg-emerald-600 hover:bg-emerald-700 text-white shadow">+ Nueva Cotización</button>' +
      '<button onclick="ppSetView(\'kanban\')" class="' + BTN + ' ' + (pp.view === 'kanban' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-900 border border-slate-300') + '">▦ Tablero</button>' +
      '<button onclick="ppSetView(\'table\')" class="' + BTN + ' ' + (pp.view === 'table' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-900 border border-slate-300') + '"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg> Lista</button></div></div>' +
      '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">' +
      kpiCard('Monto cotizado en el mes', clp(k.month_total), 'sin borradores · con borradores ' + clp(k.month_total_incl_drafts), 'text-slate-950') +
      kpiCard('Tasa de cierre', k.conversion_pct + '%', k.won + ' aprobadas de ' + k.sent + ' enviadas', 'text-emerald-700') +
      kpiCard('Pipeline activo (negociación)', clp(k.pipeline_amount), k.pipeline_count + ' cotización(es) abiertas', 'text-blue-700') +
      kpiCard('Próximas a vencer (≤48 h)', k.expiring_count, clp(k.expiring_amount) + ' en juego', k.expiring_count ? 'text-rose-700' : 'text-slate-950') + '</div>' +
      (alerts.length ? '<div class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs space-y-1"><div class="font-bold text-amber-700"><svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg> ' + alerts.length + ' alerta(s) de seguimiento</div>' +
        alerts.slice(0, 6).map(function (a) { return '<div class="flex justify-between gap-2"><span class="text-slate-900"><b>' + esc(a.folio) + '</b> · ' + esc(a.client_name) + ' — ' + esc(a.message) + '</span><button onclick="ppOpen(' + a.quotation_id + ')" class="text-blue-700 hover:underline">Abrir</button></div>'; }).join('') +
        (alerts.length > 6 ? '<div class="text-slate-500">…y ' + (alerts.length - 6) + ' más</div>' : '') + '</div>' : '') +
      filtersHtml(d, hasF) +
      (pp.view === 'kanban' ? kanbanHtml(items) : tableHtml(items)) +
      lossHtml(d.loss_metrics || []);
    lucide.createIcons();
  }

  function filtersHtml(d, hasF) {
    var f = pp.f;
    return '<div class="bg-white border border-slate-200 rounded-xl p-3 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-9 gap-2 text-xs items-end">' +
      '<div class="lg:col-span-2"><label class="text-slate-500">Buscar</label><input id="pp-q" value="' + esc(f.q) + '" placeholder="Folio, cliente, carpeta, licitación" class="' + IN + '" onkeydown="if(event.key===\'Enter\')ppApply()"></div>' +
      '<div><label class="text-slate-500">Desde</label><input id="pp-df" type="date" value="' + f.date_from + '" class="' + IN + '"></div>' +
      '<div><label class="text-slate-500">Hasta</label><input id="pp-dt" type="date" value="' + f.date_to + '" class="' + IN + '"></div>' +
      '<div><label class="text-slate-500">Cliente</label><input id="pp-client" value="' + esc(f.client) + '" class="' + IN + '"></div>' +
      '<div><label class="text-slate-500">Estado</label><select id="pp-status" class="' + IN + '"><option value="">Todos</option>' + COLS.map(function (s) { return '<option value="' + s + '" ' + (f.status === s ? 'selected' : '') + '>' + LBL_PRIV[s] + '</option>'; }).join('') + '</select></div>' +
      '<div><label class="text-slate-500">Vendedor</label><select id="pp-owner" class="' + IN + '"><option value="">Todos</option>' + (d.owners || []).map(function (o) { return '<option ' + (f.owner === o ? 'selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></div>' +
      '<div class="flex gap-1"><div><label class="text-slate-500">Monto mín.</label><input id="pp-min" type="number" value="' + f.min_amount + '" class="' + IN + '"></div><div><label class="text-slate-500">máx.</label><input id="pp-max" type="number" value="' + f.max_amount + '" class="' + IN + '"></div></div>' +
      '<div class="flex gap-1"><button onclick="ppApply()" class="' + BTN + ' bg-blue-600 hover:bg-blue-700 text-white">Filtrar</button>' + (hasF ? '<button onclick="ppClear()" class="' + BTN + ' bg-slate-100 hover:bg-slate-200 text-slate-900 border border-slate-300">Limpiar</button>' : '') + '</div></div>';
  }

  var SAMPLE_BADGE = {
    PENDIENTE_ENVIO: '<span class="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-bold"><svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2v7.31"/><path d="M14 9.3V2"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/></svg> Muestra pendiente</span>',
    ENVIADA: '<span class="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 text-[10px] font-bold"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg> Muestra entregada</span>',
    APROBADA: '<span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-bold"><svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Muestra aprobada</span>',
    OBSERVADA: '<span class="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 text-[10px] font-bold"><svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Muestra observada</span>'
  };

  function card(q) {
    var al = q.alerts || [];
    var dte = q.days_to_expire;
    var sBadge = SAMPLE_BADGE[q.sample_status] || '';
    return '<div draggable="true" ondragstart="ppDrag(event,' + q.id + ')" onclick="ppOpen(' + q.id + ')" class="bg-slate-50 border border-slate-200 hover:border-blue-500/60 rounded-lg p-2.5 cursor-grab space-y-1 text-xs">' +
      '<div class="flex justify-between gap-1"><b class="text-slate-950 font-mono">' + esc(q.folio) + '</b><span class="text-[10px] ' + (q.type === 'MERCADO_PUBLICO' ? 'text-sky-700' : 'text-fuchsia-700') + '">' + (q.type === 'MERCADO_PUBLICO' ? 'M. Público' : 'Privado') + '</span></div>' +
      '<div class="text-slate-700 truncate">' + esc(q.client_name) + '</div>' +
      '<div class="flex justify-between"><b class="text-slate-950">' + clp(q.total_amount) + '</b><span class="text-slate-500">' + (q.margin_pct !== null ? 'Mg ' + q.margin_pct + '%' : 'Mg s/d') + '</span></div>' +
      (q.folder_code ? '<div class="text-[10px] text-slate-500"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg> ' + esc(q.folder_code) + '</div>' : '') +
      '<div class="flex flex-wrap gap-1">' + sBadge + (q.status === 'RECHAZADA' && q.loss_reason ? '<span class="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 text-[10px]">' + esc(q.loss_reason) + '</span>' : '') +
      al.map(function (a) { return '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold ' + (a.level === 'ALTA' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700') + '" title="' + esc(a.message) + '">' + (a.kind === 'SIN_RESPUESTA' ? '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> sin respuesta' : (a.kind === 'MUESTRA_PENDIENTE' ? '<svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2v7.31"/><path d="M14 9.3V2"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/></svg> entregar muestra' : (a.kind === 'VENCIDA' ? '<svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> vencida' : '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="m5 3 2 2"/><path d="m19 3-2 2"/></svg> vence pronto'))) + '</span>'; }).join('') +
      (!al.length && dte !== null && ['ENVIADA', 'EN_NEGOCIACION'].indexOf(q.status) >= 0 ? '<span class="text-[10px] text-slate-500">vence en ' + dte + ' d</span>' : '') + '</div>' +
      (q.owner ? '<div class="text-[10px] text-slate-500"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg> ' + esc(q.owner) + '</div>' : '') + '</div>';
  }

  function kanbanHtml(items) {
    return '<div class="grid gap-3 overflow-x-auto pb-2" style="grid-template-columns:repeat(6,minmax(215px,1fr))">' + COLS.map(function (s) {
      var list = items.filter(function (q) { return q.status === s; });
      var sum = list.reduce(function (a, q) { return a + Number(q.total_amount || 0); }, 0);
      return '<div ondragover="event.preventDefault();this.classList.add(\'ring-2\',\'ring-blue-500/50\')" ondragleave="this.classList.remove(\'ring-2\',\'ring-blue-500/50\')" ondrop="ppDrop(event,\'' + s + '\');this.classList.remove(\'ring-2\',\'ring-blue-500/50\')" class="bg-white border-t-4 ' + COLORS[s] + ' border-x border-b border-slate-200 rounded-xl p-2.5 space-y-2 min-h-[260px]">' +
        '<div class="flex justify-between items-center"><div class="font-bold text-xs text-slate-950">' + LBL_PRIV[s] + (s === 'ENVIADA' ? ' <span class="font-normal text-slate-500">/ Publicada</span>' : '') + '</div><span class="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700">' + list.length + '</span></div>' +
        '<div class="text-[11px] text-slate-500">' + clp(sum) + '</div>' + list.map(card).join('') + (list.length ? '' : '<div class="text-[11px] text-slate-600 text-center py-6">Arrastra aquí</div>') + '</div>';
    }).join('') + '</div>';
  }

  function tableHtml(items) {
    if (!items.length) return '<div class="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-500">No hay cotizaciones con estos filtros.</div>';
    return '<div class="bg-white border border-slate-200 rounded-xl overflow-x-auto"><table class="w-full text-xs"><thead class="bg-slate-100 text-slate-600 text-left"><tr>' +
      ['Folio', 'Emisión', 'Vencimiento', 'Cliente / Institución', 'Carpeta', 'Neto', 'Total', 'Margen', 'Estado', 'Responsable'].map(function (h) { return '<th class="px-3 py-2 font-semibold whitespace-nowrap">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      items.map(function (q) {
        var warn = (q.alerts || []).length;
        return '<tr onclick="ppOpen(' + q.id + ')" class="border-t border-slate-200 hover:bg-slate-100 cursor-pointer"><td class="px-3 py-2 font-mono font-bold text-slate-950 whitespace-nowrap">' + esc(q.folio) + '</td>' +
          '<td class="px-3 py-2 whitespace-nowrap">' + esc(q.date || '') + '</td><td class="px-3 py-2 whitespace-nowrap ' + (warn ? 'text-rose-700 font-semibold' : '') + '">' + esc(q.expires_at || '—') + (warn ? ' <svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' : '') + '</td>' +
          '<td class="px-3 py-2 text-slate-900">' + esc(q.client_name) + '</td><td class="px-3 py-2 text-slate-600">' + esc(q.folder_code || '—') + '</td>' +
          '<td class="px-3 py-2 text-right">' + clp(q.net_amount) + '</td><td class="px-3 py-2 text-right font-bold text-slate-950">' + clp(q.total_amount) + '</td>' +
          '<td class="px-3 py-2 text-right">' + (q.margin_pct !== null ? q.margin_pct + '%' : '—') + '</td>' +
          '<td class="px-3 py-2"><span class="px-2 py-0.5 rounded-full font-bold ' + BADGE[q.status] + '">' + esc(lbl(q)) + '</span></td><td class="px-3 py-2 text-slate-600">' + esc(q.owner || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function lossHtml(m) {
    if (!m.length) return '';
    var tot = m.reduce(function (a, x) { return a + x.n; }, 0);
    return '<div class="bg-white border border-slate-200 rounded-xl p-4"><div class="font-bold text-xs text-slate-950 mb-2"><svg class="w-3.5 h-3.5 inline text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg> Motivos de pérdida (' + tot + ' cotización(es) rechazadas)</div><div class="space-y-1.5">' +
      m.map(function (x) { var pct = Math.round(x.n / tot * 100); return '<div class="text-xs"><div class="flex justify-between text-slate-700"><span>' + esc(x.reason) + '</span><span>' + x.n + ' · ' + clp(x.amount) + ' (' + pct + '%)</span></div><div class="h-1.5 bg-slate-100 rounded"><div class="h-1.5 bg-rose-500 rounded" style="width:' + pct + '%"></div></div></div>'; }).join('') + '</div></div>';
  }

  // ---------------------------------------------------------------- interacciones
  window.ppSetView = function (v) { pp.view = v; localStorage.setItem('ppView', v); draw(); };
  window.ppApply = function () {
    var g = function (id) { var e = document.getElementById(id); return e ? e.value : ''; };
    pp.f = { q: g('pp-q'), date_from: g('pp-df'), date_to: g('pp-dt'), client: g('pp-client'), status: g('pp-status'), owner: g('pp-owner'), min_amount: g('pp-min'), max_amount: g('pp-max'), kind: '' };
    renderPipeline();
  };
  window.ppClear = function () { Object.keys(pp.f).forEach(function (k) { pp.f[k] = ''; }); renderPipeline(); };
  window.ppDrag = function (e, id) { e.dataTransfer.setData('text/plain', String(id)); e.dataTransfer.effectAllowed = 'move'; };
  window.ppDrop = function (e, status) {
    e.preventDefault();
    var id = parseInt(e.dataTransfer.getData('text/plain'), 10); if (!id) return;
    var q = pp.data.items.filter(function (x) { return x.id === id; })[0];
    if (!q || q.status === status) return;
    ppChangeStatus(id, status);
  };

  window.ppChangeStatus = async function (id, status) {
    if (status === 'RECHAZADA') { return lossModal(id); }
    try { var r = await api('/api/pipeline/' + id + '/status', jo('PUT', { status: status })); toast(r.message); await renderPipeline(); }
    catch (e) { toast(e.message, 'error'); await renderPipeline(); }
  };

  function modal(title, html) {
    var old = document.getElementById('pp-modal'); if (old) old.remove();
    var d = document.createElement('div'); d.id = 'pp-modal';
    d.className = 'fixed inset-0 bg-slate-900/45 z-[80] flex items-center justify-center p-4';
    d.innerHTML = '<div class="bg-white border border-slate-200 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"><div class="flex justify-between items-center px-5 py-3 border-b border-slate-200"><h3 class="font-bold text-sm text-slate-950">' + title + '</h3><button onclick="ppModalClose()" class="text-slate-600 hover:text-slate-950"><svg class="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="p-5 text-xs space-y-3">' + html + '</div></div>';
    document.body.appendChild(d);
  }
  window.ppModalClose = function () { var m = document.getElementById('pp-modal'); if (m) m.remove(); renderPipeline(); };

  function lossModal(id) {
    var reasons = pp.data.meta.loss_reasons;
    modal('Marcar como rechazada / perdida', '<p class="text-slate-600">Indica el motivo para las métricas comerciales.</p>' +
      '<select id="pp-loss" class="' + IN + '">' + reasons.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</select>' +
      '<textarea id="pp-loss-d" rows="3" placeholder="Detalle (opcional): competidor, precio ofertado, observaciones…" class="' + IN + '"></textarea>' +
      '<div class="flex justify-end gap-2"><button onclick="ppModalClose()" class="' + BTN + ' bg-slate-100 hover:bg-slate-200 text-slate-900 border border-slate-300">Cancelar</button><button onclick="ppConfirmLoss(' + id + ')" class="' + BTN + ' bg-rose-600 hover:bg-rose-700 text-white">Confirmar</button></div>');
  }
  window.ppConfirmLoss = async function (id) {
    try {
      var r = await api('/api/pipeline/' + id + '/status', jo('PUT', { status: 'RECHAZADA', loss_reason: document.getElementById('pp-loss').value, loss_detail: document.getElementById('pp-loss-d').value }));
      toast(r.message); var m = document.getElementById('pp-modal'); if (m) m.remove(); await renderPipeline();
    } catch (e) { toast(e.message, 'error'); }
  };

  // ---------------------------------------------------------------- ficha lateral
  window.ppOpen = function (id) { pp.openId = id; openQuote(id); };
  window.ppCloseDrawer = function () { pp.openId = null; var d = document.getElementById('pp-drawer'); if (d) d.remove(); };

  async function openQuote(id, keepScroll) {
    var q;
    try { q = await api('/api/pipeline/' + id); } catch (e) { toast(e.message, 'error'); return; }
    var old = document.getElementById('pp-drawer'), sc = old && keepScroll ? old.querySelector('[data-scroll]').scrollTop : 0;
    if (old) old.remove();
    var d = document.createElement('div'); d.id = 'pp-drawer'; d.className = 'fixed inset-y-0 right-0 w-full max-w-xl z-[70] bg-white border-l border-slate-200 shadow-2xl flex flex-col';
    var icons = { AUTO: '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>', NOTA: '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>', LLAMADO: '<svg class="w-3.5 h-3.5 inline text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>', CORREO: '<svg class="w-3.5 h-3.5 inline text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>️', MUESTRA: '<svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2v7.31"/><path d="M14 9.3V2"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/></svg>', WHATSAPP: '<svg class="w-3.5 h-3.5 inline text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>', REUNION: '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m11 17 2 2a1 1 0 0 0 1.4 0l4.3-4.3a1 1 0 0 0 0-1.4l-2-2"/><path d="m13 7-2-2a1 1 0 0 0-1.4 0L5.3 9.3a1 1 0 0 0 0 1.4l2 2"/></svg>' };
    var sampleOpts = [
      ['NO_REQUERIDA', 'No requiere muestra'],
      ['PENDIENTE_ENVIO', '<svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2v7.31"/><path d="M14 9.3V2"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/></svg> Muestra pendiente de envío'],
      ['ENVIADA', '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg> Muestra entregada al cliente'],
      ['APROBADA', '<svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Muestra aprobada por cliente'],
      ['OBSERVADA', '<svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Muestra con observaciones']
    ];
    d.innerHTML =
      '<div class="px-5 py-3 border-b border-slate-200 flex justify-between items-start gap-3"><div><div class="font-mono font-extrabold text-slate-950 text-lg">' + esc(q.folio) + '</div>' +
      '<div class="text-xs text-slate-600">' + esc(q.client_name) + ' · ' + esc(q.client_rut) + '</div></div><button onclick="ppCloseDrawer()" class="text-slate-600 hover:text-slate-950 text-lg"><svg class="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>' +
      '<div data-scroll class="flex-1 overflow-y-auto p-5 space-y-4 text-xs">' +
      (q.alerts.length ? '<div class="bg-rose-50 border border-rose-200 rounded-lg p-2.5 space-y-0.5">' + q.alerts.map(function (a) { return '<div class="text-rose-700"><svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg> ' + esc(a.message) + '</div>'; }).join('') + '</div>' : '') +
      '<div class="grid grid-cols-2 gap-2">' +
      '<div class="bg-slate-50 rounded-lg p-2.5"><div class="text-slate-500">Estado</div><select onchange="ppChangeStatus(' + q.id + ', this.value)" class="' + IN + ' mt-1">' + COLS.map(function (s) { return '<option value="' + s + '" ' + (q.status === s ? 'selected' : '') + '>' + esc(lbl(q, s)) + '</option>'; }).join('') + '</select>' +
      (q.status === 'RECHAZADA' && q.loss_reason ? '<div class="text-rose-700 mt-1">Motivo: ' + esc(q.loss_reason) + (q.loss_detail ? ' — ' + esc(q.loss_detail) : '') + '</div>' : '') + '</div>' +
      '<div class="bg-slate-50 rounded-lg p-2.5"><div class="text-slate-500">Total</div><div class="text-lg font-bold text-slate-950">' + clp(q.total_amount) + '</div><div class="text-slate-500">Neto ' + clp(q.net_amount) + ' · Margen ' + (q.margin_pct !== null ? q.margin_pct + '%' : 's/d') + '</div></div>' +
      '<div class="bg-slate-50 rounded-lg p-2.5"><div class="text-slate-500">Emisión / vence</div><div class="text-slate-950">' + esc(q.date) + ' → ' + esc(q.expires_at || '—') + '</div></div>' +
      '<div class="bg-slate-50 rounded-lg p-2.5"><div class="text-slate-500">Carpeta de negocio</div>' + (q.folder_id ? '<button onclick="ppGoFolder(' + q.folder_id + ')" class="text-blue-700 hover:underline"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg> ' + esc(q.folder_code) + ' · abrir</button>' : '<span class="text-slate-500">Sin carpeta</span>') + '</div></div>' +
      // acciones rápidas
      '<div class="flex flex-wrap gap-1.5">' +
      '<button onclick="ppExport(' + q.id + ',\'pdf\')" class="' + BTN + ' bg-slate-100 hover:bg-slate-200 text-slate-950 border border-slate-300">⬇ PDF</button>' +
      '<button onclick="ppExport(' + q.id + ',\'xlsx\')" class="' + BTN + ' bg-slate-100 hover:bg-slate-200 text-slate-950 border border-slate-300">⬇ Excel</button>' +
      '<button onclick="ppSend(' + q.id + ')" class="' + BTN + ' bg-blue-600 hover:bg-blue-700 text-white"><svg class="w-3.5 h-3.5 inline text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg> Enviar / compartir</button>' +
      '<button onclick="ppDuplicate(' + q.id + ')" class="' + BTN + ' bg-slate-100 hover:bg-slate-200 text-slate-950 border border-slate-300">⧉ Duplicar / re-cotizar</button>' +
      (q.status === 'ACEPTADA' || q.status === 'FACTURADA' ? '<button onclick="ppInvoice(' + q.id + ')" class="' + BTN + ' bg-violet-600 hover:bg-violet-700 text-white"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M16 8h-6"/><path d="M16 12h-6"/><path d="M14 16h-4"/></svg> Facturar</button>' + (q.folder_id ? '<button onclick="ppGoFolder(' + q.folder_id + ')" class="' + BTN + ' bg-emerald-600 hover:bg-emerald-700 text-white"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg> Generar OC (en la carpeta)</button>' : '') : '') + '</div>' +
      (q.invoices.length ? '<div class="text-violet-700"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M16 8h-6"/><path d="M16 12h-6"/><path d="M14 16h-4"/></svg> Facturas vinculadas: ' + q.invoices.map(function (i) { return 'N° ' + i.folio + ' (' + clp(i.total_amount) + ')'; }).join(', ') + '</div>' : '') +
      (q.versions.length > 1 ? '<div class="text-slate-600">Versiones: ' + q.versions.map(function (v) { return '<button onclick="ppOpen(' + v.id + ')" class="' + (v.id === q.id ? 'text-slate-950 font-bold' : 'text-blue-700 hover:underline') + '">' + esc(v.folio) + '</button>'; }).join(' · ') + '</div>' : '') +
      // seguimiento y entrega de muestras
      '<div class="border border-slate-200 rounded-lg p-3 space-y-2.5 bg-slate-50"><div class="font-bold text-slate-900"><svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2v7.31"/><path d="M14 9.3V2"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/></svg> Entrega de Muestras & Recordatorios de Seguimiento</div>' +
      '<div class="grid grid-cols-2 gap-2">' +
      '<div><label class="text-slate-500">Estado de Muestra</label><select id="pp-sample-st" class="' + IN + '">' + sampleOpts.map(function (o) { return '<option value="' + o[0] + '" ' + ((q.sample_status || 'NO_REQUERIDA') === o[0] ? 'selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
      '<div><label class="text-slate-500">Plazo Entrega Muestra</label><input id="pp-sample-due" type="date" value="' + esc(q.sample_due_date || '') + '" class="' + IN + '"></div>' +
      '<div class="col-span-2"><label class="text-slate-500">Detalle Muestra (tallas enviadas, receptor, guía o dirección)</label><input id="pp-sample-det" value="' + esc(q.sample_detail || '') + '" placeholder="Ej: Enviada muestra Chaqueta Talla L a Bodega Central con receptor Juan Pérez" class="' + IN + '"></div>' +
      '</div>' +
      '<div class="grid grid-cols-3 gap-2 pt-1 border-t border-slate-200">' +
      '<div><label class="text-slate-500">Oferta vence el</label><input id="pp-due" type="date" value="' + esc(q.expires_at || '') + '" class="' + IN + '"></div>' +
      '<div><label class="text-slate-500">Alertar sin resp. (días)</label><input id="pp-fu" type="number" min="1" value="' + (q.follow_up_days || 5) + '" class="' + IN + '"></div>' +
      '<div><label class="text-slate-500">Responsable</label><input id="pp-owner-in" list="pp-owners" value="' + esc(q.owner || '') + '" class="' + IN + '"><datalist id="pp-owners">' + ((pp.data && pp.data.owners) || []).map(function (o) { return '<option value="' + esc(o) + '">'; }).join('') + '</datalist></div></div>' +
      '<div class="flex justify-between items-center"><span class="text-[11px] text-slate-500">Alerta automática de muestras pendientes y vencimientos.</span><button onclick="ppSaveSettings(' + q.id + ')" class="' + BTN + ' bg-emerald-600 hover:bg-emerald-700 text-white">Guardar Seguimiento y Muestra</button></div></div>' +
      // bitácora de conversaciones y muestras
      '<div class="border border-slate-200 rounded-lg p-3 space-y-2"><div class="font-bold text-slate-900"><svg class="w-3.5 h-3.5 inline text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg> Bitácora de Conversaciones, Llamados y Muestras</div>' +
      '<div class="flex gap-1.5"><select id="pp-ev-kind" class="' + IN + ' !w-36"><option value="NOTA"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Nota interna</option><option value="WHATSAPP"><svg class="w-3.5 h-3.5 inline text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg> WhatsApp</option><option value="LLAMADO"><svg class="w-3.5 h-3.5 inline text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> Llamado</option><option value="MUESTRA"><svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2v7.31"/><path d="M14 9.3V2"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/></svg> Entrega Muestra</option><option value="REUNION"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m11 17 2 2a1 1 0 0 0 1.4 0l4.3-4.3a1 1 0 0 0 0-1.4l-2-2"/><path d="m13 7-2-2a1 1 0 0 0-1.4 0L5.3 9.3a1 1 0 0 0 0 1.4l2 2"/></svg> Reunión</option><option value="CORREO"><svg class="w-3.5 h-3.5 inline text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>️ Correo</option></select>' +
      '<input id="pp-ev-msg" placeholder="Registra conversación con el cliente, envío de muestra o acuerdo…" class="' + IN + '" onkeydown="if(event.key===\'Enter\')ppAddEvent(' + q.id + ')"><button onclick="ppAddEvent(' + q.id + ')" class="' + BTN + ' bg-blue-600 hover:bg-blue-700 text-white">Agregar</button></div>' +
      '<div class="space-y-1.5 max-h-72 overflow-y-auto">' + (q.events.length ? q.events.map(function (e) { return '<div class="bg-slate-50 rounded p-2"><div class="flex justify-between text-[10px] text-slate-500"><span>' + (icons[e.kind] || '<svg class="w-3.5 h-3.5 inline text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>') + ' ' + esc(e.kind) + ' · ' + esc(e.created_by || '') + '</span><span>' + esc(e.created_at || '') + '</span></div><div class="text-slate-900 mt-0.5">' + esc(e.message) + '</div></div>'; }).join('') : '<div class="text-slate-600">Sin conversaciones ni actividades registradas aún.</div>') + '</div></div>' +
      '<div class="text-[11px] text-slate-500">' + q.items.length + ' ítem(s) · ' + esc(q.payment_terms || '') + ' · entrega ' + esc(q.delivery_time || '') + '</div></div>';
    document.body.appendChild(d);
    var s = d.querySelector('[data-scroll]'); if (s) s.scrollTop = sc;
  }

  window.ppGoFolder = function (fid) { ppCloseDrawer(); if (typeof openWorkspace === 'function') openWorkspace(fid, 'cotizador'); };
  window.ppSaveSettings = async function (id) {
    try {
      var r = await api('/api/pipeline/' + id + '/settings', jo('PUT', {
        due_date: document.getElementById('pp-due').value || null,
        follow_up_days: parseInt(document.getElementById('pp-fu').value, 10) || 5,
        owner: document.getElementById('pp-owner-in').value,
        sample_status: document.getElementById('pp-sample-st').value,
        sample_due_date: document.getElementById('pp-sample-due').value || null,
        sample_detail: document.getElementById('pp-sample-det').value
      }));
      toast(r.message); await renderPipeline();
    } catch (e) { toast(e.message, 'error'); }
  };
  window.ppAddEvent = async function (id) {
    var m = document.getElementById('pp-ev-msg').value; if (!m.trim()) return;
    try { await api('/api/pipeline/' + id + '/events', jo('POST', { kind: document.getElementById('pp-ev-kind').value, message: m })); await openQuote(id, true); }
    catch (e) { toast(e.message, 'error'); }
  };
  window.ppExport = async function (id, fmt) {
    try {
      var r = await fetch('/api/pipeline/' + id + '/export?fmt=' + fmt, { credentials: 'same-origin' });
      if (!r.ok) throw new Error('Error ' + r.status);
      var b = await r.blob(), a = document.createElement('a'), cd = r.headers.get('content-disposition') || '', m = /filename="?([^";]+)/.exec(cd);
      a.href = URL.createObjectURL(b); a.download = m ? m[1] : ('cotizacion.' + fmt); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000); await openQuote(id, true);
    } catch (e) { toast('No se pudo descargar: ' + e.message, 'error'); }
  };
  window.ppDuplicate = async function (id) {
    if (!confirm('¿Crear una nueva versión (borrador) de esta cotización con nuevo correlativo?')) return;
    try { var r = await api('/api/pipeline/' + id + '/duplicate', { method: 'POST' }); toast(r.message); pp.openId = r.id; await renderPipeline(); }
    catch (e) { toast(e.message, 'error'); }
  };

  window.ppSend = async function (id) {
    var q = await api('/api/pipeline/' + id);
    modal('Enviar / compartir ' + esc(q.folio), '<div><label class="text-slate-500">Correo del cliente</label><input id="pp-mail" value="' + esc(q.client_email || '') + '" class="' + IN + '"></div>' +
      '<p class="text-slate-600">Si configuraste el correo de salida (Multi-Empresa & Config â†’ Correo) se envÃ­a directo desde la app con el PDF adjunto; si no, se abre tu programa de correo. Queda en la bitÃ¡cora y la cotizaciÃ³n pasa a Â«EnviadaÂ».</p>' +
      '<div class="flex flex-wrap gap-2 justify-end"><button onclick="ppCopyLink(' + id + ')" class="' + BTN + ' bg-slate-100 hover:bg-slate-200 text-slate-950 border border-slate-300"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Copiar enlace web</button><button onclick="ppMail(' + id + ')" class="' + BTN + ' bg-blue-600 hover:bg-blue-700 text-white"><svg class="w-3.5 h-3.5 inline text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg> Abrir correo</button></div>');
  };
  async function linkFor(id) { var r = await api('/api/pipeline/' + id + '/share', { method: 'POST' }); return location.origin + r.url; }
  window.ppCopyLink = async function (id) {
    try {
      var url = await linkFor(id);
      try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } catch (e) { prompt('Copia el enlace:', url); }
      await api('/api/pipeline/' + id + '/mark-sent', jo('POST', { via: 'enlace web' }));
    } catch (e) { toast(e.message, 'error'); }
  };
  window.ppMail = async function (id) {
    try {
      var q = await api('/api/pipeline/' + id), to = document.getElementById('pp-mail').value.trim(), url = await linkFor(id);
      var body = 'Estimados ' + q.client_name + ',\n\nAdjuntamos el enlace a nuestra cotización ' + q.folio + ' por ' + clp(q.total_amount) + ' (IVA incluido), válida hasta el ' + (q.expires_at || '') + '.\n\n' + url + '\n\nQuedamos atentos a sus comentarios.\nSaludos cordiales.';
      await api('/api/pipeline/' + id + '/mark-sent', jo('POST', { via: 'correo', to: to }));
      window.location.href = 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent('Cotización ' + q.folio) + '&body=' + encodeURIComponent(body);
      ppModalClose(); await openQuote(id, true);
    } catch (e) { toast(e.message, 'error'); }
  };

  window.ppInvoice = async function (id) {
    var c = await api('/api/pipeline/' + id + '/invoice-candidates');
    modal('Facturar cotización', '<p class="text-slate-600">La emisión directa del DTE con timbraje del SII aún no está habilitada en esta app. Emite la factura en tu sistema de facturación / portal del SII; luego sincroniza el RCV (SII &amp; Facturación) y vincúlala aquí. Se muestran las facturas emitidas a este cliente sin vincular:</p>' +
      (c.length ? c.map(function (f) { return '<div class="flex justify-between items-center bg-slate-50 rounded p-2"><span class="text-slate-900">N° <b>' + f.folio + '</b> · ' + esc(f.emission_date) + ' · ' + clp(f.total_amount) + '</span><button onclick="ppLinkInvoice(' + id + ',' + f.id + ')" class="' + BTN + ' bg-violet-600 hover:bg-violet-700 text-white">Vincular</button></div>'; }).join('') : '<div class="text-amber-700">No hay facturas emitidas pendientes de vincular para este cliente.</div>') +
      '<div class="flex justify-end"><button onclick="ppModalClose()" class="' + BTN + ' bg-slate-100 hover:bg-slate-200 text-slate-900 border border-slate-300">Cerrar</button></div>');
  };
  window.ppLinkInvoice = async function (id, dteId) {
    try { var r = await api('/api/pipeline/' + id + '/link-invoice', jo('POST', { dte_id: dteId })); toast(r.message); var m = document.getElementById('pp-modal'); if (m) m.remove(); await renderPipeline(); }
    catch (e) { toast(e.message, 'error'); }
  };
})();
