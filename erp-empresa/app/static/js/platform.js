// ============================================================================
// PLATAFORMA: acceso multi-empresa, productos editables, comparador de proveedores,
// OC / cotizaciones, catálogo con fichas web y generador de catálogos PDF.
// Se carga después de app.js y workspace.js.
// ============================================================================

const PF_IN = 'w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-950 focus:border-blue-500 outline-none';
const PF_BTN = 'px-3 py-1.5 rounded-lg text-xs font-bold transition-colors';
const pf = { auth: { companyId: null, user: null }, cat: { products: [], selected: new Set(), q: '', limit: 48 }, cd: { items: [], filter: '' } };
function pfClp(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-CL'); }
function pfOpt(v) { return v === null || v === undefined ? '' : v; }

// ---------------------------------------------------------------- modal genérico
function pfModal(title, html, wide) {
  closePfModal();
  const d = document.createElement('div');
  d.id = 'pf-modal';
  d.className = 'fixed inset-0 bg-slate-900/45 backdrop-blur-sm z-[60] flex items-center justify-center p-4';
  d.innerHTML = `<div class="bg-white border border-slate-200 rounded-2xl w-full ${wide ? 'max-w-5xl' : 'max-w-lg'} max-h-[92vh] overflow-y-auto shadow-2xl">
    <div class="flex items-center justify-between px-5 py-3 border-b border-slate-200 sticky top-0 bg-white z-10"><h3 class="font-bold text-sm text-slate-950">${title}</h3>
    <button onclick="closePfModal()" class="text-slate-600 hover:text-slate-950 text-lg leading-none"><svg class="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="p-5">${html}</div></div>`;
  document.body.appendChild(d);
  lucide.createIcons();
}
function closePfModal() { const m = document.getElementById('pf-modal'); if (m) m.remove(); }
async function pfJson(url, opts) {
  const res = await fetch(url, opts);
  let body = null;
  try { body = await res.json(); } catch (e) { /* sin cuerpo */ }
  if (!res.ok) throw new Error((body && (body.detail || body.message)) || `Error ${res.status}`);
  return body;
}
const pfJsonOpts = (method, obj) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
async function pfDownload(url, opts, filename) {
  const res = await fetch(url, opts);
  if (!res.ok) { let b = null; try { b = await res.json(); } catch (e) { /* */ } throw new Error((b && b.detail) || `Error ${res.status}`); }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

// ============================================================================
// 1. ACCESO: login + selector de empresa (multi-empresa)
// ============================================================================
let _authResolve = null;
window.__authReady = new Promise(r => { _authResolve = r; });
const _origFetch = window.fetch.bind(window);
let _authShowing = false;
window.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  const isApi = url.indexOf('/api/') === 0;
  const isAuth = url.indexOf('/api/auth/') === 0;
  const isMaster = url.indexOf('/api/companies') === 0;
  if (isApi && !isAuth && !isMaster) await window.__authReady;
  const res = await _origFetch(input, init);
  if (isApi && !isAuth && (res.status === 401 || res.status === 409) && !_authShowing) {
    window.__authReady = new Promise(r => { _authResolve = r; });
    showAuthOverlay(res.status === 401 ? 'login' : 'company');
  }
  return res;
};

function authOverlayShell(inner) {
  let o = document.getElementById('auth-overlay');
  if (!o) { o = document.createElement('div'); o.id = 'auth-overlay'; o.className = 'fixed inset-0 z-[100] bg-slate-50 flex items-center justify-center p-4 overflow-y-auto'; document.body.appendChild(o); }
  o.innerHTML = `<div class="w-full max-w-md">${inner}</div>`;
  lucide.createIcons();
}
function showAuthOverlay(step, companies) {
  _authShowing = true;
  if (step === 'login') return showLoginForm();
  return showCompanySelector(companies);
}
function showLoginForm(err) {
  authOverlayShell(`<div class="text-center mb-6"><div class="inline-flex w-14 h-14 rounded-2xl bg-blue-50 text-blue-700 items-center justify-center mb-3"><i data-lucide="shield-check" class="w-7 h-7"></i></div>
    <h1 class="text-2xl font-heading font-extrabold text-slate-950">ERP Comercial y Operativo</h1><p class="text-xs text-slate-600 mt-1">Inicia sesión para continuar</p></div>
    <form onsubmit="doLogin(event)" class="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-2xl">
      <div><label class="block text-xs font-semibold text-slate-600 mb-1">Usuario</label><input id="login-user" placeholder="Vision" autofocus autocomplete="username" class="${PF_IN} !py-2.5 !text-sm"></div>
      <div><label class="block text-xs font-semibold text-slate-600 mb-1">Contraseña</label><input id="login-pass" type="password" autocomplete="current-password" class="${PF_IN} !py-2.5 !text-sm"></div>
      <div class="text-[11px] text-slate-600 bg-slate-100 border border-slate-200 rounded-lg px-3 py-2">Credencial de acceso: <span class="text-slate-900 font-semibold">Usuario: Vision</span> · <span class="text-slate-900 font-semibold">Clave: Code</span></div>
      ${err ? `<div class="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">${esc(err)}</div>` : ''}
      <button class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg py-2.5 text-sm">Ingresar</button>
    </form>`);
}
async function doLogin(e) {
  e.preventDefault();
  try {
    const r = await pfJson('/api/auth/login', pfJsonOpts('POST', { username: document.getElementById('login-user').value, password: document.getElementById('login-pass').value }));
    pf.auth.user = r.user;
    showCompanySelector(r.companies);
  } catch (err) { showLoginForm(err.message); }
}
async function showCompanySelector(companies) {
  _authShowing = true;
  try {
    if (!companies) { const me = await pfJson('/api/auth/me'); companies = me.companies; pf.auth.user = me.user; }
  } catch (e) { return showLoginForm(); }
  authOverlayShell(`<div class="text-center mb-6"><h1 class="text-xl font-heading font-extrabold text-slate-950">Selecciona la empresa con la que deseas operar</h1>
    <p class="text-xs text-slate-600 mt-1">Cada empresa tiene sus propios DTE, bancos, clientes, proveedores, stock, cotizaciones y carpetas.</p></div>
    <div class="space-y-3">${companies.map(c => `<button onclick="selectCompany(${c.id})" class="w-full text-left bg-white hover:bg-slate-100 border border-slate-200 hover:border-blue-500 rounded-xl p-4 transition-all">
      <div class="font-bold text-slate-950">${esc(c.razon_social)}</div><div class="text-xs text-slate-600 font-mono mt-0.5">${esc(c.rut)}</div><div class="text-[11px] text-slate-500 mt-1">${esc(c.giro || '')}</div></button>`).join('') || '<p class="text-sm text-slate-600 text-center">No hay empresas habilitadas para este usuario.</p>'}</div>
    <button onclick="doLogout()" class="mt-5 w-full text-xs text-slate-500 hover:text-slate-900">Cerrar sesión</button>`);
}
async function selectCompany(id) {
  try {
    await pfJson('/api/auth/select-company', pfJsonOpts('POST', { company_id: id }));
    pf.auth.companyId = id;
    if (window.__firstLoadDone) { location.reload(); return; }
    const o = document.getElementById('auth-overlay'); if (o) o.remove();
    _authShowing = false;
    _authResolve();
  } catch (e) { showToast(e.message, 'error'); }
}
async function doLogout() { try { await pfJson('/api/auth/logout', { method: 'POST' }); } catch (e) { /* */ } location.reload(); }
function switchCompanyUI() { showCompanySelector(); }
async function changePasswordUI() {
  const cur = prompt('Contraseña actual:'); if (cur === null) return;
  const nw = prompt('Nueva contraseña (mínimo 6 caracteres):'); if (nw === null) return;
  try { const r = await pfJson('/api/auth/change-password', pfJsonOpts('POST', { current_password: cur, new_password: nw })); showToast(r.message); }
  catch (e) { showToast(e.message, 'error'); }
}

(async function initAuth() {
  try {
    const me = await pfJson('/api/auth/me');
    pf.auth.user = me.user;
    if (me.active_company) { pf.auth.companyId = me.active_company.id; _authResolve(); }
    else showAuthOverlay('company', me.companies);
  } catch (e) { showAuthOverlay('login'); }
})();

// la empresa activa manda sobre la "predeterminada" en todo el front
(function patchLoadCompanies() {
  const orig = window.loadCompanies;
  window.loadCompanies = async function () {
    await orig();
    window.__firstLoadDone = true;
    const act = (state.companies || []).find(c => c.id === pf.auth.companyId);
    if (act) {
      state.currentCompany = act;
      const n = document.getElementById('header-company-name'); if (n) n.textContent = act.razon_social;
      const r = document.getElementById('header-company-rut'); if (r) r.textContent = act.rut;
    }
  };
})();

// ============================================================================
// 2. PRODUCTOS: una fila por artículo, todo editable
// ============================================================================
function tabProductos() {
  const items = ws.data.items;
  const pending = items.filter(i => !i.in_quotation).length;
  let totCost = 0, totSale = 0;
  items.forEach(i => { totCost += (i.estimated_cost || 0) * (i.quantity || 0); totSale += (i.offered_price || 0) * (i.quantity || 0); });
  const mg = totSale > 0 ? ((totSale - totCost) / totSale * 100) : null;
  const row = (i) => {
    const m = i.offered_price > 0 ? ((i.offered_price - i.estimated_cost) / i.offered_price * 100) : null;
    return `<div class="rounded-xl border ${i.status === 'CONFIRMADO' ? 'border-slate-200' : 'border-amber-200'} bg-slate-50 p-3 space-y-2">
      <div class="grid grid-cols-12 gap-2 items-end text-xs">
        <div class="col-span-12 md:col-span-4"><label class="text-[10px] uppercase font-bold text-slate-500">Producto #${i.item_number}</label>
          <input value="${esc(i.product_name)}" onchange="wsItemEdit(${i.id}, 'product_name', this.value)" class="${PF_IN} font-bold"></div>
        <div class="col-span-3 md:col-span-1"><label class="text-[10px] uppercase font-bold text-slate-500">Cant.</label>
          <input type="number" min="0" step="any" value="${i.quantity}" onchange="wsItemEdit(${i.id}, 'quantity', this.value)" class="${PF_IN} text-right"></div>
        <div class="col-span-3 md:col-span-1"><label class="text-[10px] uppercase font-bold text-slate-500">Unidad</label>
          <input value="${esc(i.unit)}" onchange="wsItemEdit(${i.id}, 'unit', this.value)" class="${PF_IN}"></div>
        <div class="col-span-6 md:col-span-2"><label class="text-[10px] uppercase font-bold text-amber-700">Costo unit. (neto)</label>
          <input type="number" min="0" step="any" value="${i.estimated_cost || ''}" placeholder="0" onchange="wsItemEdit(${i.id}, 'estimated_cost', this.value)" class="${PF_IN} text-right text-amber-700"></div>
        <div class="col-span-6 md:col-span-2"><label class="text-[10px] uppercase font-bold text-emerald-700">Precio venta unit.</label>
          <input type="number" min="0" step="any" value="${i.offered_price || ''}" placeholder="0" onchange="wsItemEdit(${i.id}, 'offered_price', this.value)" class="${PF_IN} text-right"></div>
        <div class="col-span-6 md:col-span-2 flex items-center justify-end gap-1.5">
          <span class="text-[11px] font-bold ${m === null ? 'text-slate-500' : (m < 10 ? 'text-rose-700' : 'text-emerald-700')}">${m === null ? '—' : m.toFixed(1) + '%'}</span>
          <button title="Dividir en filas individuales" onclick="wsSplitOpen(${i.id})" class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-900 text-[11px] font-bold">Dividir</button>
          <button title="Eliminar" onclick="wsItemDelete(${i.id})" class="px-1.5 py-1 text-slate-500 hover:text-rose-700"><svg class="w-3.5 h-3.5 inline text-zinc-400 hover:text-rose-600 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div>
      </div>
      <div><label class="text-[10px] uppercase font-bold text-slate-500">Ficha técnica / especificaciones (editable, una por línea)</label>
        <textarea rows="${Math.min(10, Math.max(3, (i.technical_specs || '').split('\n').length))}" onchange="wsItemEdit(${i.id}, 'technical_specs', this.value)" class="${PF_IN} leading-relaxed">${esc(i.technical_specs || '')}</textarea></div>
      <div class="flex items-center justify-between text-[10px] text-slate-500"><span>${esc(i.source_doc || '')}${i.source_page ? ' · pág. ' + i.source_page : ''} · SKU <b class="${i.matched_sku === 'POR COTIZAR' ? 'text-amber-700' : 'text-emerald-700'}">${esc(i.matched_sku || '')}</b></span>
        ${i.in_quotation ? '<span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold">En cotización</span>' : `<button onclick="wsItemEdit(${i.id}, 'confirmed', ${i.status === 'CONFIRMADO' ? 'false' : 'true'})" class="px-2 py-0.5 rounded font-bold ${i.status === 'CONFIRMADO' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}">${i.status === 'CONFIRMADO' ? '<svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Confirmado' : 'Por revisar · confirmar'}</button>`}</div></div>`;
  };
  return `<div class="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div><h3 class="font-bold text-sm text-slate-950">Productos solicitados (una fila por artículo)</h3>
        <p class="text-xs text-slate-600">Edita nombre, cantidad, costo, precio y ficha técnica. Si una fila agrupa varias prendas, usa <b>Dividir</b>.</p></div>
      <div class="flex gap-2"><button onclick="wsItemAddBlank()" class="${PF_BTN} bg-slate-100 hover:bg-slate-200 text-slate-950">+ Agregar fila</button>
        <button onclick="wsSetTab('comparador')" class="${PF_BTN} bg-indigo-600 hover:bg-indigo-500 text-slate-950">Comparar proveedores</button>
        <button onclick="wsItemsToQuotation()" ${pending ? '' : 'disabled'} class="${PF_BTN} ${pending ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-100 text-slate-500 cursor-not-allowed'}">Pasar ${pending} a la cotización →</button></div></div>
    ${items.length ? `<div class="space-y-3">${items.map(row).join('')}</div>
      <div class="flex justify-end gap-6 text-xs border-t border-slate-200 pt-3"><span class="text-slate-600">Costo total <b class="text-amber-700">${pfClp(totCost)}</b></span><span class="text-slate-600">Venta total <b class="text-slate-950">${pfClp(totSale)}</b></span><span class="text-slate-600">Margen <b class="${mg === null ? 'text-slate-500' : 'text-emerald-700'}">${mg === null ? '—' : mg.toFixed(1) + '%'}</b></span></div>`
      : '<p class="text-xs text-slate-500 py-6 text-center">Aún no hay productos. Sube las bases técnicas o agrega una fila manualmente.</p>'}
  </div>`;
}
async function wsItemDelete(id) {
  if (!confirm('¿Eliminar este producto?')) return;
  try { await wsApi(`/api/workspace/items/${id}`, { method: 'DELETE' }); await loadWorkspace(); } catch (e) { showToast(e.message, 'error'); }
}
async function wsItemAddBlank() {
  try { await wsApi(`/api/workspace/${ws.id}/items`, jsonOpts('POST', { product_name: 'Nuevo producto', quantity: 1 })); await loadWorkspace(); }
  catch (e) { showToast(e.message, 'error'); }
}
function wsSplitOpen(id) {
  const it = ws.data.items.find(i => i.id === id);
  const guess = String(it.product_name).split(/\s*,\s*|\s+y\s+|\s+e\s+/).map(s => s.trim()).filter(Boolean);
  pfModal('Dividir en filas individuales', `<p class="text-xs text-slate-600 mb-2">Escribe un artículo por línea. Cada uno quedará como fila independiente con la misma cantidad; las especificaciones se reparten según el nombre (las generales se copian a todos).</p>
    <textarea id="split-names" rows="6" class="${PF_IN}">${esc((guess.length > 1 ? guess : [it.product_name, '']).join('\n'))}</textarea>
    <div class="flex justify-between mt-4"><button onclick="wsSplitDo(${id}, true)" class="${PF_BTN} bg-slate-100 text-slate-950 hover:bg-slate-200" title="Usa la IA configurada para identificar los artículos">Detectar con IA</button>
    <button onclick="wsSplitDo(${id}, false)" class="${PF_BTN} bg-blue-600 hover:bg-blue-700 text-white">Dividir</button></div>`);
}
async function wsSplitDo(id, auto) {
  const names = auto ? [] : document.getElementById('split-names').value.split('\n').map(s => s.trim()).filter(Boolean);
  try { const r = await wsApi(`/api/workspace/items/${id}/split`, jsonOpts('POST', { names })); closePfModal(); showToast(r.message); await loadWorkspace(); }
  catch (e) { showToast(e.message, 'error'); }
}

// ============================================================================
// 3. COMPARADOR DE PROVEEDORES (pestaña de la carpeta)
// ============================================================================
if (!WS_TABS.some(t => t[0] === 'comparador')) WS_TABS.splice(2, 0, ['comparador', 'Comparar Proveedores', 'scale']);
ws.cmp = null;
const _origWsSetTab = wsSetTab;
wsSetTab = function (t) {
  ws.tab = t;
  if (t === 'comparador') { loadComparison(); return; }
  renderWorkspace();
};
const _origRenderWsTab = renderWsTab;
renderWsTab = function () {
  if (ws.tab === 'comparador') {
    const el = document.getElementById('ws-tab-content');
    el.innerHTML = tabComparador(); lucide.createIcons(); return;
  }
  _origRenderWsTab();
};
async function loadComparison() {
  try { ws.cmp = await wsApi(`/api/supplier-quotes/${ws.id}/comparison`); } catch (e) { showToast(e.message, 'error'); ws.cmp = null; }
  renderWorkspace();
}
function tabComparador() {
  const c = ws.cmp;
  if (!c) return '<p class="text-xs text-slate-500 p-6">Cargando comparador…</p>';
  const items = ws.data.items || [];
  const sups = c.suppliers || [];
  const summaries = c.supplier_summaries || {};
  const totals = c.totals || {};

  const head = `<div class="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
      <div>
        <h3 class="font-bold text-sm text-slate-950 flex items-center gap-2">
          <span><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h18"/></svg> Cuadro Comparativo Dinámico de Proveedores & Análisis de Costos</span>
        </h3>
        <p class="text-xs text-slate-600 mt-0.5">
          Matriz de costos unitarios y totales por proveedor con detección automática de Mejor Precio y porcentajes de variación relativa.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <label class="${PF_BTN} bg-blue-600 hover:bg-blue-700 text-white cursor-pointer shadow flex items-center gap-1.5">
          <span><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span> Subir Cotización (PDF / Excel)
          <input type="file" accept=".pdf,.xlsx,.docx,.txt" class="hidden" onchange="cmpUpload(this.files)">
        </label>
        <button onclick="cmpAddSupplierPrompt()" class="${PF_BTN} bg-slate-100 hover:bg-slate-200 text-slate-900 border border-slate-300 flex items-center gap-1">
          <span><svg class="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></span> Agregar Proveedor
        </button>
        <button onclick="cmpManualOpen()" class="${PF_BTN} bg-slate-100 hover:bg-slate-200 text-slate-900 border border-slate-300">
          <span><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 2 4 4-12 12H6v-4L18 2z"/><path d="m14 6 4 4"/></svg></span> Ingreso Manual
        </button>
        <button onclick="cmpSelectBest()" class="${PF_BTN} bg-emerald-600 hover:bg-emerald-700 text-white shadow flex items-center gap-1" title="Selecciona automáticamente el mejor precio de cada producto">
          <span><svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></span> Elegir Menor Costo en Todos
        </button>
        <button onclick="cmpApplyToQuotation()" class="${PF_BTN} bg-amber-600 hover:bg-amber-700 text-white shadow flex items-center gap-1" title="Traslada los costos de compra seleccionados directamente a la cotización de venta">
          <span><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg></span> Aplicar al Cotizador
        </button>
        <button onclick="cmpMakePO()" class="${PF_BTN} bg-indigo-600 hover:bg-indigo-700 text-white shadow flex items-center gap-1">
          <span><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M16 8h-6"/><path d="M16 12h-6"/><path d="M14 16h-4"/></svg></span> Generar OC
        </button>
      </div>
    </div>`;

  if (!items.length) {
    return head + '<p class="text-xs text-slate-500 py-8 text-center">Primero agrega productos en la pestaña "Productos y Especificaciones" para poder compararlos.</p></div>';
  }

  if (!sups.length) {
    return head + `
      <div class="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-8 text-center space-y-3">
        <div class="text-3xl"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg></div>
        <h4 class="font-bold text-sm text-slate-900">Aún no hay cotizaciones de proveedores registradas</h4>
        <p class="text-xs text-slate-600 max-w-md mx-auto">
          Sube los presupuestos de tus proveedores (PDF o Excel) o agrega columnas de proveedores manualmente para calcular automáticamente los porcentajes de variación y mejor costo.
        </p>
        <div class="pt-2 flex justify-center gap-2">
          <label class="${PF_BTN} bg-blue-600 hover:bg-blue-700 text-white cursor-pointer">Subir Cotización (PDF / Excel)<input type="file" accept=".pdf,.xlsx,.docx,.txt" class="hidden" onchange="cmpUpload(this.files)"></label>
          <button onclick="cmpAddSupplierPrompt()" class="${PF_BTN} bg-slate-100 hover:bg-slate-200 text-slate-900">+ Agregar Primer Proveedor</button>
        </div>
      </div>
    </div>`;
  }

  const table = `
    <div class="overflow-x-auto rounded-xl border border-slate-200 shadow-lg">
      <table class="w-full text-xs text-left border-collapse">
        <thead class="text-[11px] uppercase tracking-wider text-slate-600 bg-slate-50 border-b border-slate-200">
          <tr>
            <th class="py-3 px-3 min-w-[200px] border-r border-slate-200 sticky left-0 bg-slate-50 z-10">Producto / Especificación</th>
            <th class="py-3 px-2 text-center border-r border-slate-200 w-24">Cantidad</th>
            <th class="py-3 px-3 text-right border-r border-slate-200 min-w-[130px] bg-white">
              <div class="text-emerald-700 font-bold">Mejor Precio</div>
              <div class="text-[10px] text-slate-500 font-normal normal-case">(Base 0%)</div>
            </th>
            ${sups.map(s => `
              <th class="py-3 px-3 text-center border-r border-slate-200 min-w-[175px] bg-slate-50">
                <div class="font-bold text-slate-950 flex items-center justify-between gap-1">
                  <span class="truncate" title="${esc(s)}">${esc(s)}</span>
                  <button onclick="cmpDeleteSupplierQuotes('${esc(s).replace(/'/g, "\\'")}')" class="text-slate-600 hover:text-rose-700 text-xs px-1" title="Eliminar cotizaciones de ${esc(s)}"><svg class="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </div>
                <div class="text-[10px] text-slate-600 font-normal normal-case mt-0.5">P. Unit. / Total Neto</div>
              </th>
            `).join('')}
            <th class="py-3 px-3 text-center min-w-[160px] bg-white">
              <div class="text-blue-700 font-bold">Compra Seleccionada</div>
              <div class="text-[10px] text-slate-600 font-normal normal-case">Proveedor Elegido</div>
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-200 bg-white">
          ${c.rows.map(r => {
            const hasMin = r.min_price !== null && r.min_price > 0;
            return `
              <tr class="hover:bg-slate-200 transition-colors align-top">
                <!-- Producto / Especificación -->
                <td class="py-2.5 px-3 border-r border-slate-200 sticky left-0 bg-white z-10">
                  <div class="font-bold text-slate-950">${esc(r.name)}</div>
                  ${r.technical_specs ? `<div class="text-[11px] text-slate-600 mt-0.5 line-clamp-2" title="${esc(r.technical_specs)}">${esc(r.technical_specs)}</div>` : ''}
                </td>

                <!-- Cantidad y Unidad -->
                <td class="py-2.5 px-2 text-center border-r border-slate-200 font-semibold text-slate-700">
                  ${r.quantity} <span class="text-[10px] text-slate-500">${esc(r.unit)}</span>
                </td>

                <!-- Mejor Precio (Base 0%) -->
                <td class="py-2.5 px-3 text-right border-r border-slate-200 bg-emerald-50">
                  ${hasMin ? `
                    <div class="font-bold text-emerald-700 text-sm">${pfClp(r.min_price)}</div>
                    <div class="text-[10px] text-slate-600 font-medium">Tot: ${pfClp(r.min_total)}</div>
                  ` : '<span class="text-slate-600 italic">Sin cotizar</span>'}
                </td>

                <!-- Celdas Dinámicas por Proveedor -->
                ${sups.map(s => {
                  const cell = r.cells[s];
                  if (!cell) {
                    return `
                      <td class="py-2.5 px-2 text-center border-r border-slate-200">
                        <button onclick="cmpQuickPricePrompt(${r.item_id}, '${esc(s).replace(/'/g, "\\'")}', 0)" class="text-[11px] text-slate-500 hover:text-blue-700 hover:border-blue-500/40 border border-dashed border-slate-200 rounded-lg px-2 py-1.5 transition-colors" title="Ingresar precio de ${esc(s)}">
                          + Cotizar
                        </button>
                      </td>
                    `;
                  }

                  const isBest = cell.is_best;
                  const isSel = cell.is_selected;
                  const borderCls = isSel ? 'border-blue-300 bg-blue-50 ring-1 ring-blue-500/50' : (isBest ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50');

                  return `
                    <td class="py-2 px-2 border-r border-slate-200">
                      <div class="rounded-xl border ${borderCls} p-2 text-center space-y-1 group relative">
                        <div class="flex items-center justify-between gap-1">
                          <span class="text-[10px] text-slate-600 font-mono">Neto</span>
                          <button onclick="cmpQuickPricePrompt(${r.item_id}, '${esc(s).replace(/'/g, "\\'")}', ${cell.unit_price})" class="text-slate-600 hover:text-blue-700 text-[10px]" title="Editar precio"><svg class="w-3.5 h-3.5 inline text-zinc-400 hover:text-zinc-700 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                        </div>
                        <div class="font-bold text-sm ${isBest ? 'text-emerald-700' : 'text-slate-950'}">
                          ${pfClp(cell.unit_price)}
                        </div>
                        <div class="text-[10px] text-slate-600">
                          Total: <b class="text-slate-900">${pfClp(cell.total_cost)}</b>
                        </div>

                        <!-- Badge Porcentaje de Variación -->
                        <div class="pt-0.5">
                          ${isBest ? `
                            <span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> MEJOR PRECIO (0%)
                            </span>
                          ` : `
                            <span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              +${cell.diff_pct}% más caro
                            </span>
                          `}
                        </div>

                        <!-- Selector de Compra -->
                        <div class="pt-1 border-t border-slate-200">
                          ${isSel ? `
                            <span class="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                              <svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Elegido
                            </span>
                          ` : `
                            <button onclick="cmpSelect(${cell.line_id})" class="text-[10px] text-slate-600 hover:text-blue-700 underline transition-colors">
                              Elegir para compra
                            </button>
                          `}
                        </div>
                      </div>
                    </td>
                  `;
                }).join('')}

                <!-- Columna Compra Seleccionada -->
                <td class="py-2.5 px-3 bg-white text-center">
                  <select onchange="cmpSelectSupplierForItem(${r.item_id}, this.value)" class="w-full bg-white border ${r.selected_supplier ? 'border-blue-300 text-blue-700' : 'border-slate-300 text-slate-600'} rounded-lg px-2 py-1.5 text-xs font-semibold focus:outline-none">
                    <option value="">-- Sin Elegir --</option>
                    ${sups.filter(s => r.cells[s]).map(s => `
                      <option value="${esc(s)}" ${r.selected_supplier === s ? 'selected' : ''}>
                        ${esc(s)} (${pfClp(r.cells[s].unit_price)})
                      </option>
                    `).join('')}
                  </select>
                  ${r.selected_supplier && r.cells[r.selected_supplier] ? `
                    <div class="text-[10px] text-slate-600 mt-1">
                      Costo Total: <b class="text-emerald-700">${pfClp(r.cells[r.selected_supplier].total_cost)}</b>
                    </div>
                  ` : ''}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>

        <!-- PIE DE TABLA: RESUMEN Y TOTALES CONSOLIDADOS -->
        <tfoot class="bg-slate-50 border-t-2 border-slate-200 divide-y divide-slate-200 text-xs">
          <!-- 1. Total Neto -->
          <tr class="font-semibold">
            <td class="py-3 px-3 text-slate-900 border-r border-slate-200 sticky left-0 bg-slate-50 z-10 uppercase tracking-wider text-[11px] font-bold">
              Total Neto Cotizado
            </td>
            <td class="py-3 px-2 border-r border-slate-200 text-center text-slate-500">—</td>
            <td class="py-3 px-3 text-right border-r border-slate-200 bg-emerald-50 font-bold text-emerald-700 text-sm">
              ${pfClp(totals.best_mixed_net)}
            </td>
            ${sups.map(s => {
              const sm = summaries[s] || {};
              return `
                <td class="py-3 px-3 text-center border-r border-slate-200 font-bold text-sm ${sm.is_best_global ? 'text-emerald-700' : 'text-slate-950'}">
                  ${sm.total_net ? pfClp(sm.total_net) : '—'}
                </td>
              `;
            }).join('')}
            <td class="py-3 px-3 text-center font-bold text-sm text-blue-700 bg-white">
              ${pfClp(totals.selected_net)}
            </td>
          </tr>

          <!-- 2. IVA (19%) -->
          <tr class="text-slate-600 text-[11px]">
            <td class="py-2 px-3 border-r border-slate-200 sticky left-0 bg-slate-50 z-10 font-semibold">
              IVA (19%) Crédito Fiscal
            </td>
            <td class="py-2 px-2 border-r border-slate-200 text-center">—</td>
            <td class="py-2 px-3 text-right border-r border-slate-200 bg-emerald-50 font-medium text-emerald-700">
              ${pfClp(totals.best_mixed_iva)}
            </td>
            ${sups.map(s => {
              const sm = summaries[s] || {};
              return `
                <td class="py-2 px-3 text-center border-r border-slate-200 text-slate-700">
                  ${sm.iva_19 ? pfClp(sm.iva_19) : '—'}
                </td>
              `;
            }).join('')}
            <td class="py-2 px-3 text-center text-blue-700 bg-white">
              ${pfClp(totals.selected_iva)}
            </td>
          </tr>

          <!-- 3. Total Bruto -->
          <tr class="font-bold text-slate-950 text-xs bg-white">
            <td class="py-2.5 px-3 border-r border-slate-200 sticky left-0 bg-slate-50 z-10 font-bold uppercase text-[11px]">
              Total Bruto (Facturado)
            </td>
            <td class="py-2.5 px-2 border-r border-slate-200 text-center">—</td>
            <td class="py-2.5 px-3 text-right border-r border-slate-200 bg-emerald-50 text-emerald-700 text-sm">
              ${pfClp(totals.best_mixed_bruto)}
            </td>
            ${sups.map(s => {
              const sm = summaries[s] || {};
              return `
                <td class="py-2.5 px-3 text-center border-r border-slate-200 ${sm.is_best_global ? 'text-emerald-700' : 'text-slate-900'}">
                  ${sm.total_bruto ? pfClp(sm.total_bruto) : '—'}
                </td>
              `;
            }).join('')}
            <td class="py-2.5 px-3 text-center text-emerald-700 bg-white">
              ${pfClp(totals.selected_bruto)}
            </td>
          </tr>

          <!-- 4. Variación Global -->
          <tr>
            <td class="py-2.5 px-3 border-r border-slate-200 sticky left-0 bg-slate-50 z-10 text-[11px] font-semibold text-slate-600">
              Variación Global vs Mejor Oferta
            </td>
            <td class="py-2.5 px-2 border-r border-slate-200 text-center">—</td>
            <td class="py-2.5 px-3 text-right border-r border-slate-200 bg-emerald-50 text-[10px] text-emerald-700 font-extrabold">
              Mix Óptimo
            </td>
            ${sups.map(s => {
              const sm = summaries[s] || {};
              if (!sm.total_net) {
                return '<td class="py-2.5 px-3 text-center border-r border-slate-200 text-slate-600">—</td>';
              }
              if (sm.is_best_global) {
                return `
                  <td class="py-2.5 px-3 text-center border-r border-slate-200">
                    <span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg> MÁS ECONÓMICO (0%)
                    </span>
                  </td>
                `;
              }
              return `
                <td class="py-2.5 px-3 text-center border-r border-slate-200">
                  <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                    +${sm.diff_global_pct}% global
                  </span>
                </td>
              `;
            }).join('')}
            <td class="py-2.5 px-3 text-center bg-white text-[10px] text-blue-700 font-bold">
              Selección Activa
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- BANNER DE RESUMEN EJECUTIVO -->
    <div class="bg-gradient-to-r from-slate-50 via-white to-white rounded-xl border border-slate-200 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
      <div class="space-y-1">
        <div class="font-bold text-slate-900 flex items-center gap-2">
          <span><svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5"/></svg> Resumen de Adquisición:</span>
          <span class="text-slate-600 font-normal">Comparando ${sups.length} proveedores para ${items.length} productos</span>
        </div>
        <div class="text-slate-600 text-[11px]">
          Monto Total Seleccionado para Compra: <b class="text-emerald-700">${pfClp(totals.selected_net)} Neto</b> (${pfClp(totals.selected_bruto)} Bruto).
        </div>
      </div>
      <div class="flex items-center gap-3">
        <button onclick="cmpApplyToQuotation()" class="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow flex items-center gap-1.5">
          <span><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg></span> Fijar Costos en Cotizador de Venta
        </button>
      </div>
    </div>
  `;

  const un = c.unassigned && c.unassigned.length ? `
    <div class="border-t border-slate-200 pt-4 space-y-2">
      <div class="text-xs font-bold text-amber-700 flex items-center gap-1.5">
        <span><svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Líneas leídas sin asociar a un producto (${c.unassigned.length}):</span>
      </div>
      ${c.unassigned.map(l => `
        <div class="flex flex-wrap items-center gap-2 text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5">
          <span class="text-slate-600 font-semibold w-32 truncate">${esc(l.supplier_name)}</span>
          <span class="text-slate-900 flex-1 min-w-[160px]">${esc(l.description || l.sku || '')}</span>
          <b class="text-amber-700 font-mono">${pfClp(l.unit_price)}</b>
          <select onchange="cmpAssign(${l.id}, this.value)" class="${PF_IN} !w-48">
            <option value="">Asociar a producto…</option>
            ${items.map(i => `<option value="${i.id}">${esc(i.product_name)}</option>`).join('')}
          </select>
          <button onclick="cmpDelete(${l.id})" class="text-slate-500 hover:text-rose-700 px-1"><svg class="w-3.5 h-3.5 inline text-zinc-400 hover:text-rose-600 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </div>
      `).join('')}
    </div>
  ` : '';

  return head + table + un + '</div>';
}

async function cmpQuickPricePrompt(itemId, supplierName, currentPrice) {
  const p = prompt(`Precio Unitario NETO para ${supplierName} ($):`, currentPrice > 0 ? Math.round(currentPrice) : '');
  if (p === null) return;
  const num = parseFloat(String(p).replace(/[^\d.-]/g, '')) || 0;
  try {
    await wsApi(`/api/supplier-quotes/${ws.id}/quick-price`, jsonOpts('POST', {
      requested_item_id: itemId,
      supplier_name: supplierName,
      unit_price: num
    }));
    showToast('Precio actualizado');
    await loadComparison();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function cmpAddSupplierPrompt() {
  const name = prompt('Nombre del Proveedor a agregar a la Matriz Comparativa:');
  if (!name || !name.trim()) return;
  const supName = name.trim();
  const firstItem = ws.data?.items?.[0];
  if (!firstItem) {
    showToast('No hay productos en la carpeta', 'error');
    return;
  }
  const p = prompt(`Precio Unitario NETO para "${supName}" en el producto "${firstItem.product_name}" (opcional, o 0 para comenzar):`, '0');
  const num = parseFloat(String(p || 0).replace(/[^\d.-]/g, '')) || 0;
  try {
    await wsApi(`/api/supplier-quotes/${ws.id}/quick-price`, jsonOpts('POST', {
      requested_item_id: firstItem.id,
      supplier_name: supName,
      unit_price: num
    }));
    showToast(`Proveedor ${supName} agregado al comparador`);
    await loadComparison();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function cmpSelectSupplierForItem(itemId, supplierName) {
  if (!supplierName) return;
  try {
    await wsApi(`/api/supplier-quotes/${ws.id}/select-item-supplier`, jsonOpts('POST', {
      requested_item_id: itemId,
      supplier_name: supplierName
    }));
    showToast(`Proveedor ${supplierName} seleccionado para compra`);
    await loadWorkspace();
    await loadComparison();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function cmpApplyToQuotation() {
  try {
    const res = await wsApi(`/api/supplier-quotes/${ws.id}/apply-selected-to-quotation`, { method: 'POST' });
    showToast(res.message);
    await loadWorkspace();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function cmpDeleteSupplierQuotes(supplierName) {
  if (!confirm(`¿Eliminar todas las cotizaciones de "${supplierName}" en esta carpeta?`)) return;
  try {
    const lines = ws.cmp?.rows ? [].concat(...ws.cmp.rows.map(r => r.cells[supplierName]?.line_id).filter(Boolean)) : [];
    for (const lid of lines) {
      await wsApi(`/api/supplier-quotes/lines/${lid}`, { method: 'DELETE' });
    }
    showToast(`Cotizaciones de ${supplierName} eliminadas`);
    await loadComparison();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function cmpUpload(files) {
  const f = files && files[0]; if (!f) return;
  const fd = new FormData(); fd.append('file', f);
  showToast('Leyendo cotización…', 'info');
  try { const r = await wsApi(`/api/supplier-quotes/${ws.id}/upload-pdf`, { method: 'POST', body: fd }); showToast(r.message); await loadComparison(); }
  catch (e) { showToast(e.message, 'error'); }
}
function cmpManualOpen() {
  pfModal('Ingresar cotización de proveedor', `<form onsubmit="cmpManualSave(event)" class="grid grid-cols-2 gap-3 text-xs">
    <div class="col-span-2 md:col-span-1"><label class="block text-slate-600 mb-1">Proveedor *</label><input name="supplier_name" required class="${PF_IN}"></div>
    <div class="col-span-2 md:col-span-1"><label class="block text-slate-600 mb-1">RUT</label><input name="supplier_rut" placeholder="76.123.456-7" class="${PF_IN}"></div>
    <div class="col-span-2"><label class="block text-slate-600 mb-1">Producto de la carpeta</label><select name="requested_item_id" class="${PF_IN}"><option value="">(sin asociar)</option>${ws.data.items.map(i => `<option value="${i.id}">${esc(i.product_name)}</option>`).join('')}</select></div>
    <div><label class="block text-slate-600 mb-1">SKU proveedor</label><input name="sku" class="${PF_IN}"></div>
    <div><label class="block text-slate-600 mb-1">Plazo de entrega (días)</label><input name="lead_time_days" type="number" min="0" class="${PF_IN}"></div>
    <div class="col-span-2"><label class="block text-slate-600 mb-1">Descripción</label><input name="description" class="${PF_IN}"></div>
    <div><label class="block text-slate-600 mb-1">Precio unitario neto *</label><input name="unit_price" type="number" min="0" step="any" required class="${PF_IN}"></div>
    <div><label class="block text-slate-600 mb-1">Cantidad cotizada</label><input name="quantity" type="number" min="0" step="any" class="${PF_IN}"></div>
    <div class="col-span-2 flex justify-end"><button class="${PF_BTN} bg-blue-600 hover:bg-blue-700 text-white">Guardar</button></div></form>`);
}
async function cmpManualSave(e) {
  e.preventDefault(); const f = e.target;
  const body = { supplier_name: f.supplier_name.value, supplier_rut: f.supplier_rut.value, sku: f.sku.value, description: f.description.value,
    unit_price: parseFloat(f.unit_price.value) || 0, quantity: parseFloat(f.quantity.value) || 0,
    lead_time_days: f.lead_time_days.value ? parseInt(f.lead_time_days.value, 10) : null, requested_item_id: f.requested_item_id.value ? parseInt(f.requested_item_id.value, 10) : null };
  try { await wsApi(`/api/supplier-quotes/${ws.id}/lines`, jsonOpts('POST', body)); closePfModal(); showToast('Cotización guardada'); await loadComparison(); }
  catch (err) { showToast(err.message, 'error'); }
}
async function cmpSelect(lineId) { try { const r = await wsApi(`/api/supplier-quotes/lines/${lineId}/select`, { method: 'POST' }); showToast(r.message); await loadWorkspace(); await loadComparison(); } catch (e) { showToast(e.message, 'error'); } }
async function cmpSelectBest() { try { const r = await wsApi(`/api/supplier-quotes/${ws.id}/select-best`, { method: 'POST' }); showToast(r.message); await loadWorkspace(); await loadComparison(); } catch (e) { showToast(e.message, 'error'); } }
async function cmpMakePO() { try { const r = await wsApi(`/api/commercial-docs/oc-from-selection/${ws.id}`, { method: 'POST' }); showToast(r.message); } catch (e) { showToast(e.message, 'error'); } }
async function cmpDelete(id) { try { await wsApi(`/api/supplier-quotes/lines/${id}`, { method: 'DELETE' }); await loadComparison(); } catch (e) { showToast(e.message, 'error'); } }
async function cmpAssign(lineId, itemId) {
  if (!itemId) return;
  const l = ws.cmp.unassigned.find(x => x.id === lineId);
  try { await wsApi(`/api/supplier-quotes/lines/${lineId}`, jsonOpts('PUT', { supplier_name: l.supplier_name, supplier_rut: l.supplier_rut, sku: l.sku, description: l.description, unit_price: l.unit_price, quantity: l.quantity, lead_time_days: l.lead_time_days, quote_ref: l.quote_ref, notes: l.notes, requested_item_id: parseInt(itemId, 10) })); await loadComparison(); }
  catch (e) { showToast(e.message, 'error'); }
}

// ============================================================================
// 4. ANEXOS: autocompletar con la empresa activa + firma/timbre con un clic
// ============================================================================
async function openAnnexSign(docId) {
  try {
    annexDocId = docId;
    const doc = await wsApi(`/api/workspace/documents/${docId}`);
    let company = state.currentCompany || {};
    try { if (pf.auth.companyId) company = await wsApi(`/api/companies/${pf.auth.companyId}`); } catch (e) { /* usa lo cargado */ }
    let form = {}; try { form = JSON.parse(doc.form_data_json || '{}'); } catch (e) { /* vacío */ }
    const signer = (ws.data && ws.data.signer) || {};
    document.getElementById('anexo-doc-title').textContent = doc.name;
    const fields = [
      ['razon_social', 'Razón social oferente', form.razon_social || company.razon_social || ''],
      ['rut', 'RUT oferente', form.rut || company.rut || ''],
      ['giro', 'Giro', form.giro || company.giro || ''],
      ['rep_legal', 'Representante legal', form.rep_legal || signer.name || ''],
      ['rut_rep', 'RUT representante', form.rut_rep || signer.rut || ''],
      ['direccion', 'Domicilio', form.direccion || [company.direccion, company.comuna, company.ciudad].filter(Boolean).join(', ')],
      ['telefono', 'Teléfono', form.telefono || company.telefono || ''],
      ['email', 'Correo electrónico', form.email || company.email || '']
    ];
    document.getElementById('anexo-form-fields').innerHTML = `<div class="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-2"><svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Campos autocompletados con los datos de <b>${esc(company.razon_social || 'la empresa activa')}</b>. Puedes ajustarlos antes de firmar.</div>` +
      fields.map(([k, l, v]) => `<div><label class="block text-xs font-semibold text-slate-600 mb-1">${l}</label><input id="anexo-field-${k}" value="${esc(v)}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-950"></div>`).join('');
    clearSignatureCanvas('anexo-signature-canvas');
    document.getElementById('anexo-editor-modal').classList.remove('hidden');
    lucide.createIcons();
  } catch (e) { showToast(e.message, 'error'); }
}
function collectAnnexForm() {
  const f = {};
  ['razon_social', 'rut', 'giro', 'rep_legal', 'rut_rep', 'direccion', 'telefono', 'email'].forEach(k => { const el = document.getElementById(`anexo-field-${k}`); f[k] = el ? el.value : ''; });
  return f;
}

// ============================================================================
// 5. CATÁLOGO: Excel con links → fichas técnicas editables → catálogo PDF
// ============================================================================
const _origRenderInventory = renderInventory;
renderInventory = async function () { await _origRenderInventory(); await renderCatalog(); };

async function renderCatalog() {
  const host = document.getElementById('catalog-section');
  if (!host) return;
  try { pf.cat.products = await pfJson('/api/catalog/products' + (pf.cat.q ? `?q=${encodeURIComponent(pf.cat.q)}` : '')); }
  catch (e) { host.innerHTML = `<p class="text-xs text-rose-700">${esc(e.message)}</p>`; return; }
  const list = pf.cat.products, shown = list.slice(0, pf.cat.limit), sel = pf.cat.selected;
  host.innerHTML = `<div class="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div><h3 class="font-heading font-bold text-sm text-slate-950"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg> Fichas técnicas y generador de catálogos</h3>
        <p class="text-xs text-slate-600">Importa un Excel con códigos, nombres, precios y links: la app descarga descripción, especificaciones, normas, ficha e imagen de cada enlace.</p></div>
      <div class="flex flex-wrap gap-2">
        <button onclick="catDirectUrlOpen()" class="${PF_BTN} bg-indigo-600 hover:bg-indigo-700 text-white"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Extraer desde Links Web Directos</button>
        <button onclick="catImportOpen()" class="${PF_BTN} bg-blue-600 hover:bg-blue-700 text-white">⬆ Importar Excel con links</button>
        <a href="/api/catalog/template" class="${PF_BTN} bg-slate-100 hover:bg-slate-200 text-slate-950">Plantilla</a>
        <button onclick="catPdfOpen()" class="${PF_BTN} bg-emerald-600 hover:bg-emerald-700 text-white"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10"/><path d="M6 10h10"/></svg> Generar catálogo PDF${sel.size ? ' (' + sel.size + ')' : ''}</button></div></div>
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <input id="cat-search" value="${esc(pf.cat.q)}" placeholder="Buscar por nombre, SKU o marca…" onkeydown="if(event.key==='Enter'){pf.cat.q=this.value;pf.cat.limit=48;renderCatalog();}" class="${PF_IN} !w-72">
      <button onclick="catSelectAll(true)" class="text-blue-700 hover:underline">Seleccionar todos</button><button onclick="catSelectAll(false)" class="text-slate-600 hover:underline">Limpiar</button>
      <span class="text-slate-500">${list.length} producto(s)</span></div>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">${shown.map(p => {
      const norms = (p.norms || '').split(/[,;|]+/).map(s => s.trim()).filter(Boolean).slice(0, 4);
      const ok = p.scrape_status === 'OK';
      return `<div class="rounded-xl border ${sel.has(p.id) ? 'border-blue-500' : 'border-slate-200'} bg-slate-50 overflow-hidden flex flex-col">
        <div class="h-32 bg-slate-50 flex items-center justify-center overflow-hidden relative">${p.has_image ? `<img loading="lazy" src="/api/catalog/products/${p.id}/image" class="max-h-full max-w-full object-contain">` : '<span class="text-[11px] text-slate-600">Sin imagen</span>'}
          <label class="absolute top-2 left-2 bg-white rounded p-1"><input type="checkbox" ${sel.has(p.id) ? 'checked' : ''} onchange="catToggle(${p.id}, this.checked)"></label>
          ${p.scrape_status ? `<span class="absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}" title="${esc(p.scrape_status)}">${ok ? 'ficha web <svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' : 'revisar'}</span>` : ''}</div>
        <div class="p-3 space-y-1.5 flex-1 flex flex-col"><div class="text-xs font-bold text-slate-950 leading-tight line-clamp-2">${esc(p.name)}</div>
          <div class="text-[10px] text-slate-500 font-mono">${esc(p.sku)}${p.brand ? ' · ' + esc(p.brand) : ''}</div>
          <div class="flex flex-wrap gap-1">${norms.map(n => `<span class="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">${esc(n)}</span>`).join('')}</div>
          <div class="text-[10px] text-slate-500">${Object.keys(p.specs || {}).length} especificación(es)</div>
          <div class="mt-auto flex items-center justify-between pt-1"><b class="text-xs text-slate-950">${p.unit_price ? pfClp(p.unit_price) : ''}</b>
            <button onclick="catEditOpen(${p.id})" class="${PF_BTN} bg-slate-100 hover:bg-slate-200 text-slate-950 !py-1">Editar ficha</button></div></div></div>`; }).join('')}</div>
    ${list.length > shown.length ? `<div class="text-center"><button onclick="pf.cat.limit+=48;renderCatalog()" class="${PF_BTN} bg-slate-100 hover:bg-slate-200 text-slate-950">Mostrar más (${list.length - shown.length})</button></div>` : ''}
  </div>`;
  lucide.createIcons();
}
function catToggle(id, on) { if (on) pf.cat.selected.add(id); else pf.cat.selected.delete(id); renderCatalog(); }
function catSelectAll(on) { pf.cat.selected = on ? new Set(pf.cat.products.map(p => p.id)) : new Set(); renderCatalog(); }

function catDirectUrlOpen() {
  pfModal('Extraer Fichas de Producto desde Links Web Directos', `<div class="space-y-3 text-xs">
    <p class="text-slate-600">Pega 1 o más enlaces de productos que estén en la web (uno por línea). El sistema visitará cada página, extraerá el nombre, descripción, especificaciones técnicas, normas e imagen, y creará la ficha lista para tu catálogo PDF.</p>
    <div><label class="block text-slate-600 mb-1">Categoría por defecto</label><input id="cat-direct-category" value="Catálogo Web" class="${PF_IN}"></div>
    <div><label class="block text-slate-600 mb-1">Enlaces Web (URLs — uno por línea) *</label>
      <textarea id="cat-direct-urls" rows="5" placeholder="https://tienda.cl/producto-1&#10;https://proveedor.cl/ficha-producto-2" class="${PF_IN} font-mono"></textarea></div>
    <div id="cat-direct-status" class="space-y-1"></div>
    <div class="flex justify-end gap-2">
      <button type="button" onclick="closePfModal()" class="${PF_BTN} bg-slate-100 text-slate-900">Cancelar</button>
      <button id="cat-direct-btn" onclick="catDirectUrlRun()" class="${PF_BTN} bg-indigo-600 hover:bg-indigo-700 text-white"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Extraer Fichas Ahora</button>
    </div></div>`);
}

async function catDirectUrlRun() {
  const raw = (document.getElementById('cat-direct-urls').value || '').trim();
  if (!raw) { showToast('Pega al menos un link web', 'error'); return; }
  const category = (document.getElementById('cat-direct-category').value || 'Catálogo Web').trim();
  const st = document.getElementById('cat-direct-status');
  const btn = document.getElementById('cat-direct-btn');
  btn.disabled = true;
  st.innerHTML = `<div class="text-blue-700 font-semibold">Extrayendo información e imágenes desde la web…</div>`;
  try {
    const r = await pfJson('/api/catalog/import-direct-urls', pfJsonOpts('POST', { urls: raw, category }));
    for (let i = 0; i < 600; i++) {
      await new Promise(res => setTimeout(res, 1200));
      const s = await pfJson(`/api/catalog/import-status/${r.job_id}`);
      if (!document.getElementById('cat-direct-status')) return;
      st.innerHTML = `<div class="text-blue-700 font-semibold">${esc(s.message)} ${s.total_web ? `(${s.done_web}/${s.total_web} links · ${s.web_ok} extraídos)` : ''}</div>`;
      if (s.status === 'LISTO' || s.status === 'ERROR') {
        const c = s.counts || {};
        st.innerHTML = `<div class="text-emerald-700 font-bold"><svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Extracción completada: ${c.creado || 0} ficha(s) creada(s), ${c.actualizado || 0} actualizada(s).</div>` +
          (s.errors && s.errors.length ? `<details class="text-amber-700 mt-1"><summary>${s.errors.length} aviso(s)</summary><div class="text-[11px] text-slate-600 mt-1">${s.errors.map(esc).join('<br>')}</div></details>` : '');
        await renderInventory();
        btn.disabled = false;
        return;
      }
    }
  } catch (e) {
    st.innerHTML = `<div class="text-rose-700">${esc(e.message)}</div>`;
    btn.disabled = false;
  }
}

function catImportOpen() {
  pfModal('Importar Excel con enlaces web', `<div class="space-y-3 text-xs">
    <p class="text-slate-600">Columnas reconocidas automáticamente: <b>Categoría, SKU/Código, Nombre, Link/URL, Marca, Precio, Costo, Stock, Normas, Descripción</b>. Cualquier otra columna se guarda como especificación técnica. Los enlaces pueden ser texto o hipervínculos de Excel.</p>
    <input type="file" id="cat-file" accept=".xlsx,.xlsm,.csv" class="${PF_IN}">
    <label class="flex items-center gap-2 text-slate-700"><input type="checkbox" id="cat-fetch" checked> Descargar desde cada link la descripción, especificaciones, normas, ficha técnica e imagen</label>
    <label class="flex items-center gap-2 text-slate-700"><input type="checkbox" id="cat-update" checked> Actualizar productos que ya existen (mismo SKU)</label>
    <div id="cat-import-status" class="space-y-1"></div>
    <div class="flex justify-end"><button id="cat-import-btn" onclick="catImportRun()" class="${PF_BTN} bg-blue-600 hover:bg-blue-700 text-white">Importar</button></div></div>`);
}
async function catImportRun() {
  const f = document.getElementById('cat-file').files[0];
  if (!f) { showToast('Selecciona un archivo Excel o CSV', 'error'); return; }
  const fd = new FormData(); fd.append('file', f);
  fd.append('fetch_web', document.getElementById('cat-fetch').checked ? 'true' : 'false');
  fd.append('update_existing', document.getElementById('cat-update').checked ? 'true' : 'false');
  const st = document.getElementById('cat-import-status'); document.getElementById('cat-import-btn').disabled = true;
  try {
    const r = await pfJson('/api/catalog/import-url-excel', { method: 'POST', body: fd });
    const map = Object.entries(r.mapping).filter(([k]) => k !== 'spec_columns').map(([k, v]) => `${k} ← "${esc(v)}"`).join(' · ');
    st.innerHTML = `<div class="text-slate-600">${r.total} fila(s), ${r.links_detected} enlace(s). Columnas: ${map}</div><div id="cat-prog" class="text-blue-700 font-semibold">Procesando…</div>`;
    for (let i = 0; i < 600; i++) {
      await new Promise(res => setTimeout(res, 1200));
      const s = await pfJson(`/api/catalog/import-status/${r.job_id}`);
      const prog = document.getElementById('cat-prog'); if (!prog) return;
      prog.innerHTML = `${esc(s.message)} ${s.total_web ? `(${s.done_web}/${s.total_web} enlaces · ${s.web_ok} ok · ${s.web_fail} sin datos)` : ''}`;
      if (s.status === 'LISTO' || s.status === 'ERROR') {
        const c = s.counts || {};
        st.innerHTML += `<div class="text-emerald-700 font-bold">Listo: ${c.creado || 0} creados, ${c.actualizado || 0} actualizados, ${c.omitido || 0} omitidos.</div>` +
          (s.errors.length ? `<details class="text-amber-700"><summary>${s.errors.length} aviso(s)</summary><div class="text-[11px] text-slate-600 mt-1">${s.errors.map(esc).join('<br>')}</div></details>` : '');
        await renderInventory(); document.getElementById('cat-import-btn').disabled = false; return;
      }
    }
  } catch (e) { st.innerHTML = `<div class="text-rose-700">${esc(e.message)}</div>`; document.getElementById('cat-import-btn').disabled = false; }
}

function catEditOpen(id) {
  const p = pf.cat.products.find(x => x.id === id); if (!p) return;
  pf.cat.edit = { id, specs: Object.entries(p.specs || {}) };
  const spec = () => pf.cat.edit.specs.map(([k, v], i) => `<div class="flex gap-2"><input value="${esc(k)}" onchange="pf.cat.edit.specs[${i}][0]=this.value" placeholder="Característica" class="${PF_IN} !w-2/5"><input value="${esc(v)}" onchange="pf.cat.edit.specs[${i}][1]=this.value" placeholder="Valor" class="${PF_IN}"><button type="button" onclick="pf.cat.edit.specs.splice(${i},1);catSpecsRedraw()" class="text-slate-500 hover:text-rose-700"><svg class="w-3.5 h-3.5 inline text-zinc-400 hover:text-rose-600 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div>`).join('');
  window.catSpecsRedraw = () => { document.getElementById('cat-specs').innerHTML = spec(); };
  pfModal(`Ficha técnica · ${esc(p.sku)}`, `<form onsubmit="catEditSave(event, ${id})" class="grid grid-cols-6 gap-3 text-xs">
    <div class="col-span-6 md:col-span-2 space-y-2"><div class="h-40 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-center overflow-hidden">${p.has_image ? `<img src="/api/catalog/products/${id}/image?t=${Date.now()}" class="max-h-full max-w-full object-contain">` : '<span class="text-slate-600">Sin imagen</span>'}</div>
      <label class="block text-slate-600">Subir imagen<input type="file" accept="image/*" onchange="catUploadImage(${id}, this.files[0])" class="${PF_IN} mt-1"></label>
      <label class="block text-slate-600">URL de imagen<input name="image_url" value="${esc(p.image_url || '')}" class="${PF_IN} mt-1"></label></div>
    <div class="col-span-6 md:col-span-4 grid grid-cols-2 gap-3">
      <div class="col-span-2"><label class="block text-slate-600 mb-1">Nombre *</label><input name="name" required value="${esc(p.name)}" class="${PF_IN}"></div>
      <div><label class="block text-slate-600 mb-1">Categoría</label><input name="category" value="${esc(p.category || '')}" class="${PF_IN}"></div>
      <div><label class="block text-slate-600 mb-1">Marca / Fabricante</label><input name="brand" value="${esc(p.brand || '')}" class="${PF_IN}"></div>
      <div><label class="block text-slate-600 mb-1">Costo neto</label><input name="unit_cost" type="number" step="any" value="${p.unit_cost || 0}" class="${PF_IN}"></div>
      <div><label class="block text-slate-600 mb-1">Precio venta neto</label><input name="unit_price" type="number" step="any" value="${p.unit_price || 0}" class="${PF_IN}"></div>
      <div><label class="block text-slate-600 mb-1">Unidad</label><input name="unit" value="${esc(p.unit || 'UND')}" class="${PF_IN}"></div>
      <div><label class="block text-slate-600 mb-1">Garantía</label><input name="warranty" value="${esc(p.warranty || '')}" class="${PF_IN}"></div></div>
    <div class="col-span-6"><label class="block text-slate-600 mb-1">Normas / certificaciones (separadas por coma)</label><input name="norms" value="${esc(p.norms || '')}" class="${PF_IN}"></div>
    <div class="col-span-6"><label class="block text-slate-600 mb-1">Descripción</label><textarea name="description" rows="3" class="${PF_IN}">${esc(p.description || '')}</textarea></div>
    <div class="col-span-6"><label class="block text-slate-600 mb-1">Enlace del producto</label><div class="flex gap-2"><input name="source_url" value="${esc(p.source_url || '')}" class="${PF_IN}">
      ${p.source_url ? `<button type="button" onclick="catRefetch(${id})" class="${PF_BTN} bg-slate-100 hover:bg-slate-200 text-slate-950 whitespace-nowrap">↻ Descargar de nuevo</button>` : ''}</div>
      ${p.datasheet_url ? `<a href="${esc(p.datasheet_url)}" target="_blank" rel="noopener" class="text-blue-700 hover:underline">Ver ficha técnica PDF</a>` : ''}</div>
    <div class="col-span-6"><div class="flex items-center justify-between mb-1"><label class="text-slate-600">Especificaciones técnicas</label><button type="button" onclick="pf.cat.edit.specs.push(['','']);catSpecsRedraw()" class="text-blue-700 hover:underline">+ agregar</button></div><div id="cat-specs" class="space-y-1.5">${spec()}</div></div>
    <label class="col-span-6 flex items-center gap-2 text-slate-700"><input type="checkbox" name="in_catalog" ${p.in_catalog ? 'checked' : ''}> Incluir en el catálogo comercial</label>
    <div class="col-span-6 flex justify-end gap-2"><button type="button" onclick="closePfModal()" class="${PF_BTN} bg-slate-100 text-slate-900">Cancelar</button><button class="${PF_BTN} bg-blue-600 hover:bg-blue-700 text-white">Guardar ficha</button></div></form>`, true);
}
async function catEditSave(e, id) {
  e.preventDefault(); const f = e.target;
  const specs = {}; pf.cat.edit.specs.forEach(([k, v]) => { if (String(k).trim()) specs[String(k).trim()] = String(v); });
  const p = pf.cat.products.find(x => x.id === id);
  const body = { name: f.name.value, sku: p.sku, category: f.category.value, brand: f.brand.value, norms: f.norms.value, warranty: f.warranty.value,
    description: f.description.value, source_url: f.source_url.value, image_url: f.image_url.value, datasheet_url: p.datasheet_url || '', unit: f.unit.value,
    unit_cost: parseFloat(f.unit_cost.value) || 0, unit_price: parseFloat(f.unit_price.value) || 0, specs, in_catalog: f.in_catalog.checked };
  try { await pfJson(`/api/catalog/products/${id}`, pfJsonOpts('PUT', body)); closePfModal(); showToast('Ficha guardada'); await renderInventory(); }
  catch (err) { showToast(err.message, 'error'); }
}
async function catUploadImage(id, file) {
  if (!file) return; const fd = new FormData(); fd.append('file', file);
  try { await pfJson(`/api/catalog/products/${id}/image`, { method: 'POST', body: fd }); showToast('Imagen actualizada'); await renderCatalog(); catEditOpen(id); }
  catch (e) { showToast(e.message, 'error'); }
}
async function catRefetch(id) {
  const overwrite = confirm('¿Sobrescribir también los datos que ya editaste con lo descargado?\n\nAceptar = sobrescribir todo\nCancelar = sólo completar lo que falta');
  showToast('Descargando ficha…', 'info');
  try { const r = await pfJson(`/api/catalog/products/${id}/refetch?overwrite=${overwrite}`, { method: 'POST' }); showToast(r.ok ? 'Ficha actualizada desde el enlace' : (r.error || 'Sin datos'), r.ok ? 'success' : 'error'); await renderCatalog(); catEditOpen(id); }
  catch (e) { showToast(e.message, 'error'); }
}
function catPdfOpen() {
  const n = pf.cat.selected.size;
  pfModal('Generar catálogo comercial (PDF)', `<form onsubmit="catPdfRun(event)" class="space-y-3 text-xs">
    <p class="text-slate-600">${n ? `Se incluirán los <b>${n}</b> producto(s) seleccionados.` : 'No hay selección: se incluirán todos los productos marcados "Incluir en el catálogo".'}</p>
    <div><label class="block text-slate-600 mb-1">Título</label><input name="title" value="Catálogo de Productos" class="${PF_IN}"></div>
    <div><label class="block text-slate-600 mb-1">Subtítulo</label><input name="subtitle" placeholder="Ej.: Línea EPP 2026" class="${PF_IN}"></div>
    <div><label class="block text-slate-600 mb-1">Productos por página</label><select name="per_page" class="${PF_IN}"><option value="1">1</option><option value="2" selected>2</option><option value="3">3</option></select></div>
    <label class="flex items-center gap-2 text-slate-700"><input type="checkbox" name="show_prices"> Mostrar precios netos</label>
    <label class="flex items-center gap-2 text-slate-700"><input type="checkbox" name="norms_matrix" checked> Incluir matriz de cumplimiento normativo</label>
    <div class="flex justify-end"><button class="${PF_BTN} bg-emerald-600 hover:bg-emerald-700 text-white">Generar PDF</button></div></form>`);
}
async function catPdfRun(e) {
  e.preventDefault(); const f = e.target;
  const body = { product_ids: Array.from(pf.cat.selected), title: f.title.value, subtitle: f.subtitle.value, per_page: parseInt(f.per_page.value, 10), show_prices: f.show_prices.checked, norms_matrix: f.norms_matrix.checked };
  try { showToast('Generando catálogo…', 'info'); await pfDownload('/api/catalog/generate-pdf', pfJsonOpts('POST', body), 'Catalogo_Productos.pdf'); closePfModal(); }
  catch (err) { showToast(err.message, 'error'); }
}

// ============================================================================
// 6. FACTURACIÓN: ÓRDENES DE COMPRA Y COTIZACIONES DIRECTAS
// ============================================================================
const _origRenderSII = renderSII;
renderSII = async function () { await _origRenderSII(); await renderCommDocs(); };
const CD_STATUS = { EMITIDA: 'bg-blue-50 text-blue-700', ENVIADA: 'bg-indigo-50 text-indigo-700', ACEPTADA: 'bg-emerald-50 text-emerald-700', ANULADA: 'bg-rose-50 text-rose-700' };
async function renderCommDocs() {
  const host = document.getElementById('commdocs-section'); if (!host) return;
  let docs = [];
  try { docs = await pfJson('/api/commercial-docs/' + (pf.cd.filter ? `?doc_type=${pf.cd.filter}` : '')); } catch (e) { host.innerHTML = `<p class="text-xs text-rose-700">${esc(e.message)}</p>`; return; }
  host.innerHTML = `<div class="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2"><div><h3 class="font-heading font-bold text-sm text-slate-950"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M16 8h-6"/><path d="M16 12h-6"/><path d="M14 16h-4"/></svg> Órdenes de Compra y Cotizaciones</h3>
      <p class="text-xs text-slate-600">Correlativo automático y trazabilidad por carpeta de negocio. Exporta en PDF y Word.</p></div>
      <div class="flex flex-wrap gap-2"><select onchange="pf.cd.filter=this.value;renderCommDocs()" class="${PF_IN} !w-40"><option value="">Todos</option><option value="OC" ${pf.cd.filter === 'OC' ? 'selected' : ''}>Órdenes de compra</option><option value="COTIZACION" ${pf.cd.filter === 'COTIZACION' ? 'selected' : ''}>Cotizaciones</option></select>
        <button onclick="cdOpen('OC')" class="${PF_BTN} bg-indigo-600 hover:bg-indigo-700 text-white">+ Orden de Compra</button>
        <button onclick="cdOpen('COTIZACION')" class="${PF_BTN} bg-blue-600 hover:bg-blue-700 text-white">+ Cotización</button></div></div>
    ${docs.length ? `<div class="overflow-x-auto"><table class="w-full text-xs text-left"><thead class="text-[10px] uppercase text-slate-500 border-b border-slate-200"><tr><th class="py-2 px-2">Folio</th><th class="py-2 px-2">Tipo</th><th class="py-2 px-2">Contraparte</th><th class="py-2 px-2">Negocio</th><th class="py-2 px-2">Emisión</th><th class="py-2 px-2 text-right">Total</th><th class="py-2 px-2">Estado</th><th></th></tr></thead><tbody>
      ${docs.map(d => `<tr class="border-b border-slate-200"><td class="py-2 px-2 font-mono font-bold text-blue-700">${esc(d.folio)}</td><td class="py-2 px-2">${d.doc_type === 'OC' ? 'Orden de compra' : 'Cotización'}</td>
        <td class="py-2 px-2 text-slate-900">${esc(d.counterparty_name)}<div class="text-[10px] text-slate-500 font-mono">${esc(d.counterparty_rut || '')}</div></td><td class="py-2 px-2 text-slate-600">${esc(d.folder_code || '—')}</td>
        <td class="py-2 px-2 text-slate-600">${fmtDate(d.issue_date)}</td><td class="py-2 px-2 text-right font-bold text-slate-950">${pfClp(d.total_amount)}</td>
        <td class="py-2 px-2"><select onchange="cdStatus(${d.id}, this.value)" class="${CD_STATUS[d.status] || ''} rounded px-1.5 py-0.5 font-bold border-0 text-[11px]">${['EMITIDA', 'ENVIADA', 'ACEPTADA', 'ANULADA'].map(s => `<option class="bg-white text-slate-950" ${d.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td class="py-2 px-2 whitespace-nowrap space-x-2"><a target="_blank" href="/api/commercial-docs/${d.id}/export?fmt=pdf" class="text-blue-700 hover:underline">PDF</a><button onclick="cdEmail(${d.id})" class="text-emerald-700 hover:underline"><svg class="w-3.5 h-3.5 inline text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>️ Enviar</button><a href="/api/commercial-docs/${d.id}/export?fmt=docx" class="text-blue-700 hover:underline">Word</a></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="text-xs text-slate-500 text-center py-4">Aún no hay documentos. Emite tu primera orden de compra o cotización.</p>'}</div>`;
}
async function cdStatus(id, st) { try { await pfJson(`/api/commercial-docs/${id}/status`, pfJsonOpts('PUT', { status: st })); showToast('Estado actualizado'); await renderCommDocs(); } catch (e) { showToast(e.message, 'error'); } }

async function cdOpen(type) {
  let folders = [], prods = [];
  try { folders = await pfJson('/api/folders/'); } catch (e) { /* opcional */ }
  try { prods = await pfJson('/api/catalog/products'); } catch (e) { /* opcional */ }
  pf.cd.type = type; pf.cd.prods = prods; pf.cd.items = [{ sku: '', description: '', quantity: 1, unit: 'UND', unit_price: 0, discount_pct: 0 }];
  const isOC = type === 'OC';
  pfModal(isOC ? 'Nueva Orden de Compra' : 'Nueva Cotización', `<form onsubmit="cdSave(event)" class="space-y-4 text-xs">
    <datalist id="cd-prods">${prods.map(p => `<option value="${esc(p.name)}">${esc(p.sku)}</option>`).join('')}</datalist>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div class="col-span-2"><label class="block text-slate-600 mb-1">${isOC ? 'Proveedor' : 'Cliente'} *</label><input name="counterparty_name" required class="${PF_IN}"></div>
      <div><label class="block text-slate-600 mb-1">RUT</label><input name="counterparty_rut" class="${PF_IN}"></div>
      <div><label class="block text-slate-600 mb-1">Negocio asociado</label><select name="folder_id" class="${PF_IN}"><option value="">(ninguno)</option>${folders.map(f => `<option value="${f.id}">${esc(f.code)} · ${esc((f.title || '').slice(0, 40))}</option>`).join('')}</select></div>
      <div class="col-span-2"><label class="block text-slate-600 mb-1">Dirección</label><input name="counterparty_address" class="${PF_IN}"></div>
      <div><label class="block text-slate-600 mb-1">Contacto</label><input name="counterparty_contact" class="${PF_IN}"></div>
      <div><label class="block text-slate-600 mb-1">Correo</label><input name="counterparty_email" class="${PF_IN}"></div>
      <div><label class="block text-slate-600 mb-1">Condición de pago</label><input name="payment_terms" value="30 días" class="${PF_IN}"></div>
      <div><label class="block text-slate-600 mb-1">Fecha de entrega</label><input name="delivery_date" type="date" class="${PF_IN}"></div>
      <div><label class="block text-slate-600 mb-1">Lugar de entrega</label><input name="delivery_place" class="${PF_IN}"></div>
      ${isOC ? '' : `<div><label class="block text-slate-600 mb-1">Validez (días)</label><input name="validity_days" type="number" value="15" class="${PF_IN}"></div>`}</div>
    <div><div class="flex items-center justify-between mb-1"><b class="text-slate-700">Ítems</b><button type="button" onclick="cdAddRow()" class="text-blue-700 hover:underline">+ agregar ítem</button></div><div id="cd-items" class="space-y-2"></div></div>
    <div><label class="block text-slate-600 mb-1">Observaciones</label><textarea name="notes" rows="2" class="${PF_IN}"></textarea></div>
    <div class="flex items-center justify-between"><div id="cd-totals" class="text-slate-700"></div><button class="${PF_BTN} bg-blue-600 hover:bg-blue-700 text-white">Emitir ${isOC ? 'Orden de Compra' : 'Cotización'}</button></div></form>`, true);
  cdRedraw();
}
function cdRedraw() {
  document.getElementById('cd-items').innerHTML = pf.cd.items.map((it, i) => `<div class="grid grid-cols-12 gap-2 items-center">
    <input value="${esc(it.sku)}" placeholder="Código" onchange="pf.cd.items[${i}].sku=this.value" class="${PF_IN} col-span-2">
    <input list="cd-prods" value="${esc(it.description)}" placeholder="Descripción" onchange="cdPickProduct(${i}, this.value)" class="${PF_IN} col-span-4">
    <input type="number" min="0" step="any" value="${it.quantity}" onchange="pf.cd.items[${i}].quantity=parseFloat(this.value)||0;cdTotals()" class="${PF_IN} col-span-1 text-right">
    <input value="${esc(it.unit)}" onchange="pf.cd.items[${i}].unit=this.value" class="${PF_IN} col-span-1">
    <input type="number" min="0" step="any" value="${it.unit_price}" onchange="pf.cd.items[${i}].unit_price=parseFloat(this.value)||0;cdTotals()" class="${PF_IN} col-span-2 text-right">
    <input type="number" min="0" max="100" step="any" value="${it.discount_pct}" title="% descuento" onchange="pf.cd.items[${i}].discount_pct=parseFloat(this.value)||0;cdTotals()" class="${PF_IN} col-span-1 text-right">
    <button type="button" onclick="pf.cd.items.splice(${i},1);cdRedraw()" class="col-span-1 text-slate-500 hover:text-rose-700"><svg class="w-3.5 h-3.5 inline text-zinc-400 hover:text-rose-600 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div>`).join('');
  cdTotals();
}
function cdAddRow() { pf.cd.items.push({ sku: '', description: '', quantity: 1, unit: 'UND', unit_price: 0, discount_pct: 0 }); cdRedraw(); }
function cdPickProduct(i, name) {
  pf.cd.items[i].description = name;
  const p = pf.cd.prods.find(x => x.name === name);
  if (p) { pf.cd.items[i].sku = p.sku; pf.cd.items[i].unit = p.unit || 'UND'; pf.cd.items[i].unit_price = (pf.cd.type === 'OC' ? p.unit_cost : p.unit_price) || 0; cdRedraw(); }
}
function cdTotals() {
  const net = pf.cd.items.reduce((s, it) => s + Math.round(it.quantity * it.unit_price * (1 - (it.discount_pct || 0) / 100)), 0);
  const el = document.getElementById('cd-totals');
  if (el) el.innerHTML = `Neto <b>${pfClp(net)}</b> · IVA 19% <b>${pfClp(net * 0.19)}</b> · Total <b class="text-emerald-700">${pfClp(net * 1.19)}</b>`;
}
async function cdSave(e) {
  e.preventDefault(); const f = e.target;
  const items = pf.cd.items.filter(i => i.description.trim());
  const body = { doc_type: pf.cd.type, folder_id: f.folder_id.value ? parseInt(f.folder_id.value, 10) : null, counterparty_name: f.counterparty_name.value, counterparty_rut: f.counterparty_rut.value,
    counterparty_address: f.counterparty_address.value, counterparty_email: f.counterparty_email.value, counterparty_contact: f.counterparty_contact.value,
    payment_terms: f.payment_terms.value, delivery_date: f.delivery_date.value || null, delivery_place: f.delivery_place.value, notes: f.notes.value,
    validity_days: f.validity_days ? parseInt(f.validity_days.value, 10) || 15 : 15, items };
  try { const r = await pfJson('/api/commercial-docs/', pfJsonOpts('POST', body)); closePfModal(); showToast(r.message); await renderCommDocs(); window.open(`/api/commercial-docs/${r.id}/export?fmt=pdf`, '_blank'); }
  catch (err) { showToast(err.message, 'error'); }
}
