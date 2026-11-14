/* Control de pagos y vencimientos: pago manual con comprobante, historial, panel de alertas 10/5/2 días. */
(function () {
  var IN = 'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-950';
  function e(x) { return (typeof esc === 'function') ? esc(x) : String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clp(n) { return (typeof formatCLP === 'function') ? formatCLP(n) : '$' + Math.round(n || 0).toLocaleString('es-CL'); }
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t); else alert(m); }
  var STATUS = {
    PAGADA: ['bg-emerald-50 text-emerald-700', function (d) { return d.direction === 'EMITIDO' ? 'COBRADA' : 'PAGADA'; }],
    PARCIAL: ['bg-amber-50 text-amber-700', function (d) { return d.direction === 'EMITIDO' ? 'ABONADA (PARCIAL)' : 'PAGO PARCIAL'; }],
    PENDIENTE: ['bg-slate-100 text-slate-700', function () { return 'PENDIENTE'; }]
  };
  var LV = { VENCIDA: 'bg-rose-50 text-rose-700', CRITICA: 'bg-rose-50 text-rose-700', ALTA: 'bg-orange-50 text-orange-700', MEDIA: 'bg-amber-50 text-amber-700' };

  window.ppStatusCell = function (d) {
    var st = d.payment_status || (d.is_reconciled ? 'PAGADA' : 'PENDIENTE');
    var s = STATUS[st] || STATUS.PENDIENTE;
    var saldo = Math.max(0, (d.total_amount || 0) - (d.paid_amount || 0));
    var isVenta = d.direction === 'EMITIDO';
    var cp = isVenta ? d.razon_social_receptor : d.razon_social_emisor;
    var cpSafe = (cp || '').replace(/'/g, "\\'");
    var h = '<div class="flex flex-col items-center gap-1.5"><span class="px-2.5 py-0.5 rounded-full text-[10px] font-semibold ' + s[0] + '">' + s[1](d) + '</span>';
    if (st === 'PARCIAL') h += '<span class="text-[10px] text-zinc-500 font-mono">Saldo ' + clp(saldo) + '</span>';
    h += '<button onclick="payOpen(' + d.id + ')" class="px-2.5 py-1 rounded-[8px] bg-zinc-900 hover:bg-zinc-800 text-white text-[10px] font-medium shadow-sm transition-all">' +
      (st === 'PAGADA' ? 'Ver pagos' : 'Registrar Pago / Medio') + '</button>';
    if (isVenta && saldo > 0 && st !== 'PAGADA') {
      h += '<button onclick="event.stopPropagation(); payOpenFactoring(' + saldo + ',\'' + cpSafe + '\',\'' + (d.folio || '') + '\')" class="px-2 py-0.5 rounded-[8px] bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 text-[10px] font-medium border border-amber-500/20 inline-flex items-center gap-1"><svg class="w-3 h-3 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>Factoring</button>';
    }
    h += '</div>';
    return h;
  };

  async function api(url, opts) {
    var r = await fetch(url, opts);
    var j = null; try { j = await r.json(); } catch (x) { }
    if (!r.ok) throw new Error((j && (j.detail || j.message)) || ('Error ' + r.status));
    return j;
  }

  window.payOpen = async function (id) {
    var j;
    try { j = await api('/api/payments/dte/' + id); } catch (x) { return toast(x.message, 'error'); }
    var d = j.dte, saldo = j.saldo, today = new Date().toISOString().slice(0, 10);
    var cp = d.direction === 'EMITIDO' ? d.razon_social_receptor : d.razon_social_emisor;
    var hist = j.payments.length ? '<table class="w-full text-xs"><thead><tr class="text-slate-500 text-left"><th class="py-1">Fecha</th><th>Medio</th><th class="text-right">Monto</th><th>Origen / Ref.</th><th></th></tr></thead><tbody>' +
      j.payments.map(function (p) {
        return '<tr class="border-t border-slate-200"><td class="py-1">' + e(p.paid_date) + '</td><td>' + e(p.method_label) + '</td><td class="text-right">' + clp(p.amount) + '</td><td>' +
          (p.source === 'BANCO' ? 'Banco · ' + e(p.transfer_ref || '') : 'Manual') + (p.notes ? '<div class="text-[10px] text-slate-500">' + e(p.notes) + '</div>' : '') + '</td><td class="text-right whitespace-nowrap">' +
          (p.has_receipt ? '<a class="text-blue-700 underline mr-2" href="/api/payments/receipt/' + p.id + '" target="_blank">Comprobante</a>' : '') +
          '<button onclick="payUndo(' + p.id + ',' + id + ')" class="text-rose-700">Anular</button></td></tr>';
      }).join('') + '</tbody></table>' : '<div class="text-xs text-slate-500">Sin pagos registrados.</div>';
    var form = saldo > 0 ? (
      '<div class="grid grid-cols-2 gap-3 text-xs">' +
      '<div><label class="text-slate-600">Monto pagado (CLP)</label><input id="pp-amt" type="number" min="1" max="' + Math.round(saldo) + '" value="' + Math.round(saldo) + '" class="' + IN + '"><div class="text-[10px] text-slate-500 mt-0.5">Menor al saldo = abono parcial / crédito</div></div>' +
      '<div><label class="text-slate-600">Fecha real de pago</label><input id="pp-date" type="date" value="' + today + '" class="' + IN + '"></div>' +
      '<div><label class="text-slate-600">Medio / Condición de pago</label><select id="pp-method" class="' + IN + '"><option value="TRANSFERENCIA_EXTERNA">Transferencia bancaria / Al contado</option><option value="CHEQUE">Cheque (al día o a fecha)</option><option value="EFECTIVO">Efectivo / Caja chica</option><option value="CREDITO_DIRECTO">Crédito directo proveedor/cliente</option><option value="TARJETA_COMERCIAL">Tarjeta de crédito empresarial</option><option value="COMPENSACION_NC">Compensación / Nota de crédito</option></select></div>' +
      '<div><label class="text-slate-600">Comprobante (imagen o PDF)</label><input id="pp-file" type="file" accept="image/*,.pdf" class="' + IN + '"></div>' +
      '<div class="col-span-2"><label class="text-slate-600">Notas / serie de cheque / plazo pactado</label><textarea id="pp-notes" rows="2" class="' + IN + '" placeholder="Ej: Cheque N° 1234 Banco de Chile a 30 días / Pago al contado"></textarea></div>' +
      '<div id="pp-err" class="col-span-2 text-rose-700 hidden"></div>' +
      '<div class="col-span-2 flex justify-end gap-2"><button onclick="closePfModal()" class="px-3 py-2 rounded-lg bg-slate-100 text-slate-900">Cancelar</button><button id="pp-save" onclick="paySave(' + id + ')" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">Guardar pago</button></div></div>'
    ) : '<div class="text-xs text-emerald-700 font-semibold">Documento pagado en su totalidad.</div>';
    var html = '<div class="space-y-4"><div class="text-xs text-slate-700"><b>DTE ' + e(d.dte_type) + ' #' + e(d.folio) + '</b> · ' + e(cp) +
      '<div class="mt-1">Total ' + clp(d.total_amount) + ' · Pagado ' + clp(d.paid_amount || 0) + ' · <b class="text-amber-700">Saldo ' + clp(saldo) + '</b></div></div>' + form +
      '<div><div class="text-xs font-semibold text-slate-700 mb-1">Historial de pagos</div>' + hist + '</div></div>';
    pfModal('Pagos y Condición del Documento', html, true);
  };

  window.paySave = async function (id) {
    var err = document.getElementById('pp-err'), btn = document.getElementById('pp-save');
    err.classList.add('hidden');
    var amt = parseFloat(document.getElementById('pp-amt').value);
    if (!(amt > 0)) { err.textContent = 'Ingresa un monto mayor que 0'; err.classList.remove('hidden'); return; }
    var fd = new FormData();
    fd.append('amount', amt);
    fd.append('paid_date', document.getElementById('pp-date').value);
    fd.append('method', document.getElementById('pp-method').value);
    fd.append('notes', document.getElementById('pp-notes').value);
    var f = document.getElementById('pp-file').files[0];
    if (f) fd.append('file', f);
    btn.disabled = true;
    try {
      var j = await api('/api/payments/dte/' + id, { method: 'POST', body: fd });
      toast(j.message + (j.saldo > 0 ? ' · saldo ' + clp(j.saldo) : ''));
      closePfModal(); await ppRefresh();
    } catch (x) { err.textContent = x.message; err.classList.remove('hidden'); btn.disabled = false; }
  };

  window.payUndo = async function (pid, id) {
    if (!confirm('¿Anular este pago? El saldo del documento volverá a aumentar.')) return;
    try { await api('/api/payments/' + pid, { method: 'DELETE' }); toast('Pago anulado'); await ppRefresh(); await window.payOpen(id); }
    catch (x) { toast(x.message, 'error'); }
  };

  async function ppRefresh() {
    try { if (typeof renderSII === 'function' && !document.getElementById('view-sii').classList.contains('hidden')) await renderSII(); } catch (x) { }
    try { if (typeof renderDashboard === 'function' && !document.getElementById('view-dashboard').classList.contains('hidden')) await renderDashboard(); } catch (x) { }
    try { if (typeof renderBanking === 'function' && !document.getElementById('view-banking').classList.contains('hidden')) await renderBanking(); } catch (x) { }
  }

  async function renderPanel(viewId) {
    var view = document.getElementById(viewId); if (!view) return;
    var box = document.getElementById('pp-panel-' + viewId);
    if (!box) {
      box = document.createElement('div');
      box.id = 'pp-panel-' + viewId;
      box.className = 'erp-alert-box mt-6';
    }
    if (viewId === 'view-dashboard') {
      // Insertar arriba del gráfico en el dashboard para que las alertas críticas destaquen sin sobrecargar el pie
      var firstGrid = view.children[1];
      if (firstGrid && firstGrid.nextSibling) view.insertBefore(box, firstGrid.nextSibling);
      else view.appendChild(box);
    } else {
      view.appendChild(box);
    }
    var q = typeof getGlobalPeriodQuery === 'function' ? getGlobalPeriodQuery('month') : '';
    var j; try { j = await api('/api/payments/overview' + q); } catch (x) { return; }
    var rows = j.items.slice(0, 30).map(function (i) {
      var al = i.alert;
      return '<tr class="border-t border-zinc-100 hover:bg-zinc-50/70 transition-colors"><td class="py-2.5 px-3 text-zinc-600 font-medium">' + (i.direction === 'EMITIDO' ? 'Cobrar' : 'Pagar') + '</td><td class="px-3 font-semibold text-zinc-900 font-mono">#' + e(i.folio) + '</td><td class="px-3 text-zinc-800">' + e(i.counterparty) + '</td><td class="px-3 text-zinc-500 font-mono">' + e(i.due_date) +
        '</td><td class="px-3 text-right font-mono font-semibold text-zinc-900">' + clp(i.saldo) + '</td><td class="px-3">' + (al ? '<span class="px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold ' + LV[al.level] + '">' + e(al.label) + '</span>' : '<span class="text-zinc-400 font-medium text-xs">Al día</span>') +
        '</td><td class="px-3 text-right flex items-center justify-end gap-2">' +
        (i.direction === 'EMITIDO' && i.saldo > 0 ? '<button onclick="event.stopPropagation(); payOpenFactoring(' + i.saldo + ',\'' + (i.counterparty || '').replace(/'/g, "\\'") + '\',\'' + (i.folio || '') + '\')" class="px-2.5 py-1 rounded-[8px] bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 text-[11px] font-medium border border-amber-500/20 inline-flex items-center gap-1 transition-all"><svg class="w-3 h-3 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>Factoring</button>' : '') +
        '<button onclick="payOpen(' + i.id + ')" class="px-3 py-1.5 rounded-[9px] bg-zinc-900 hover:bg-zinc-800 text-white text-[11px] font-medium shadow-sm transition-all active:scale-[0.98]">Registrar Pago / Medio</button></td></tr>';
    }).join('');
    var alertBanner = j.alerts && j.alerts.length ? (
      '<div class="mb-4 rounded-[12px] border border-rose-200/80 bg-rose-50/70 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">' +
      '<div class="flex items-center gap-2.5"><span class="px-2.5 py-0.5 rounded-full bg-rose-600 text-white font-bold text-[10px] uppercase tracking-wider shadow-sm">Prioridad Alta</span>' +
      '<span class="text-rose-900 font-medium">' + j.alerts.length + ' documento(s) vencidos o próximos a vencer requieren gestión de pago o cobro inmediato.</span></div>' +
      '<button onclick="switchTab(\'banking\')" class="text-xs font-semibold text-rose-700 hover:text-rose-950 flex items-center gap-1">Ir a Conciliación y Pagos <span aria-hidden="true">&rarr;</span></button></div>'
    ) : (
      '<div class="mb-3 rounded-[12px] border border-emerald-200/80 bg-emerald-50/60 px-3.5 py-2.5 flex items-center justify-between text-xs">' +
      '<span class="text-emerald-800 font-medium flex items-center gap-1.5"><svg class="w-4 h-4 text-emerald-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>Alertas al día: No hay facturas con vencimiento crítico pendiente en este período.</span>' +
      '<span class="text-zinc-600">Por cobrar: <b class="text-emerald-700 font-mono font-semibold">' + clp(j.pendiente_cobrar) + '</b> · Por pagar: <b class="text-amber-700 font-mono font-semibold">' + clp(j.pendiente_pagar) + '</b></span></div>'
    );
    if (viewId === 'view-dashboard') {
      box.innerHTML = '<div class="flex flex-wrap justify-between items-center mb-3"><h3 class="text-sm font-bold text-zinc-900 flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full ' + (j.alerts && j.alerts.length ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500') + '"></span><span>Centro Prioritario de Alertas Financieras y Vencimientos</span></h3>' +
        '<div class="text-xs text-zinc-500">Por cobrar <b class="text-zinc-900 font-mono font-semibold">' + clp(j.pendiente_cobrar) + '</b> · Por pagar <b class="text-zinc-900 font-mono font-semibold">' + clp(j.pendiente_pagar) + '</b> · Alertas activas: <b class="' + (j.alerts.length ? 'text-rose-600 font-mono' : 'text-emerald-600 font-mono') + '">' + j.alerts.length + '</b></div></div>' +
        alertBanner +
        (rows ? '<details class="group" ' + (j.alerts.length ? 'open' : '') + '><summary class="cursor-pointer text-xs text-zinc-700 hover:text-zinc-950 font-semibold py-1 flex items-center gap-1.5 select-none"><svg class="w-3.5 h-3.5 text-zinc-400 group-open:rotate-90 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>Ver detalle de documentos por cobrar / pagar (' + j.items.length + ')</summary><div class="overflow-x-auto mt-2.5 rounded-[12px] border border-zinc-200/80"><table class="w-full text-xs text-zinc-700"><thead class="bg-zinc-50 border-b border-zinc-200/80"><tr class="text-zinc-500 text-left text-[10.5px] uppercase tracking-wider"><th class="py-2 px-3">Tipo</th><th class="px-3">Folio</th><th class="px-3">Cliente / Proveedor</th><th class="px-3">Vence</th><th class="px-3 text-right">Saldo</th><th class="px-3">Alerta</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></details>' : '');
    } else {
      box.innerHTML = '<div class="flex flex-wrap justify-between items-center mb-3"><h3 class="text-sm font-bold text-zinc-900">Seguimiento de Pagos, Cheques y Vencimientos</h3><div class="text-xs text-zinc-500">Por cobrar <b class="text-zinc-900 font-mono font-semibold">' + clp(j.pendiente_cobrar) + '</b> · Por pagar <b class="text-zinc-900 font-mono font-semibold">' + clp(j.pendiente_pagar) + '</b> · Alertas (10/5/2 días y vencidas): <b class="font-mono">' + j.alerts.length + '</b></div></div>' +
        alertBanner +
        (rows ? '<div class="overflow-x-auto rounded-[12px] border border-zinc-200/80"><table class="w-full text-xs text-zinc-700"><thead class="bg-zinc-50 border-b border-zinc-200/80"><tr class="text-zinc-500 text-left text-[10.5px] uppercase tracking-wider"><th class="py-2 px-3">Tipo</th><th class="px-3">Folio</th><th class="px-3">Cliente / Proveedor</th><th class="px-3">Vence</th><th class="px-3 text-right">Saldo</th><th class="px-3">Alerta</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="text-xs text-zinc-400 py-4 text-center">Sin movimientos registrados para este período.</div>');
    }
  }

  window.renderPaymentsPanel = renderPanel;

  window.payOpenFactoring = function (total, counterparty, folio) {
    var amt = Math.round(total || 0);
    var html = '<div class="space-y-4">' +
      '<div class="flex items-center justify-between border-b border-zinc-200 pb-3">' +
        '<div><div class="text-xs font-bold text-zinc-950 flex items-center gap-2"><span class="text-amber-800 font-bold flex items-center gap-1.5"><svg class="w-4 h-4 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>Simulador Rápido de Factoring</span> · Factura #' + e(folio) + '</div>' +
        '<div class="text-[11px] text-zinc-500 mt-0.5">Deudor: ' + e(counterparty || 'Cliente') + ' · Saldo Cedible: <b class="text-zinc-900 font-mono">' + clp(amt) + '</b></div></div>' +
      '</div>' +
      '<div class="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">' +
        '<div><label class="block text-slate-600 mb-1">Monto a Ceder (CLP)</label><input id="fact-amt" type="number" value="' + amt + '" oninput="payCalcFactoring()" class="' + IN + '"></div>' +
        '<div><label class="block text-slate-600 mb-1">% Anticipo</label><input id="fact-adv" type="number" step="0.5" value="90" oninput="payCalcFactoring()" class="' + IN + '"></div>' +
        '<div><label class="block text-slate-600 mb-1">Tasa Mensual (%)</label><input id="fact-rate" type="number" step="0.1" value="1.8" oninput="payCalcFactoring()" class="' + IN + '"></div>' +
        '<div><label class="block text-slate-600 mb-1">Plazo Estimado (días)</label><input id="fact-days" type="number" value="45" oninput="payCalcFactoring()" class="' + IN + '"></div>' +
        '<div><label class="block text-slate-600 mb-1">Comisión / Gastos (CLP)</label><input id="fact-comm" type="number" value="15000" oninput="payCalcFactoring()" class="' + IN + '"></div>' +
        '<div><label class="block text-slate-600 mb-1">% Retención Custodia</label><input id="fact-ret" type="number" step="0.5" value="10" oninput="payCalcFactoring()" class="' + IN + '"></div>' +
      '</div>' +
      '<div id="fact-results" class="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3"></div>' +
      '<div class="flex justify-end gap-2 pt-2 border-t border-slate-200">' +
        '<button onclick="closePfModal()" class="px-3.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-semibold">Cerrar</button>' +
      '</div>' +
    '</div>';
    pfModal('Simulación Rápida de Factoring', html, true);
    setTimeout(window.payCalcFactoring, 50);
  };

  window.payCalcFactoring = async function () {
    var el = document.getElementById('fact-results');
    if (!el) return;
    var body = {
      invoice_total: parseFloat(document.getElementById('fact-amt')?.value) || 0,
      advance_pct: parseFloat(document.getElementById('fact-adv')?.value) || 90,
      monthly_interest_rate_pct: parseFloat(document.getElementById('fact-rate')?.value) || 1.8,
      operation_days: parseInt(document.getElementById('fact-days')?.value) || 45,
      commission_fixed: parseFloat(document.getElementById('fact-comm')?.value) || 0,
      retention_pct: parseFloat(document.getElementById('fact-ret')?.value) || 10
    };
    try {
      var res = await api('/api/payments/factoring-simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      el.innerHTML =
        '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">' +
          '<div class="bg-white p-2.5 rounded-lg border border-slate-200">' +
            '<div class="text-[10px] text-slate-600 uppercase font-semibold">Anticipo Bruto (' + res.advance_pct + '%)</div>' +
            '<div class="text-sm font-bold text-slate-900 mt-1">' + clp(res.advance_amount) + '</div>' +
          '</div>' +
          '<div class="bg-white p-2.5 rounded-lg border border-slate-200">' +
            '<div class="text-[10px] text-slate-600 uppercase font-semibold">Costo Interés (' + res.operation_days + ' d)</div>' +
            '<div class="text-sm font-bold text-rose-700 mt-1">' + clp(res.interest_cost) + '</div>' +
          '</div>' +
          '<div class="bg-white p-2.5 rounded-lg border border-slate-200">' +
            '<div class="text-[10px] text-slate-600 uppercase font-semibold">Comisión y Gastos</div>' +
            '<div class="text-sm font-bold text-amber-700 mt-1">' + clp(res.commission_total) + '</div>' +
          '</div>' +
          '<div class="bg-white p-2.5 rounded-lg border border-slate-200">' +
            '<div class="text-[10px] text-slate-600 uppercase font-semibold">Retención (' + res.retention_pct + '%)</div>' +
            '<div class="text-sm font-bold text-slate-600 mt-1">' + clp(res.retention_amount) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-3">' +
          '<div>' +
            '<div class="text-[11px] uppercase tracking-wider font-bold text-emerald-700"><svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/></svg> Liquidez Inmediata a Depositar</div>' +
            '<div class="text-2xl font-bold font-heading text-emerald-700 mt-0.5">' + clp(res.immediate_liquid_cash) + '</div>' +
            '<div class="text-[10px] text-emerald-700 mt-0.5">Efectivo disponible en 24h tras cesión electrónica en SII</div>' +
          '</div>' +
          '<div class="text-right sm:text-right border-t sm:border-t-0 sm:border-l border-emerald-200 pt-2 sm:pt-0 sm:pl-4">' +
            '<div class="text-[10px] text-slate-600">Remanente a recibir post-pago:</div>' +
            '<div class="text-xs font-bold text-slate-900">' + clp(res.remaining_settlement) + '</div>' +
            '<div class="text-[10px] text-slate-600 mt-0.5">Costo total financiero: <b class="text-rose-700">' + clp(res.total_financing_cost) + '</b></div>' +
          '</div>' +
        '</div>';
    } catch (err) {
      el.innerHTML = '<div class="text-xs text-rose-700">Error calculando: ' + e(err.message) + '</div>';
    }
  };

  function wrap(name, viewId) {
    var orig = window[name]; if (typeof orig !== 'function') return;
    window[name] = async function () { var r = await orig.apply(this, arguments); try { await renderPanel(viewId); } catch (x) { } return r; };
  }
  wrap('renderDashboard', 'view-dashboard');
  wrap('renderBanking', 'view-banking');
})();
