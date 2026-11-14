// ============================================================================
// ESPACIO DE TRABAJO DE LA CARPETA DE NEGOCIO
// Todo vive aquí: pendientes IA, productos, cotizador, documentos/firma, finanzas.
// Este archivo se carga después de app.js y redefine las vistas de Dashboard / Negocios.
// ============================================================================

const ws = { id: null, data: null, tab: 'pendientes', q: null, pollTimer: null, channel: 'ALL', pendingFiles: [] };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(d) {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
}
function fmtDateTime(d) {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(d);
  if (!m) return d;
  const dateStr = `${m[3]}-${m[2]}-${m[1]}`;
  if (m[4] && m[5]) {
    return `${dateStr} a las ${m[4]}:${m[5]} hrs`;
  }
  return dateStr;
}
function daysUntil(d) {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return null;
  const t = new Date(d.slice(0, 10) + 'T00:00:00');
  const n = new Date(); n.setHours(0, 0, 0, 0);
  return Math.round((t - n) / 86400000);
}
async function wsApi(url, opts) {
  const res = await fetch(url, opts);
  let body = null;
  try { body = await res.json(); } catch (e) { /* sin cuerpo */ }
  if (!res.ok) throw new Error((body && (body.detail || body.message)) || `Error ${res.status}`);
  return body;
}
const jsonOpts = (method, obj) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

// ----------------------------------------------------------------------------
// Navegación (se quitan los módulos Mercado Público / Cotizador sueltos)
// ----------------------------------------------------------------------------
async function switchTab(tabName) {
  if (tabName === 'quotations' || tabName === 'tenders') tabName = 'folders';
  state.activeTab = tabName;
  document.querySelectorAll('.nav-tab-btn').forEach(b => {
    const active = b.dataset.tab === tabName || (tabName === 'workspace' && b.dataset.tab === 'folders');
    b.classList.toggle('bg-blue-600', active);
    b.classList.toggle('text-slate-950', active);
    b.classList.toggle('font-semibold', active);
    b.classList.toggle('text-slate-700', !active);
  });
  document.querySelectorAll('.rail-tab-btn[data-rail-tab]').forEach(rb => {
    const isRailActive = rb.dataset.railTab === tabName || (tabName === 'workspace' && rb.dataset.railTab === 'folders') || (tabName === 'users' && rb.dataset.railTab === 'companies');
    rb.classList.toggle('rail-active', isRailActive);
  });
  document.querySelectorAll('.tab-view-content').forEach(v => v.classList.add('hidden'));
  const view = document.getElementById(`view-${tabName}`);
  if (view) view.classList.remove('hidden');
  if (tabName !== 'workspace') stopPolling();

  if (tabName === 'dashboard') await renderDashboard();
  if (tabName === 'folders') await renderFolders();
  if (tabName === 'sii') await renderSII();
  if (tabName === 'banking') await renderBanking();
  if (tabName === 'inventory') await renderInventory();
  if (tabName === 'companies') { await renderCompaniesConfig(); await loadAiSettings(); await loadSignerProfile(); }
  lucide.createIcons();
}

// ----------------------------------------------------------------------------
// DASHBOARD EJECUTIVO: por qué se llegó a la utilidad + desglose por carpeta
// ----------------------------------------------------------------------------
async function renderDashboard() {
  try {
    const qProj = (typeof siiPeriodQuery === 'function' ? siiPeriodQuery() : '');
    const qAging = (typeof getGlobalPeriodQuery === 'function' ? getGlobalPeriodQuery('month') : '');
    const [folders, inv, tax, aging] = await Promise.all([
      fetch('/api/folders/').then(r => r.json()),
      fetch('/api/inventory/summary').then(r => r.json()),
      fetch('/api/sii/projection' + qProj).then(r => r.json()),
      fetch('/api/banking/aging-dashboard' + qAging).then(r => r.json())
    ]);
    state.folders = folders;
    const fCountEl = document.getElementById('nav-count-folders');
    if (fCountEl && Array.isArray(folders)) fCountEl.textContent = String(folders.length);
    const sum = k => folders.reduce((a, f) => a + (f[k] || 0), 0);
    let venta = sum('venta_neta'), cdir = sum('costo_directo'), gastos = sum('gastos_asociados');

    // Consolidar según los DTEs del mes activo provenientes del RCV / SII cuando no haya carpetas o sin movimientos
    if (venta === 0 && (tax.base_ventas_neta || 0) > 0) {
      venta = tax.base_ventas_neta;
    }
    if (cdir === 0 && (tax.base_compras_neta || 0) > 0) {
      cdir = tax.base_compras_neta;
    }

    const costo = cdir + gastos, util = venta - costo;
    const pct = v => venta > 0 ? (v / venta * 100) : 0;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

    set('kpi-ventas-netas', formatCLP(venta));
    set('kpi-costo-neto', formatCLP(costo));
    set('kpi-costo-directo', formatCLP(cdir));
    set('kpi-gastos-op', formatCLP(gastos));
    set('kpi-utilidad-neta', formatCLP(util));
    set('kpi-margen-promedio', pct(util).toFixed(1) + '%');
    set('kpi-iva-debito', formatCLP(tax.iva_debito));
    set('kpi-iva-credito', formatCLP(tax.iva_credito));
    set('kpi-f29-total', formatCLP(tax.total_f29_pagar));
    set('kpi-cxc-total', formatCLP(aging.cxc.total_monto));
    set('kpi-cxp-total', formatCLP(aging.cxp.total_monto));
    set('kpi-stock-critico', `${inv.articulos_criticos_count} ítems`);
    const badge = document.getElementById('kpi-iva-badge');
    if (badge) {
      if (tax.iva_a_pagar > 0) { badge.textContent = `A Pagar: ${formatCLP(tax.iva_a_pagar)}`; badge.className = 'text-xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 font-semibold'; }
      else { badge.textContent = `Remanente: ${formatCLP(tax.remanente_iva)}`; badge.className = 'text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold'; }
    }

    // Cascada causal
    set('waterfall-margen-badge', pct(util).toFixed(1) + '%');
    set('waterfall-venta-neta', formatCLP(venta));
    set('waterfall-costo-directo', '-' + formatCLP(cdir));
    set('waterfall-costo-dir-pct', pct(cdir).toFixed(1) + '%');
    set('waterfall-gastos-op', '-' + formatCLP(gastos));
    set('waterfall-gastos-pct', pct(gastos).toFixed(1) + '%');
    set('waterfall-utilidad-neta', formatCLP(util));
    set('waterfall-utilidad-pct', pct(util).toFixed(1) + '%');

    // Drivers
    const pub = folders.filter(f => f.type === 'MERCADO_PUBLICO'), priv = folders.filter(f => f.type !== 'MERCADO_PUBLICO');
    const uPub = pub.reduce((a, f) => a + f.utilidad_neta, 0), uPriv = priv.reduce((a, f) => a + f.utilidad_neta, 0);
    const share = (u) => util !== 0 ? (u / util * 100).toFixed(0) : 0;
    set('driver-canal-desc', (pub.length || priv.length) ? `Mercado Público aportó ${formatCLP(uPub)} (${share(uPub)}% de la utilidad) con ${pub.length} negocio(s); clientes privados aportaron ${formatCLP(uPriv)} (${share(uPriv)}%) con ${priv.length} negocio(s).` : 'Sin negocios asignados en el período.');
    const top = [...folders].sort((a, b) => b.utilidad_neta - a.utilidad_neta)[0];
    set('driver-top-folder', top ? `${top.code} · ${top.title} generó ${formatCLP(top.utilidad_neta)} con margen ${top.margen_pct}% (${share(top.utilidad_neta)}% del total).` : 'Sin movimientos registrados para este período.');
    set('driver-cost-efficiency', venta > 0 ? `Por cada $100 vendidos, $${pct(cdir).toFixed(0)} se van en compras directas y $${pct(gastos).toFixed(0)} en gastos operativos; quedan $${pct(util).toFixed(0)} de utilidad.` : (cdir > 0 ? `Costos y compras de ${formatCLP(cdir)} registradas en el período fiscal.` : 'Sin movimientos registrados para este período.'));

    if (folders.length === 0 && (venta > 0 || cdir > 0)) {
      renderDashboardChart([{
        code: (tax.periodo || 'Período'),
        venta_neta: venta,
        costo_total: cdir,
        utilidad_neta: util
      }]);
    } else if (folders.length === 0) {
      renderDashboardChart([]);
    } else {
      renderDashboardChart(folders.map(f => ({ ...f, costo_total: f.costo_total })));
    }

    const tbody = document.getElementById('dashboard-folders-tbody');
    tbody.innerHTML = '';
    if (folders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" class="py-8 px-4 text-center text-xs text-slate-600">Sin movimientos ni negocios registrados para este período.</td></tr>';
    } else {
      folders.forEach(f => {
        const sem = f.semaforo === 'VERDE' ? 'badge-verde' : (f.semaforo === 'AMARILLO' ? 'badge-amarillo' : 'badge-rojo');
        const aporte = util !== 0 ? (f.utilidad_neta / util * 100).toFixed(1) : '0.0';
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-200 hover:bg-slate-100 text-sm';
        tr.innerHTML = `
          <td class="py-3 px-3"><div class="font-semibold text-blue-700 cursor-pointer" onclick="openWorkspace(${f.folder_id})">${esc(f.code)}</div><div class="text-xs text-slate-700 max-w-[200px] truncate">${esc(f.title)}</div></td>
          <td class="py-3 px-3 text-xs">${f.type === 'MERCADO_PUBLICO' ? 'Mercado Público' : 'Privado'}<div class="text-slate-500 font-mono">${esc(f.tender_id || '')}</div></td>
          <td class="py-3 px-3 text-slate-600 text-xs">${esc(f.client_name)}</td>
          <td class="py-3 px-3 text-right font-medium text-slate-900">${formatCLP(f.venta_neta)}</td>
          <td class="py-3 px-3 text-right text-rose-700">${formatCLP(f.costo_directo)}</td>
          <td class="py-3 px-3 text-right text-amber-700">${formatCLP(f.gastos_asociados)}</td>
          <td class="py-3 px-3 text-right font-bold text-rose-700">${formatCLP(f.costo_total)}</td>
          <td class="py-3 px-3 text-right font-bold text-emerald-700">${formatCLP(f.utilidad_neta)}</td>
          <td class="py-3 px-3 text-center"><span class="px-2.5 py-1 rounded-full text-xs font-bold ${sem}">${f.margen_pct}%</span></td>
          <td class="py-3 px-3 text-center text-xs text-slate-700">${aporte}%</td>
          <td class="py-3 px-3 text-center"><button onclick="openWorkspace(${f.folder_id})" class="p-1.5 text-blue-700 hover:bg-blue-100 rounded" title="Abrir carpeta"><i data-lucide="folder-open" class="w-4 h-4"></i></button></td>`;
        tbody.appendChild(tr);
      });
    }
    lucide.createIcons();
  } catch (err) {
    console.error('Error renderizando dashboard:', err);
  }
}

// ----------------------------------------------------------------------------
// NEGOCIOS (Mercado Público + Privados en una sola vista)
// ----------------------------------------------------------------------------
function filterFoldersChannel(ch) {
  ws.channel = ch;
  document.querySelectorAll('.folder-filter-btn').forEach(b => {
    const on = b.id === `btn-filter-${ch}`;
    b.classList.toggle('bg-blue-600', on); b.classList.toggle('text-slate-950', on); b.classList.toggle('font-bold', on);
    b.classList.toggle('text-slate-600', !on); b.classList.toggle('font-semibold', !on);
  });
  renderFolders();
}

async function renderFolders() {
  try {
    state.folders = await fetch('/api/folders/').then(r => r.json());
    const list = state.folders.filter(f => ws.channel === 'ALL' || f.type === ws.channel);
    const cards = document.getElementById('folders-360-cards-container');
    cards.innerHTML = '';
    if (!list.length) cards.innerHTML = '<div class="text-sm text-slate-500 col-span-3 p-6 text-center border border-dashed border-slate-200 rounded-xl">No hay negocios en este canal. Crea uno con "Nuevo Negocio / Licitación" y sube las bases.</div>';
    list.forEach(f => {
      const sem = f.semaforo === 'VERDE' ? 'badge-verde' : (f.semaforo === 'AMARILLO' ? 'badge-amarillo' : 'badge-rojo');
      const c = document.createElement('div');
      c.className = 'bg-white border border-slate-200 hover:border-blue-500/50 rounded-xl p-5 cursor-pointer transition-all shadow-lg space-y-3';
      c.onclick = () => openWorkspace(f.folder_id);
      c.innerHTML = `
        <div class="flex items-center justify-between">
          <span class="px-2 py-0.5 rounded text-xs font-bold ${f.type === 'MERCADO_PUBLICO' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-slate-100 text-slate-700'}">${f.type === 'MERCADO_PUBLICO' ? 'Mercado Público' : 'Privado'}</span>
          <div class="flex items-center space-x-2">
            <span class="text-xs text-slate-500 font-mono">${esc(f.code)}</span>
            <button type="button" onclick="event.stopPropagation(); deleteFolderAction(${f.folder_id}, '${esc(f.title)}')" class="p-1 text-slate-500 hover:text-rose-700 hover:bg-rose-100 rounded transition-colors" title="Eliminar Carpeta / Negocio">
              <i data-lucide="trash-2" class="w-4 h-4 text-rose-700"></i>
            </button>
          </div>
        </div>
        <div><h3 class="font-bold text-slate-950 leading-snug">${esc(f.title)}</h3><p class="text-xs text-slate-600">${esc(f.client_name)}${f.tender_id ? ' · ID ' + esc(f.tender_id) : ''}</p></div>
        <div>
          <div class="flex justify-between text-[11px] text-slate-600 mb-1"><span>Avance</span><b class="text-emerald-700">${f.progress_pct ?? 0}%</b></div>
          <div class="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden"><div class="h-full bg-gradient-to-r from-blue-600 to-emerald-500" style="width:${f.progress_pct ?? 0}%"></div></div>
        </div>
        <div class="grid grid-cols-3 gap-2 text-center text-[11px]">
          <div class="bg-slate-50 rounded p-1.5"><div class="font-bold text-slate-900">${f.requested_items_count ?? 0}</div><div class="text-slate-500">productos</div></div>
          <div class="bg-slate-50 rounded p-1.5"><div class="font-bold text-slate-900">${f.docs_firmados_count ?? 0}/${f.docs_count ?? 0}</div><div class="text-slate-500">docs firmados</div></div>
          <div class="bg-slate-50 rounded p-1.5"><div class="font-bold ${sem === 'badge-rojo' ? 'text-rose-700' : 'text-emerald-700'}">${f.margen_pct}%</div><div class="text-slate-500">margen</div></div>
        </div>
        <div class="flex justify-between text-xs pt-2 border-t border-slate-200"><span class="text-slate-600">Costo neto <b class="text-rose-700">${formatCLP(f.costo_total)}</b></span><span class="text-slate-600">Utilidad <b class="text-emerald-700">${formatCLP(f.utilidad_neta)}</b></span></div>`;
      cards.appendChild(c);
    });

    const tbody = document.getElementById('folders-table-tbody');
    tbody.innerHTML = '';
    list.forEach(f => {
      const sem = f.semaforo === 'VERDE' ? 'badge-verde' : (f.semaforo === 'AMARILLO' ? 'badge-amarillo' : 'badge-rojo');
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-200 hover:bg-slate-100 text-sm cursor-pointer';
      tr.onclick = () => openWorkspace(f.folder_id);
      tr.innerHTML = `
        <td class="py-3 px-3 font-bold text-blue-700">${esc(f.code)}</td>
        <td class="py-3 px-3 text-slate-950 max-w-xs truncate">${esc(f.title)}</td>
        <td class="py-3 px-3 text-slate-700 text-xs">${esc(f.client_name)}</td>
        <td class="py-3 px-3 text-xs">${f.type === 'MERCADO_PUBLICO' ? 'Público' : 'Privado'}<div class="font-mono text-slate-500">${esc(f.tender_id || '')}</div></td>
        <td class="py-3 px-3 text-center text-xs font-bold text-emerald-700">${f.progress_pct ?? 0}%</td>
        <td class="py-3 px-3 text-right text-slate-950 font-bold">${formatCLP(f.venta_neta)}</td>
        <td class="py-3 px-3 text-right text-rose-700">${formatCLP(f.costo_directo)}</td>
        <td class="py-3 px-3 text-right text-amber-700">${formatCLP(f.gastos_asociados)}</td>
        <td class="py-3 px-3 text-right font-bold text-rose-700">${formatCLP(f.costo_total)}</td>
        <td class="py-3 px-3 text-right font-bold text-emerald-700">${formatCLP(f.utilidad_neta)}</td>
        <td class="py-3 px-3 text-center"><span class="px-2.5 py-1 rounded-full text-xs font-bold ${sem}">${f.margen_pct}%</span></td>
        <td class="py-3 px-3 text-center">
          <div class="flex items-center justify-center space-x-2">
            <a href="/api/export/folder/${f.folder_id}" onclick="event.stopPropagation()" class="p-1 text-emerald-700 hover:text-emerald-700" title="Descargar Excel"><i data-lucide="file-spreadsheet" class="w-4 h-4 inline"></i></a>
            <button type="button" onclick="event.stopPropagation(); deleteFolderAction(${f.folder_id}, '${esc(f.title)}')" class="p-1 text-slate-600 hover:text-rose-700 hover:bg-rose-100 rounded transition-colors" title="Eliminar Carpeta / Negocio">
              <i data-lucide="trash-2" class="w-4 h-4 text-rose-700 inline"></i>
            </button>
          </div>
        </td>`;
      tbody.appendChild(tr);
    });
    lucide.createIcons();
  } catch (err) { console.error('Error renderizando carpetas:', err); }
}

async function deleteFolderAction(folderId, title) {
  const confirmed = confirm(`¿Estás seguro de eliminar este negocio y sus archivos asociados?\n\n"${title || 'Carpeta de Negocio'}"`);
  if (!confirmed) return;
  try {
    const res = await fetch(`/api/folders/${folderId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.message || 'Error al eliminar');
    showToast('Negocio eliminado correctamente');
    if (ws.id === folderId) {
      closeWorkspace();
    }
    await renderFolders();
    if (typeof renderDashboard === 'function') {
      try { await renderDashboard(); } catch (e) {}
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.deleteFolderAction = deleteFolderAction;

async function deleteCurrentFolderAction() {
  if (!ws.id) return;
  const title = ws.data?.folder?.title || ws.data?.folder?.code || 'este negocio';
  await deleteFolderAction(ws.id, title);
}
window.deleteCurrentFolderAction = deleteCurrentFolderAction;

// Compatibilidad: cualquier llamada antigua abre el espacio de trabajo
function openFolderDetail(id) { return openWorkspace(id); }
function openTenderDocumentsModal(id) { return openWorkspace(id, 'documentos'); }

// ----------------------------------------------------------------------------
// CREACIÓN: Crear carpeta -> subir bases -> IA analiza -> carpeta auto-configurada
// ----------------------------------------------------------------------------
function openNewFolderModal() {
  document.getElementById('new-folder-form').reset();
  ws.pendingFiles = [];
  document.getElementById('new-folder-files-list').textContent = '';
  document.getElementById('new-folder-modal').classList.remove('hidden');
}
function handleNewFolderFilesPicked(files) {
  ws.pendingFiles = [...ws.pendingFiles, ...Array.from(files)];
  document.getElementById('new-folder-files-list').textContent = ws.pendingFiles.map(f => '<svg class="w-3.5 h-3.5 inline text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> ' + f.name).join('  ·  ');
}
function handleNewFolderDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('bg-blue-50');
  handleNewFolderFilesPicked(e.dataTransfer.files);
}
async function handleCreateFolder(e) {
  e.preventDefault();
  const form = document.getElementById('new-folder-form');
  const payload = {
    title: form.title.value.trim(), client_name: form.client_name.value.trim(), client_rut: form.client_rut.value.trim(),
    type: form.type.value, tender_id: form.tender_id.value.trim() || null,
    budget_amount: parseFloat(form.budget_amount.value) || 0, target_margin_pct: parseFloat(form.target_margin_pct.value) || 25.0,
    status: 'EN_PREPARACION', notes: form.notes.value.trim()
  };
  try {
    const res = await wsApi('/api/folders/', jsonOpts('POST', payload));
    closeNewFolderModal();
    showToast('Carpeta creada');
    await openWorkspace(res.id);
    if (ws.pendingFiles.length) await wsUploadFiles(ws.pendingFiles);
    ws.pendingFiles = [];
  } catch (err) { showToast(err.message, 'error'); }
}

// ----------------------------------------------------------------------------
// ESPACIO DE TRABAJO
// ----------------------------------------------------------------------------
const WS_TABS = [
  ['pendientes', 'Pendientes y Cronograma', 'alert-triangle'],
  ['productos', 'Productos y Especificaciones', 'package-search'],
  ['cotizador', 'Cotizador', 'file-spreadsheet'],
  ['documentos', 'Documentos y Firma', 'file-signature'],
  ['finanzas', 'Finanzas y Costeo', 'wallet'],
  ['postular', 'Postular', 'rocket']
];
const STAGES = [['EN_PREPARACION', 20, '1. Levantamiento / Bases'], ['ENVIADA', 45, '2. Oferta enviada'], ['ADJUDICADA', 65, '3. Adjudicado / OC'], ['EN_EJECUCION', 85, '4. En ejecución'], ['CERRADA', 100, '5. Facturado y cerrado']];

async function openWorkspace(id, tab) {
  ws.id = id;
  if (tab) ws.tab = tab; else if (ws.data?.folder?.id !== id) ws.tab = 'pendientes';
  await loadWorkspace();
  await switchTab('workspace');
  lucide.createIcons();
}
function closeWorkspace() { stopPolling(); ws.id = null; switchTab('folders'); }

async function loadWorkspace() {
  ws.data = await wsApi(`/api/workspace/${ws.id}`);
  renderWorkspace();
  const active = ws.data.jobs.some(j => ['PENDIENTE', 'LEYENDO', 'ANALIZANDO'].includes(j.status));
  if (active) startPolling(); else stopPolling();
}
function startPolling() { if (!ws.pollTimer) ws.pollTimer = setInterval(async () => { if (state.activeTab === 'workspace' && ws.id) await loadWorkspace(); }, 2000); }
function stopPolling() { if (ws.pollTimer) { clearInterval(ws.pollTimer); ws.pollTimer = null; } }

function renderWorkspace() {
  const d = ws.data, f = d.folder;
  document.getElementById('ws-code').textContent = f.code;
  document.getElementById('ws-type').textContent = f.type === 'MERCADO_PUBLICO' ? `Mercado Público${f.tender_id ? ' · ID ' + f.tender_id : ''}` : '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="9" y1="22" x2="9" y2="22.01"/><line x1="15" y1="22" x2="15" y2="22.01"/><line x1="8" y1="6" x2="8" y2="6.01"/><line x1="16" y1="6" x2="16" y2="6.01"/><line x1="8" y1="10" x2="8" y2="10.01"/><line x1="16" y1="10" x2="16" y2="10.01"/><line x1="8" y1="14" x2="8" y2="14.01"/><line x1="16" y1="14" x2="16" y2="14.01"/></svg> Cliente privado';
  document.getElementById('ws-status').textContent = (f.status || '').replace('_', ' ');
  document.getElementById('ws-title').textContent = f.title;
  document.getElementById('ws-client').textContent = `${f.client_name} (${f.client_rut})`;
  document.getElementById('ws-export-btn').href = `/api/export/folder/${f.id}`;
  const pct = f.progress_pct ?? 0;
  document.getElementById('ws-progress-text').textContent = pct + '%';
  document.getElementById('ws-progress-bar').style.width = pct + '%';
  document.getElementById('ws-stages').innerHTML = STAGES.map(([st, p, label]) => `
    <button onclick="wsSetStage('${st}', ${p})" class="p-2 rounded-lg border text-left transition-all ${f.status === st ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-500/50'}">
      <div class="text-[10px] font-bold ${f.status === st ? 'text-blue-700' : 'text-slate-500'}">${p}%</div><div class="font-semibold text-slate-900 truncate">${label}</div></button>`).join('');

  // Progreso del análisis
  const jobsEl = document.getElementById('ws-jobs');
  const recent = d.jobs.filter(j => ['PENDIENTE', 'LEYENDO', 'ANALIZANDO'].includes(j.status) || j.status === 'ERROR' || (j.finished_at && (Date.now() - new Date(j.finished_at.replace(' ', 'T')).getTime()) < 120000));
  jobsEl.innerHTML = recent.map(j => {
    const busy = ['PENDIENTE', 'LEYENDO', 'ANALIZANDO'].includes(j.status);
    const color = j.status === 'ERROR' ? 'rose' : (j.status === 'LISTO' ? 'emerald' : 'blue');
    return `<div class="rounded-lg border border-${color}-500/30 bg-${color}-500/5 p-3 text-xs">
      <div class="flex items-center justify-between"><b class="text-slate-900 truncate">${busy ? '<span class="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse mr-1.5"></span>' : ''}${esc(j.filename)}</b>
        <span class="text-${color}-300 font-bold">${esc(j.status)}${j.provider ? ' · ' + esc(j.provider) : ''}</span></div>
      <div class="text-slate-600 mt-1">${esc(j.stage_msg || '')}</div>
      ${j.error ? `<div class="text-${j.status === 'ERROR' ? 'rose' : 'amber'}-300 mt-1 whitespace-pre-line">${esc(j.error)}</div>` : ''}</div>`;
  }).join('');

  // Pestañas
  document.getElementById('ws-tabs').innerHTML = WS_TABS.map(([id, label, icon]) => {
    let badge = '';
    if (id === 'pendientes') { const n = d.checklist.filter(c => c.status !== 'HECHO').length; if (n) badge = `<span class="ml-1.5 px-1.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold">${n}</span>`; }
    if (id === 'productos' && d.items.length) badge = `<span class="ml-1.5 px-1.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold">${d.items.length}</span>`;
    if (id === 'postular') {
      const docsToCheck = (d.documents || []).filter(doc => doc.requires_signature || ['DECLARACION', 'ANEXO', 'ANEXO_OFERTA'].includes(doc.doc_type));
      const docsPending = docsToCheck.filter(doc => doc.status !== 'FIRMADO' && !doc.has_signature).length;
      const techPending = (d.items || []).filter(it => it.tech_sheet_status !== 'LISTA' && !it.tech_sheet_file).length;
      const adminPending = (d.checklist || []).filter(c => c.category === 'ADMINISTRATIVO' && !c.file_path && c.status !== 'HECHO').length;
      const quotePending = !(d.quotation && (d.quotation.net_amount || 0) > 0);
      const totalPending = docsPending + techPending + adminPending + (quotePending ? 1 : 0);
      if (totalPending > 0) {
        badge = `<span class="ml-1.5 px-1.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold">${totalPending}</span>`;
      } else {
        badge = `<span class="ml-1.5 px-1.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold"><svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></span>`;
      }
    }
    const isPostular = id === 'postular';
    const activeClass = ws.tab === id
      ? (isPostular ? 'border-indigo-500 text-indigo-700 font-extrabold bg-indigo-50' : 'border-blue-500 text-blue-700 font-bold')
      : (isPostular ? 'border-transparent text-indigo-700 hover:text-indigo-700 font-semibold bg-indigo-50' : 'border-transparent text-slate-600 hover:text-slate-900');
    return `<button onclick="wsSetTab('${id}')" class="px-4 py-2.5 text-sm flex items-center space-x-1.5 border-b-2 rounded-t-lg transition-all ${activeClass}"><i data-lucide="${icon}" class="w-4 h-4"></i><span>${label}</span>${badge}</button>`;
  }).join('');
  renderWsTab();
  lucide.createIcons();
  wsRenderPostAwardBanner();
  wsRenderClarificationsBanner();
}
function wsSetTab(t) { ws.tab = t; renderWorkspace(); }

async function wsSetStage(status, pct) {
  let ocAmount = undefined;
  let ocNumber = undefined;
  if (status === 'ADJUDICADA' || status === 'EN_EJECUCION') {
    const cur = ws.data?.folder?.awarded_amount || ws.data?.financials?.total_cotizado_neto || ws.data?.folder?.budget_amount || 0;
    const input = prompt('Monto Neto Adjudicado en la Orden de Compra (OC):\n(Este valor computará la Venta Neta real de la carpeta)', cur > 0 ? Math.round(cur) : '');
    if (input === null) return; // cancelado por usuario
    ocAmount = parseFloat(String(input).replace(/[^\d.-]/g, '')) || 0;
    const ocPrompt = prompt('N° de Orden de Compra (opcional):', ws.data?.folder?.oc_number || '');
    if (ocPrompt !== null) ocNumber = ocPrompt.trim();
  }
  try {
    await wsApi(`/api/folders/${ws.id}/status`, jsonOpts('PUT', { status, progress_pct: pct, awarded_amount: ocAmount, oc_number: ocNumber }));
    await loadWorkspace();
    showToast('Avance y estado comercial actualizados');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function wsUploadFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const fd = new FormData();
  files.forEach(f => fd.append('files', f));
  showToast(`Subiendo ${files.length} archivo(s)…`, 'info');
  try {
    const res = await wsApi(`/api/workspace/${ws.id}/documents`, { method: 'POST', body: fd });
    res.jobs.filter(j => j.error).forEach(j => showToast(`${j.filename}: ${j.error}`, 'error'));
    await loadWorkspace();
    startPolling();
  } catch (e) { showToast(e.message, 'error'); }
}

function renderWsTab() {
  const el = document.getElementById('ws-tab-content');
  if (ws.tab === 'pendientes') el.innerHTML = tabPendientes();
  else if (ws.tab === 'productos') el.innerHTML = tabProductos();
  else if (ws.tab === 'cotizador') { el.innerHTML = tabCotizador(); wsQRecalc(); wsLoadBenchmarks(); }
  else if (ws.tab === 'documentos') { el.innerHTML = tabDocumentos(); }
  else if (ws.tab === 'finanzas') el.innerHTML = tabFinanzas();
  else if (ws.tab === 'postular') el.innerHTML = tabPostular();
  lucide.createIcons();
}

// ---------------------------------------------------------------- PENDIENTES
const CAT = {
  ADMINISTRATIVO: ['<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>', 'Antecedente administrativo a adjuntar', 'text-teal-700'],
  FIRMA: ['<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 2 4 4-12 12H6v-4L18 2z"/><path d="m14 6 4 4"/></svg>', 'Firma / timbre obligatorio', 'text-indigo-700'],
  EXCLUYENTE: ['<svg class="w-3.5 h-3.5 inline text-rose-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>', 'Requisito excluyente', 'text-rose-700'],
  DOCUMENTO: ['<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>', 'Documento a adjuntar', 'text-blue-700'],
  GARANTIA: ['<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>', 'Garantía', 'text-amber-700'],
  MUESTRA: ['<svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2v7.31"/><path d="M14 9.3V2"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/></svg>', 'Muestra', 'text-emerald-700'],
  OTRO: ['<svg class="w-3.5 h-3.5 inline text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>', 'Otro', 'text-slate-700']
};
const RISK = { MULTA: ['<svg class="w-3.5 h-3.5 inline text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/></svg>', 'Multas'], GARANTIA: ['<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>', 'Garantías'], CRITERIO: ['<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h18"/></svg>', 'Criterios de evaluación'], EXCLUYENTE: ['<svg class="w-3.5 h-3.5 inline text-rose-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>', 'Excluyentes'], CONDICION: ['<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>', 'Condiciones especiales'], PLAZO: ['<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', 'Plazos'] };
const SEV = { ALTA: 'bg-rose-50 text-rose-700 border-rose-200', MEDIA: 'bg-amber-50 text-amber-700 border-amber-200', BAJA: 'bg-slate-100 text-slate-700 border-slate-300' };

const CANONICAL_MILESTONES = [
  { kind: 'PUBLICACION', label: 'Fecha de Publicación', icon: '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>', desc: 'Publicación oficial en Mercado Público', isCritical: false },
  { kind: 'INICIO_PREGUNTAS', label: 'Inicio de Preguntas', icon: '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>', desc: 'Apertura del foro de preguntas de oferentes', isCritical: false },
  { kind: 'CIERRE_PREGUNTAS', label: 'Cierre de Preguntas', icon: '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>', desc: 'Límite para ingresar consultas técnicas/administrativas', isCritical: false },
  { kind: 'RESPUESTAS', label: 'Fecha de Respuestas / Aclaraciones', icon: '<svg class="w-3.5 h-3.5 inline text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>', desc: 'Publicación del acta de respuestas a consultas', isCritical: false },
  { kind: 'CIERRE_OFERTAS', label: 'Cierre de Recepción de Ofertas', icon: '<svg class="w-3.5 h-3.5 inline text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>', desc: 'Límite fatal para enviar oferta y anexos', isCritical: true },
  { kind: 'APERTURA', label: 'Apertura Técnica y Económica', icon: '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>', desc: 'Apertura formal de las propuestas ingresadas', isCritical: false },
  { kind: 'ADJUDICACION', label: 'Fecha Estimada de Adjudicación', icon: '<svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>', desc: 'Resolución de adjudicación de la licitación', isCritical: false },
  { kind: 'MUESTRAS', label: 'Plazo / Entrega de Muestras', icon: '<svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2v7.31"/><path d="M14 9.3V2"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/></svg>', desc: 'Fecha límite o plazo hábil para entregar muestras físicas', isCritical: false }
];

function findMilestoneMatch(cm, milestones, folder, samples) {
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const kindAliases = {
    PUBLICACION: ['PUBLICACION', 'PUBLICATION'],
    INICIO_PREGUNTAS: ['INICIO_PREGUNTAS', 'QUESTIONS_START'],
    CIERRE_PREGUNTAS: ['CIERRE_PREGUNTAS', 'QUESTIONS_END'],
    RESPUESTAS: ['RESPUESTAS', 'ANSWERS'],
    CIERRE_OFERTAS: ['CIERRE_OFERTAS', 'CIERRE', 'OFFER_CLOSE'],
    APERTURA: ['APERTURA', 'OPENING'],
    ADJUDICACION: ['ADJUDICACION', 'AWARD'],
    MUESTRAS: ['MUESTRAS', 'SAMPLES']
  };
  const validKinds = kindAliases[cm.kind] || [cm.kind];
  let found = (milestones || []).find(m => validKinds.includes((m.kind || '').toUpperCase()));
  if (found) return found;

  const matchHeuristic = (m) => {
    const text = norm((m.title || '') + ' ' + (m.rule_text || ''));
    switch (cm.kind) {
      case 'PUBLICACION':
        return text.includes('publicac');
      case 'INICIO_PREGUNTAS':
        return text.includes('inicio') && text.includes('pregunta');
      case 'CIERRE_PREGUNTAS':
        return (text.includes('cierre') || text.includes('fin') || text.includes('termino')) && text.includes('pregunta');
      case 'RESPUESTAS':
        return text.includes('respuesta') || text.includes('aclaracion');
      case 'CIERRE_OFERTAS':
        return (text.includes('cierre') || text.includes('recepcion') || text.includes('limite')) && (text.includes('oferta') || text.includes('postulac') || text.includes('propuesta'));
      case 'APERTURA':
        return text.includes('apertura');
      case 'ADJUDICACION':
        return text.includes('adjudicac');
      case 'MUESTRAS':
        return text.includes('muestra');
      default:
        return false;
    }
  };

  found = (milestones || []).find(matchHeuristic);
  if (found) return found;

  if (cm.kind === 'PUBLICACION' && folder?.publication_date) {
    return { kind: 'PUBLICACION', title: cm.label, due_date: folder.publication_date, rule_text: 'Fecha registrada en la carpeta' };
  }
  if (cm.kind === 'CIERRE_OFERTAS' && folder?.tender_closing_date) {
    return { kind: 'CIERRE_OFERTAS', title: cm.label, due_date: folder.tender_closing_date, rule_text: 'Cierre registrado en la carpeta' };
  }
  if (cm.kind === 'MUESTRAS') {
    const sampleText = samples?.required
      ? `Las bases EXIGEN muestras físicas. ${samples.place ? 'Lugar: ' + samples.place + ' · ' : ''}${samples.detail || ''}`
      : (samples?.detail || 'No se detectaron exigencias de muestras físicas.');
    if (found) {
      if (!found.rule_text || found.rule_text === cm.desc) found.rule_text = sampleText;
      return found;
    }
    if (samples?.deadline || samples?.required) {
      return { kind: 'MUESTRAS', title: cm.label, due_date: samples.deadline || null, rule_text: sampleText };
    }
  }

  return null;
}

function wsOpenMilestoneModalSlot(idx) {
  const slot = ws._milestoneSlots?.[idx];
  if (!slot) return;
  const { cm, match } = slot;
  wsOpenMilestoneModal(cm.kind, cm.label, match?.due_date || '', match?.rule_text || '');
}

function wsOpenMilestoneModal(kind, label, currentDate, currentRule) {
  let datePart = '';
  let timePart = '';
  if (currentDate) {
    const parts = String(currentDate).trim().split(/[ T]/);
    datePart = parts[0] || '';
    if (parts[1]) {
      timePart = parts[1].slice(0, 5);
    }
  }

  const html = `
    <div class="space-y-4 text-xs">
      <div class="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
        <div class="font-bold text-slate-950 text-sm mb-1">${esc(label)}</div>
        <div class="text-[11px] text-slate-600">Modifica o define manualmente la fecha y hora oficial para este hito del cronograma.</div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-slate-600 font-semibold mb-1">Fecha</label>
          <input type="date" id="ms-modal-date" value="${esc(datePart)}" class="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-950 focus:outline-none focus:border-blue-500">
        </div>
        <div>
          <label class="block text-slate-600 font-semibold mb-1">Hora (opcional)</label>
          <input type="time" id="ms-modal-time" value="${esc(timePart)}" class="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-950 focus:outline-none focus:border-blue-500">
        </div>
      </div>
      <div>
        <label class="block text-slate-600 font-semibold mb-1">Detalle o nota de bases (opcional)</label>
        <textarea id="ms-modal-rule" rows="2" class="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-950 focus:outline-none focus:border-blue-500" placeholder="Ej: Bases Técnicas numeral 4.2">${esc(currentRule || '')}</textarea>
      </div>
      <div class="flex items-center justify-between pt-2 border-t border-slate-200">
        ${currentDate ? `<button type="button" onclick="wsDeleteMilestone('${kind}')" class="text-rose-700 hover:text-rose-700 font-semibold">Eliminar fecha</button>` : '<div></div>'}
        <div class="flex items-center space-x-2">
          <button type="button" onclick="closePfModal()" class="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">Cancelar</button>
          <button type="button" onclick="wsSaveMilestone('${kind}', '${esc(label)}')" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold">Guardar Hito</button>
        </div>
      </div>
    </div>
  `;
  pfModal(`Definir Hito: ${label}`, html, false);
}

async function wsSaveMilestone(kind, label) {
  const dateVal = document.getElementById('ms-modal-date')?.value?.trim();
  const timeVal = document.getElementById('ms-modal-time')?.value?.trim();
  const ruleVal = document.getElementById('ms-modal-rule')?.value?.trim();

  let due_date = null;
  if (dateVal) {
    due_date = timeVal ? `${dateVal} ${timeVal}` : dateVal;
  }

  try {
    await wsApi(`/api/workspace/${ws.id}/milestones/${kind}`, jsonOpts('PUT', {
      due_date: due_date,
      title: label,
      rule_text: ruleVal
    }));
    closePfModal();
    showToast(`Hito '${label}' guardado`);
    await loadWorkspace();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function wsDeleteMilestone(kind) {
  if (!confirm('¿Deseas quitar la fecha de este hito?')) return;
  try {
    await wsApi(`/api/workspace/${ws.id}/milestones/${kind}`, { method: 'DELETE' });
    closePfModal();
    showToast('Fecha eliminada');
    await loadWorkspace();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function wsOpenCriterionModal(id, criterion, weight, detail) {
  const isEdit = Boolean(id);
  const html = `
    <div class="space-y-4 text-xs">
      <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 text-slate-700">
        ${isEdit ? 'Modifica el criterio de evaluación y su ponderación.' : 'Ingresa el criterio de evaluación de la oferta (según bases) y su ponderación porcentual.'}
      </div>
      <div>
        <label class="block text-slate-600 font-semibold mb-1">Nombre del Criterio</label>
        <input id="crit-modal-name" type="text" value="${esc(criterion || '')}" placeholder="Ej: Precio de la Oferta" class="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-950">
      </div>
      <div>
        <label class="block text-slate-600 font-semibold mb-1">Ponderación (%)</label>
        <input id="crit-modal-weight" type="number" min="0" max="100" step="1" value="${weight || ''}" placeholder="Ej: 40" class="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-950 font-bold">
      </div>
      <div>
        <label class="block text-slate-600 font-semibold mb-1">Detalle / Fórmula de Evaluación (opcional)</label>
        <textarea id="crit-modal-detail" rows="3" placeholder="Ej: Precio mínimo / Precio oferente * 100" class="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-950">${esc(detail || '')}</textarea>
      </div>
      <div class="flex items-center justify-between pt-2 border-t border-slate-200">
        ${isEdit ? `<button type="button" onclick="wsDeleteCriterion(${id})" class="text-rose-700 hover:text-rose-700 font-semibold">Eliminar</button>` : '<div></div>'}
        <div class="flex items-center space-x-2">
          <button type="button" onclick="closePfModal()" class="px-3 py-2 rounded-lg bg-slate-100 text-slate-700">Cancelar</button>
          <button type="button" onclick="wsSaveCriterion(${id || 'null'})" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold">${isEdit ? 'Actualizar' : 'Agregar'}</button>
        </div>
      </div>
    </div>
  `;
  pfModal(isEdit ? 'Editar Criterio de Evaluación' : 'Agregar Criterio de Evaluación', html, false);
}

async function wsSaveCriterion(id) {
  const criterion = document.getElementById('crit-modal-name')?.value?.trim();
  const weight_pct = parseFloat(document.getElementById('crit-modal-weight')?.value) || 0;
  const detail = document.getElementById('crit-modal-detail')?.value?.trim();
  if (!criterion) return showToast('El nombre del criterio es obligatorio', 'error');

  try {
    if (id) {
      await wsApi(`/api/workspace/criteria/${id}`, jsonOpts('PUT', { criterion, weight_pct, detail }));
      showToast('Criterio actualizado');
    } else {
      await wsApi(`/api/workspace/${ws.id}/criteria`, jsonOpts('POST', { criterion, weight_pct, detail }));
      showToast('Criterio agregado');
    }
    closePfModal();
    await loadWorkspace();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function wsDeleteCriterion(id) {
  if (!confirm('¿Deseas eliminar este criterio de evaluación?')) return;
  try {
    await wsApi(`/api/workspace/criteria/${id}`, { method: 'DELETE' });
    closePfModal();
    showToast('Criterio eliminado');
    await loadWorkspace();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function wsAddAdminAntecedent() {
  const title = prompt('Nombre del antecedente administrativo a adjuntar:\n(Ej: Certificado F30-1, Patente municipal al día, Estatutos actualizados, Copia Cédula Identidad)');
  if (!title) return;
  try {
    await wsApi(`/api/workspace/${ws.id}/checklist`, jsonOpts('POST', { title, category: 'ADMINISTRATIVO' }));
    await loadWorkspace();
    showToast('Antecedente administrativo agregado');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function wsReanalyzeAll() {
  if (!confirm('¿Deseas volver a analizar los documentos de esta carpeta con el motor de IA vigente?')) return;
  try {
    showToast('Iniciando re-análisis con IA...', 'info');
    const res = await wsApi(`/api/workspace/${ws.id}/reanalyze-all`, { method: 'POST' });
    showToast(res.message);
    await loadWorkspace();
    startPolling();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function wsOpenAwardedModal() {
  const cur = ws.data?.folder?.awarded_amount || ws.data?.financials?.total_cotizado_neto || ws.data?.folder?.budget_amount || 0;
  const oc = ws.data?.folder?.oc_number || '';
  const html = `
    <div class="space-y-4 text-xs">
      <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 text-slate-700">
        Ingresa el monto neto exacto de la Orden de Compra (OC) adjudicada. Este valor definirá la Venta Neta oficial de la carpeta para el costeo contable.
      </div>
      <div>
        <label class="block text-slate-600 font-semibold mb-1">Monto Neto OC ($)</label>
        <input id="modal-oc-amount" type="number" value="${cur ? Math.round(cur) : ''}" class="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-950 font-bold text-sm">
      </div>
      <div>
        <label class="block text-slate-600 font-semibold mb-1">N° de Orden de Compra (opcional)</label>
        <input id="modal-oc-number" type="text" value="${esc(oc)}" placeholder="Ej: 2770-144-OC26" class="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-950">
      </div>
      <div class="flex justify-end space-x-2 pt-2 border-t border-slate-200">
        <button type="button" onclick="closePfModal()" class="px-3 py-2 rounded-lg bg-slate-100 text-slate-700">Cancelar</button>
        <button type="button" onclick="wsSaveAwardedAmount()" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold">Guardar Monto OC</button>
      </div>
    </div>
  `;
  pfModal('<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Registrar Monto Adjudicado en OC', html, false);
}

async function wsSaveAwardedAmount() {
  const amt = parseFloat(document.getElementById('modal-oc-amount')?.value) || 0;
  const oc = document.getElementById('modal-oc-number')?.value?.trim() || '';
  try {
    await wsApi(`/api/workspace/${ws.id}/awarded-amount`, jsonOpts('PUT', { awarded_amount: amt, oc_number: oc }));
    closePfModal();
    showToast('Monto de Orden de Compra guardado');
    await loadWorkspace();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function tabPendientes() {
  const d = ws.data, f = d.folder;
  const hasAnalysis = d.checklist.length || d.risks.length || d.milestones.length || d.items.length;
  if (!hasAnalysis && !d.jobs.length) {
    return `<div class="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-10 text-center space-y-3">
      <div class="text-4xl"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg></div>
      <h3 class="font-heading font-bold text-lg text-slate-950">Esta carpeta aún no tiene documentos</h3>
      <p class="text-sm text-slate-600 max-w-xl mx-auto">Sube las bases técnicas, administrativas, anexos o el requerimiento del cliente. La IA los leerá y la carpeta se configurará sola: productos con especificaciones, cotizador, checklist de pendientes, firmas, muestras, hitos y riesgos.</p>
      <button onclick="document.getElementById('ws-file-input').click()" class="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg">Subir bases y archivos</button>
      <div class="pt-3"><button onclick="wsPasteText()" class="text-xs text-slate-600 hover:text-blue-700 underline">o pega el texto del requerimiento</button></div></div>`;
  }
  const cl = d.checklist, pend = cl.filter(c => c.status !== 'HECHO');
  const firmasPend = pend.filter(c => c.requires_signature).length;
  const riesgosReales = (d.risks || []).filter(r => 
    (r.severity === 'ALTA' || r.severity === 'MEDIA') &&
    !r.title.toLowerCase().includes('no se detect') &&
    !r.detail.toLowerCase().includes('no se detect') &&
    !r.title.toLowerCase().includes('sin garantías')
  );
  const riesgosAltos = riesgosReales.filter(r => r.severity === 'ALTA').length;
  const next = d.milestones.filter(m => m.due_date && daysUntil(m.due_date) >= 0).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const tile = (label, value, sub, color, onclick, tooltip) => `<div ${onclick ? `onclick="${onclick}" class="cursor-pointer hover:border-blue-500/50 transition-all ` : 'class="' }bg-white border border-slate-200 rounded-xl p-4 shadow-sm group" ${tooltip ? `title="${esc(tooltip)}"` : ''}><div class="flex items-center justify-between"><div class="text-[11px] text-slate-500 uppercase font-semibold">${label}</div>${onclick ? '<span class="text-[10px] text-blue-700 group-hover:underline flex items-center space-x-0.5"><span>Ver</span> <i data-lucide="external-link" class="w-2.5 h-2.5 inline"></i></span>' : ''}</div><div class="text-2xl font-heading font-bold ${color} mt-1">${value}</div><div class="text-[11px] text-slate-600 mt-0.5">${sub}</div></div>`;

  let html = `<div class="grid grid-cols-2 lg:grid-cols-5 gap-3">
    ${tile('Checklist', `${cl.length - pend.length}/${cl.length}`, 'ítems completados', 'text-emerald-700')}
    ${tile('Firmas pendientes', firmasPend, 'documentos por firmar', firmasPend ? 'text-indigo-700' : 'text-emerald-700', 'wsSetTab(\'documentos\')', 'Ver documentos a firmar')}
    ${tile('Puntos críticos', riesgosReales.length, riesgosAltos ? `${riesgosAltos} severidad alta` : (riesgosReales.length ? `${riesgosReales.length} alertas activas` : 'sin riesgos críticos'), riesgosAltos ? 'text-rose-700' : (riesgosReales.length ? 'text-amber-700' : 'text-emerald-700'), 'wsOpenRisksModal()', 'Haz clic para ver los riesgos y condiciones críticas')}
    ${tile('Próximo hito', next ? fmtDate(next.due_date) : '—', next ? esc(next.title) + ` (en ${daysUntil(next.due_date)} d)` : (f.publication_date ? 'sin hitos futuros' : 'indica la fecha de publicación'), 'text-amber-700')}
    ${tile('Foro Inverso / Subsanar', ws._clarificationsCount || '0', 'solicitudes mandante', ws._clarificationsCount ? 'text-amber-700 font-bold' : 'text-slate-600', 'wsOpenClarificationsModal()', 'Abrir panel de subsanaciones y foro inverso')}
  </div>`;

  // Advertencias del análisis y botón de re-análisis
  const warns = d.summary?.warnings || [];
  if (warns.length) {
    html += `<div class="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div class="space-y-1">
        ${warns.map(w => `<div class="flex items-start space-x-1.5"><span class="shrink-0"><svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span><span>${esc(w)}</span></div>`).join('')}
      </div>
      <div class="flex items-center space-x-2 shrink-0">
        <button type="button" onclick="wsReanalyzeAll()" class="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs inline-flex items-center space-x-1 shadow transition-colors">
          <span>Re-analizar bases con IA</span>
        </button>
        <button type="button" onclick="switchTab('companies')" class="text-xs underline text-amber-700 hover:text-slate-950">Configurar IA</button>
      </div>
    </div>`;
  }

  // Hitos + Muestras + Metadatos
  const sm = d.summary?.samples || {};
  const meta = d.summary?.meta || {};

  ws._milestoneSlots = [];
  const matchedIds = new Set();
  const timelineRows = CANONICAL_MILESTONES.map((cm, idx) => {
    const match = findMilestoneMatch(cm, d.milestones, f, sm);
    if (match && match.id) matchedIds.add(match.id);
    ws._milestoneSlots[idx] = { cm, match };
    const dd = match?.due_date ? daysUntil(match.due_date) : null;
    const isCritical = cm.isCritical;

    let dateHtml = '';
    let badgeHtml = '';
    if (match?.due_date) {
      const cls = dd === null ? 'text-slate-900' : (dd < 0 ? 'text-slate-600' : (dd <= 3 ? 'text-rose-700 font-bold' : 'text-emerald-700 font-bold'));
      dateHtml = `<div class="${cls} text-sm font-semibold">${esc(fmtDateTime(match.due_date))}</div>`;
      if (dd !== null) {
        if (dd < 0) {
          badgeHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600">Vencido hace ${-dd} d</span>`;
        } else if (dd === 0) {
          badgeHtml = `<span class="px-2.5 py-0.5 rounded text-[10px] font-extrabold bg-rose-50 text-rose-700 border border-rose-200 animate-pulse">¡VENCE HOY!</span>`;
        } else if (dd <= 3) {
          badgeHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">Vence en ${dd} d</span>`;
        } else {
          badgeHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">En ${dd} días</span>`;
        }
      }
    } else {
      dateHtml = `<div class="text-xs text-slate-500 italic">No especificado en bases</div>`;
    }

    let criticalBadge = '';
    if (isCritical) {
      criticalBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase bg-rose-50 text-rose-700 border border-rose-300 flex items-center space-x-1 shrink-0"><span class="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse"></span><span>Límite de Ofertas</span></span>`;
    }

    const editBtn = `<button type="button" onclick="wsOpenMilestoneModalSlot(${idx})" class="px-2.5 py-1 text-xs rounded-lg ${match?.due_date ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-950' : 'bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold border border-blue-200'} flex items-center space-x-1 shrink-0 transition-colors" title="Editar fecha y hora">
      <i data-lucide="edit-3" class="w-3.5 h-3.5 text-blue-700"></i>
      <span>${match?.due_date ? 'Editar' : 'Definir'}</span>
    </button>`;

    // Detalle del hito (si es muestras, incorpora el detalle de muestras directamente en el hito 8)
    let detailText = match?.rule_text || cm.desc;
    if (cm.kind === 'MUESTRAS' && sm.required) {
      detailText = `Las bases EXIGEN muestras físicas. ${sm.place ? 'Lugar: ' + sm.place + ' · ' : ''}${sm.detail || ''}`;
    }

    return `
      <div class="flex items-start justify-between gap-3 p-3 rounded-xl ${isCritical ? 'bg-rose-50 border border-rose-200' : 'bg-slate-50 border border-slate-200'} hover:border-slate-300 transition-colors">
        <div class="flex items-start space-x-3 flex-1 min-w-0">
          <div class="w-7 h-7 rounded-lg ${isCritical ? 'bg-rose-50 text-rose-700 border border-rose-200 font-bold' : 'bg-slate-100 text-slate-700 border border-slate-300'} flex items-center justify-center text-xs shrink-0 mt-0.5">
            ${idx + 1}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center space-x-2 flex-wrap gap-y-1">
              <span class="text-xs font-bold text-slate-900">${cm.icon} ${esc(cm.label)}</span>
              ${criticalBadge}
              ${badgeHtml}
            </div>
            <div class="mt-1">${dateHtml}</div>
            <div class="text-[11px] text-slate-600 mt-0.5 leading-relaxed" title="${esc(detailText)}">${esc(detailText)}</div>
          </div>
        </div>
        <div class="shrink-0 self-center">${editBtn}</div>
      </div>
    `;
  }).join('');

  const extraMilestones = d.milestones.filter(m => !matchedIds.has(m.id));
  const extraHtml = extraMilestones.length ? `
    <div class="pt-3 border-t border-slate-200 space-y-2">
      <div class="text-[11px] font-bold uppercase text-slate-600 tracking-wider">Otros Hitos Detectados</div>
      ${extraMilestones.map(m => {
        const dd = daysUntil(m.due_date);
        return `
          <div class="flex items-start justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
            <div>
              <div class="font-semibold text-slate-900">${esc(m.title)}</div>
              <div class="text-[11px] text-slate-500">${esc(m.rule_text || '')}</div>
            </div>
            <div class="text-right shrink-0">
              <div class="font-bold text-slate-700">${m.due_date ? esc(fmtDateTime(m.due_date)) : '<span class="text-slate-500 italic">Sin fecha</span>'}</div>
              ${dd !== null ? `<div class="text-[10px] text-slate-500">${dd >= 0 ? 'En ' + dd + ' d' : 'Vencido'}</div>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  ` : '';

  // ---------------------------------------------------------------- Columna Derecha: Criterios de Evaluación
  const criteriaList = (d.criteria && d.criteria.length) ? d.criteria : (d.summary?.evaluation_criteria || []);
  const totalWeight = criteriaList.reduce((acc, c) => acc + (Number(c.weight_pct) || 0), 0);
  const is100 = Math.round(totalWeight) === 100;

  const criteriaRows = criteriaList.length ? criteriaList.map(c => `
    <div class="flex items-start justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition-colors">
      <div class="flex items-start space-x-3 flex-1 min-w-0">
        <div class="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 font-bold text-xs shrink-0 mt-0.5">
          ${c.weight_pct}%
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-bold text-xs text-slate-900">${esc(c.criterion)}</div>
          ${c.detail ? `<div class="text-[11px] text-slate-600 mt-0.5 leading-relaxed">${esc(c.detail)}</div>` : ''}
          ${c.source_page ? `<div class="text-[10px] text-slate-500 mt-0.5">Fuente: pág. ${c.source_page}</div>` : ''}
        </div>
      </div>
      <div class="flex items-center space-x-1 shrink-0">
        ${c.id ? `<button type="button" onclick="wsOpenCriterionModal(${c.id}, '${esc(c.criterion)}', ${c.weight_pct}, '${esc(c.detail || '')}')" class="p-1 text-slate-600 hover:text-blue-700" title="Editar criterio"><i data-lucide="edit-2" class="w-3.5 h-3.5"></i></button>` : ''}
        ${c.id ? `<button type="button" onclick="wsDeleteCriterion(${c.id})" class="p-1 text-slate-600 hover:text-rose-700" title="Eliminar"><i data-lucide="trash" class="w-3.5 h-3.5"></i></button>` : ''}
      </div>
    </div>
  `).join('') : `
    <div class="text-center py-8 border border-dashed border-slate-200 rounded-xl space-y-2">
      <div class="text-2xl"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h18"/></svg></div>
      <p class="text-xs text-slate-600">Aún no se han registrado criterios de evaluación de la oferta.</p>
      <button type="button" onclick="wsOpenCriterionModal()" class="px-3 py-1.5 text-xs rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold border border-blue-200 transition-colors">+ Agregar Criterio</button>
    </div>
  `;

  const criteriaCard = `
    <div class="bg-white border border-slate-200 rounded-xl p-5 space-y-4 flex flex-col justify-between">
      <div class="space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <div>
            <h3 class="font-bold text-sm text-slate-950 flex items-center space-x-2">
              <span>Criterios de Evaluación y Ponderaciones</span>
            </h3>
            <p class="text-[11px] text-slate-600">Tabla de evaluación y ponderación de la oferta extraída de las bases.</p>
          </div>
          <div class="flex items-center space-x-2 shrink-0">
            <span class="px-2.5 py-0.5 rounded text-[11px] font-bold ${is100 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">Total: ${totalWeight}%</span>
            <button type="button" onclick="wsOpenCriterionModal()" class="px-2.5 py-1 text-xs rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors" title="Agregar Criterio">+ Criterio</button>
          </div>
        </div>
        <div class="space-y-2.5">
          ${criteriaRows}
        </div>
      </div>
      <div class="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div class="bg-slate-50 p-3 rounded-lg border border-slate-200">
          <div class="text-[10px] text-slate-500 uppercase font-semibold">Presupuesto Estimado MP</div>
          <div class="font-bold text-slate-900 text-sm mt-0.5">${formatCLP(f.budget_amount)} <span class="text-[10px] text-slate-600 font-normal">${meta.budget_includes_iva ? '(IVA inc.)' : '(Referencial bases)'}</span></div>
        </div>
        <div class="bg-slate-50 p-3 rounded-lg border border-slate-200">
          <div class="text-[10px] text-slate-500 uppercase font-semibold">Lugar de Entrega</div>
          <div class="font-semibold text-slate-900 mt-0.5 truncate" title="${esc(meta.delivery_place || 'Según bases')}">${esc(meta.delivery_place || 'Según bases técnicas')}</div>
        </div>
      </div>
    </div>
  `;

  // Grid principal 2 Columnas: Cronograma (Izq) vs Criterios de Evaluación (Der)
  html += `<div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
    <div class="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h3 class="font-bold text-sm text-slate-950 flex items-center space-x-2">
            <span>Cronograma de Fechas e Hitos Clave</span>
          </h3>
          <p class="text-[11px] text-slate-600">Cronograma oficial ordenado de la licitación (Hitos 1 al 8).</p>
        </div>
        <div class="flex items-center space-x-1.5 shrink-0">
          <label class="text-[11px] text-slate-600 flex items-center space-x-1.5">
            <span>Publicación:</span>
            <input type="date" value="${esc((f.publication_date || '').slice(0, 10))}" onchange="wsSetPublication(this.value)" class="bg-white border border-slate-300 rounded px-2 py-0.5 text-xs text-slate-950 cursor-pointer" title="Cambiar fecha de publicación base">
          </label>
        </div>
      </div>
      <div class="space-y-2.5">
        ${timelineRows}
        ${extraHtml}
      </div>
    </div>
    ${criteriaCard}
  </div>`;

  // ---------------------------------------------------------------- Bloque Inferior 1: Documentos y Antecedentes Administrativos a Adjuntar
  const adminItems = cl.filter(c => c.category === 'ADMINISTRATIVO');
  const adminDone = adminItems.filter(i => (i.file_path && i.file_path.trim() !== '') || i.status === 'HECHO').length;
  
  html += `
    <div class="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h3 class="font-bold text-sm text-slate-950 flex items-center space-x-2">
            <span>Documentos y Antecedentes Administrativos a Adjuntar</span>
            <span class="text-xs px-2.5 py-0.5 rounded-full font-bold ${adminDone === adminItems.length && adminItems.length > 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-700'}">${adminDone}/${adminItems.length} adjuntados</span>
          </h3>
          <p class="text-xs text-slate-600">Certificados y respaldos de la empresa requeridos en las bases administrativas (Patente al día, Estatutos, Cédula rep. legal, F30/F30-1, Experiencia previa, ChileCompra).</p>
        </div>
        <button type="button" onclick="wsAddAdminAntecedent()" class="text-xs px-3 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-700 font-semibold border border-teal-200 shrink-0 transition-colors">+ Agregar antecedente</button>
      </div>
      ${adminItems.length ? `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${adminItems.map(i => {
            const hasFile = Boolean(i.file_path);
            const isDone = hasFile || i.status === 'HECHO';
            return `
              <div class="flex flex-col justify-between bg-slate-50 rounded-xl p-3.5 text-xs border ${isDone ? 'border-teal-200 bg-teal-50' : 'border-slate-200'} hover:border-slate-300 transition-colors space-y-2.5">
                <div class="flex items-start gap-2.5">
                  <input type="checkbox" ${isDone ? 'checked' : ''} onchange="wsToggleChecklist(${i.id}, this.checked)" class="mt-0.5 w-4 h-4 accent-teal-500 cursor-pointer shrink-0">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center space-x-2 flex-wrap gap-y-1">
                      <span class="font-semibold text-slate-950 ${isDone ? 'text-teal-700' : ''}">${esc(i.title)}</span>
                      ${isDone ? '<span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200 shrink-0">Listo</span>' : '<span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 shrink-0">Por adjuntar</span>'}
                    </div>
                    ${i.detail ? `<div class="text-slate-600 mt-1 leading-relaxed text-[11px]">${esc(i.detail)}</div>` : ''}
                    <div class="text-[10px] text-slate-500 mt-1">${i.source_doc ? 'Fuente: ' + esc(i.source_doc) : ''}${i.source_page ? ' · pág. ' + i.source_page : ''}</div>
                  </div>
                  <button type="button" onclick="wsDelChecklist(${i.id})" class="text-slate-500 hover:text-rose-700 p-1 shrink-0" title="Eliminar antecedente"><svg class="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </div>
                <div class="pt-2 border-t border-slate-200 flex items-center justify-between gap-2 flex-wrap">
                  ${hasFile ? `
                    <div class="flex items-center space-x-1.5 min-w-0">
                      <a href="/api/workspace/checklist/${i.id}/file" target="_blank" class="px-2.5 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 text-[11px] font-semibold flex items-center space-x-1.5 truncate transition-colors" title="Descargar o ver archivo adjunto">
                        <i data-lucide="file-check" class="w-3.5 h-3.5 text-teal-700 shrink-0"></i>
                        <span class="truncate max-w-[180px]">${esc(i.original_filename || 'Respaldo adjunto')}</span>
                      </a>
                      <button type="button" onclick="wsDeleteChecklistFile(${i.id})" class="p-1 text-slate-500 hover:text-rose-700" title="Quitar archivo adjunto"><svg class="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                    </div>
                  ` : `
                    <label class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 border border-slate-300 text-[11px] font-semibold cursor-pointer inline-flex items-center space-x-1.5 transition-colors">
                      <i data-lucide="paperclip" class="w-3.5 h-3.5 text-teal-700"></i>
                      <span>[+] Adjuntar documento/respaldo</span>
                      <input type="file" class="hidden" accept=".pdf,.png,.jpg,.jpeg,.docx" onchange="wsUploadChecklistFile(${i.id}, this.files[0])">
                    </label>
                  `}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : `
        <div class="p-6 border border-dashed border-slate-200 rounded-xl text-center text-xs text-slate-500 space-y-2">
          <p>No hay antecedentes administrativos registrados aún.</p>
          <button type="button" onclick="wsAddAdminAntecedent()" class="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold">+ Agregar primer antecedente</button>
        </div>
      `}
    </div>
  `;

  // ---------------------------------------------------------------- Bloque Inferior 2: Checklist Técnico y Fichas por Producto
  const techItems = d.items || [];
  const techReady = techItems.filter(it => it.tech_sheet_status === 'LISTA' || it.tech_sheet_file).length;

  html += `
    <div class="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h3 class="font-bold text-sm text-slate-950 flex items-center space-x-2">
            <span>Checklist Técnico y Fichas por Producto</span>
            <span class="text-xs px-2.5 py-0.5 rounded-full font-bold ${techReady === techItems.length && techItems.length > 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-700'}">${techReady}/${techItems.length} fichas listas</span>
          </h3>
          <p class="text-xs text-slate-600">Lista resumida de cada producto solicitado. Marca el estado de la ficha técnica y adjunta el PDF o imagen de respaldo del fabricante.</p>
        </div>
        <div class="flex items-center space-x-2 shrink-0">
          <button type="button" onclick="wsSetTab('productos')" class="text-xs px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors">Ver ficha completa en Productos</button>
        </div>
      </div>
      ${techItems.length ? `
        <div class="space-y-2.5">
          ${techItems.map(it => {
            const isReady = it.tech_sheet_status === 'LISTA' || Boolean(it.tech_sheet_file);
            const hasFile = Boolean(it.tech_sheet_file);
            return `
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 border ${isReady ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200'} hover:border-slate-300 transition-colors">
                <div class="flex items-start sm:items-center space-x-3 flex-1 min-w-0">
                  <div class="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 border border-slate-300 flex items-center justify-center text-xs font-bold shrink-0">
                    #${it.item_number}
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center space-x-2 flex-wrap gap-y-1">
                      <span class="font-bold text-xs text-slate-950">${esc(it.product_name)}</span>
                      <span class="px-2 py-0.2 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-300 shrink-0">${it.quantity} ${esc(it.unit)}</span>
                    </div>
                    ${it.technical_specs ? `<div class="text-[11px] text-slate-600 mt-0.5 truncate max-w-xl" title="${esc(it.technical_specs)}">${esc(it.technical_specs.split('\n')[0] || '')}</div>` : ''}
                  </div>
                </div>
                <div class="flex items-center space-x-2 shrink-0 flex-wrap gap-y-2 justify-end">
                  ${isReady ? `
                    <button type="button" onclick="wsToggleTechSheet(${it.id}, 'PENDIENTE')" class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 flex items-center space-x-1.5 transition-colors" title="Haz clic para marcar como pendiente">
                      <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
                      <span>Ficha Técnica Lista</span>
                    </button>
                  ` : `
                    <button type="button" onclick="wsToggleTechSheet(${it.id}, 'LISTA')" class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 flex items-center space-x-1.5 transition-colors" title="Haz clic para marcar como lista">
                      <span class="w-2 h-2 rounded-full bg-rose-400 animate-pulse"></span>
                      <span>Pendiente</span>
                    </button>
                  `}
                  ${hasFile ? `
                    <div class="flex items-center space-x-1.5">
                      <a href="/api/workspace/items/${it.id}/tech-sheet-file" target="_blank" class="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[11px] font-semibold flex items-center space-x-1.5 transition-colors" title="Ver / Descargar archivo de ficha técnica">
                        <i data-lucide="file-text" class="w-3.5 h-3.5 text-blue-700 shrink-0"></i>
                        <span class="truncate max-w-[140px]">${esc(it.tech_sheet_filename || 'Ficha')}</span>
                      </a>
                      <button type="button" onclick="wsDeleteTechSheetFile(${it.id})" class="p-1 text-slate-500 hover:text-rose-700 text-xs" title="Quitar archivo adjunto"><svg class="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                    </div>
                  ` : `
                    <label class="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[11px] font-semibold cursor-pointer inline-flex items-center space-x-1 transition-colors">
                      <i data-lucide="upload" class="w-3.5 h-3.5"></i>
                      <span>[+] Adjuntar Ficha</span>
                      <input type="file" class="hidden" accept=".pdf,.png,.jpg,.jpeg,.docx" onchange="wsUploadTechSheet(${it.id}, this.files[0])">
                    </label>
                  `}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : `
        <div class="p-6 border border-dashed border-slate-200 rounded-xl text-center text-xs text-slate-500 space-y-2">
          <p>No se han detectado productos en las bases aún.</p>
          <button type="button" onclick="wsSetTab('productos')" class="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold">+ Agregar productos</button>
        </div>
      `}
    </div>
  `;

  return html;
}

async function wsToggleChecklist(id, done) {
  try { await wsApi(`/api/workspace/checklist/${id}`, jsonOpts('PUT', { status: done ? 'HECHO' : 'PENDIENTE' })); await loadWorkspace(); }
  catch (e) { showToast(e.message, 'error'); }
}
async function wsAddChecklist() {
  const title = prompt('¿Qué pendiente quieres agregar?');
  if (!title) return;
  try { await wsApi(`/api/workspace/${ws.id}/checklist`, jsonOpts('POST', { title, category: 'OTRO' })); await loadWorkspace(); }
  catch (e) { showToast(e.message, 'error'); }
}
async function wsDelChecklist(id) { await wsApi(`/api/workspace/checklist/${id}`, { method: 'DELETE' }); await loadWorkspace(); }

function wsOpenRisksModal() {
  const d = ws.data;
  const riesgosReales = (d.risks || []).filter(r => 
    (r.severity === 'ALTA' || r.severity === 'MEDIA') &&
    !r.title.toLowerCase().includes('no se detect') &&
    !r.detail.toLowerCase().includes('no se detect') &&
    !r.title.toLowerCase().includes('sin garantías')
  );

  let html = `
    <div class="space-y-4 text-xs">
      <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 text-slate-700">
        Condiciones de riesgo contractual, multas y garantías críticas detectadas por la IA en las bases oficiales.
      </div>
  `;

  if (!riesgosReales.length) {
    html += `
      <div class="p-8 text-center border border-dashed border-slate-200 rounded-xl space-y-2">
        <div class="text-3xl"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
        <div class="font-bold text-slate-900">Sin condiciones de riesgo crítico</div>
        <p class="text-slate-600 text-[11px] max-w-sm mx-auto">No se identificaron cláusulas abusivas, multas graves ni exigencias de boletas desmedidas en esta licitación.</p>
      </div>
    `;
  } else {
    html += `<div class="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">`;
    riesgosReales.forEach(r => {
      const isAlta = r.severity === 'ALTA';
      const sevClass = isAlta ? 'bg-rose-50 text-rose-700 border-rose-200 font-extrabold' : 'bg-amber-50 text-amber-700 border-amber-200 font-bold';
      const [ic, klabel] = (typeof RISK !== 'undefined' && RISK[r.kind]) ? RISK[r.kind] : ['<svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>', r.kind || 'Riesgo'];
      html += `
        <div class="p-3.5 rounded-xl bg-slate-50 border ${isAlta ? 'border-rose-200 bg-rose-50' : 'border-slate-200'} space-y-1.5">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <span class="font-bold text-slate-950 flex items-center space-x-1.5 text-xs">
              <span>${ic}</span>
              <span>${esc(r.title)}</span>
            </span>
            <span class="px-2 py-0.5 rounded text-[10px] border ${sevClass}">${r.severity}</span>
          </div>
          <div class="text-slate-700 text-[11px] leading-relaxed">${esc(r.detail || '')}</div>
          ${r.source_page ? `<div class="text-[10px] text-slate-500">Bases: página ${r.source_page}</div>` : ''}
        </div>
      `;
    });
    html += `</div>`;
  }

  html += `
      <div class="flex justify-end pt-2 border-t border-slate-200">
        <button type="button" onclick="closePfModal()" class="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold transition-colors">Cerrar</button>
      </div>
    </div>
  `;
  pfModal('Puntos Críticos y Condiciones de Riesgo', html, false);
}

async function wsUploadTechSheet(itemId, file) {
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    showToast('Subiendo archivo de ficha técnica...', 'info');
    await wsApi(`/api/workspace/items/${itemId}/tech-sheet-file`, { method: 'POST', body: fd });
    showToast('Ficha técnica adjuntada exitosamente');
    await loadWorkspace();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function wsToggleTechSheet(itemId, newStatus) {
  try {
    await wsApi(`/api/workspace/items/${itemId}/tech-sheet-status`, jsonOpts('PUT', { status: newStatus }));
    showToast(`Ficha técnica marcada como ${newStatus === 'LISTA' ? 'Lista' : 'Pendiente'}`);
    await loadWorkspace();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function wsDeleteTechSheetFile(itemId) {
  if (!confirm('¿Deseas quitar el archivo de ficha técnica adjuntado?')) return;
  try {
    await wsApi(`/api/workspace/items/${itemId}/tech-sheet-file`, { method: 'DELETE' });
    showToast('Ficha técnica eliminada');
    await loadWorkspace();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function wsUploadChecklistFile(itemId, file) {
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    showToast('Subiendo documento de respaldo...', 'info');
    await wsApi(`/api/workspace/checklist/${itemId}/attach-file`, { method: 'POST', body: fd });
    showToast('Documento adjuntado exitosamente');
    await loadWorkspace();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function wsDeleteChecklistFile(itemId) {
  if (!confirm('¿Deseas quitar este archivo de respaldo adjuntado?')) return;
  try {
    await wsApi(`/api/workspace/checklist/${itemId}/file`, { method: 'DELETE' });
    showToast('Archivo eliminado');
    await loadWorkspace();
  } catch (e) {
    showToast(e.message, 'error');
  }
}
async function wsSetPublication(v) {
  try { await wsApi(`/api/workspace/${ws.id}/publication-date`, jsonOpts('PUT', { date: v })); await loadWorkspace(); showToast('Fechas recalculadas'); }
  catch (e) { showToast(e.message, 'error'); }
}
async function wsPasteText() {
  const text = prompt('Pega aquí el texto de las bases o del requerimiento:');
  if (!text) return;
  try { const r = await wsApi(`/api/workspace/${ws.id}/analyze-text`, jsonOpts('POST', { text })); showToast(r.message); await loadWorkspace(); }
  catch (e) { showToast(e.message, 'error'); }
}

// ---------------------------------------------------------------- PRODUCTOS
function specsHtml(specs) {
  return (specs || '').split('\n').filter(Boolean).map(l => l.startsWith('[')
    ? `<div class="text-[10px] uppercase font-bold text-blue-700 mt-1.5">${esc(l.slice(1, -1))}</div>`
    : `<div class="text-slate-700">• ${esc(l)}</div>`).join('');
}
function tabProductos() {
  const items = ws.data.items;
  const pending = items.filter(i => !i.in_quotation).length;
  return `<div class="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div><h3 class="font-bold text-sm text-slate-950">Productos solicitados y especificaciones técnicas</h3>
        <p class="text-xs text-slate-600">Extraídos por la IA con cita de página. Revísalos, ajusta precios y pásalos al cotizador de esta carpeta.</p></div>
      <button onclick="wsItemsToQuotation()" ${pending ? '' : 'disabled'} class="px-4 py-2 rounded-lg text-xs font-bold ${pending ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-100 text-slate-500 cursor-not-allowed'}">Pasar ${pending} producto(s) a la cotización →</button></div>
    ${items.length ? `<div class="overflow-x-auto"><table class="w-full text-left text-xs"><thead class="text-[10px] uppercase text-slate-500 border-b border-slate-200"><tr>
      <th class="py-2 px-2">#</th><th class="py-2 px-2">Producto</th><th class="py-2 px-2 w-[34%]">Especificaciones técnicas</th><th class="py-2 px-2 text-right">Cant.</th><th class="py-2 px-2 text-right">Costo unit.</th><th class="py-2 px-2 text-right">Precio unit.</th><th class="py-2 px-2">SKU</th><th class="py-2 px-2 text-center">Estado</th><th></th></tr></thead><tbody>
      ${items.map(i => `<tr class="border-b border-slate-200 align-top">
        <td class="py-2 px-2 text-slate-500">${i.item_number}</td>
        <td class="py-2 px-2"><div class="font-bold text-slate-950">${esc(i.product_name)}</div><div class="text-[10px] text-slate-500">${esc(i.source_doc || '')}${i.source_page ? ' · pág. ' + i.source_page : ''}</div></td>
        <td class="py-2 px-2 leading-relaxed">${specsHtml(i.technical_specs)}</td>
        <td class="py-2 px-2 text-right"><input type="number" value="${i.quantity}" onchange="wsItemEdit(${i.id}, 'quantity', this.value)" class="w-16 bg-white border border-slate-300 rounded px-1.5 py-1 text-right text-slate-950"> <span class="text-slate-500">${esc(i.unit)}</span></td>
        <td class="py-2 px-2 text-right"><input type="number" step="100" value="${i.estimated_cost || ''}" placeholder="0" onchange="wsItemEdit(${i.id}, 'estimated_cost', this.value)" class="w-24 bg-white border border-slate-300 rounded px-1.5 py-1 text-right text-amber-700"></td>
        <td class="py-2 px-2 text-right"><input type="number" step="100" value="${i.offered_price || ''}" placeholder="0" onchange="wsItemEdit(${i.id}, 'offered_price', this.value)" class="w-24 bg-white border border-slate-300 rounded px-1.5 py-1 text-right text-slate-950"></td>
        <td class="py-2 px-2 font-mono text-[10px] ${i.matched_sku === 'POR COTIZAR' ? 'text-amber-700' : 'text-emerald-700'}">${esc(i.matched_sku || '')}</td>
        <td class="py-2 px-2 text-center">${i.in_quotation ? '<span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold">En cotización</span>' : `<button onclick="wsItemEdit(${i.id}, 'confirmed', ${i.status === 'CONFIRMADO' ? 'false' : 'true'})" class="px-2 py-0.5 rounded ${i.status === 'CONFIRMADO' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'} font-bold">${i.status === 'CONFIRMADO' ? 'Confirmado' : 'Por revisar'}</button>`}</td>
        <td class="py-2 px-2"><button onclick="wsItemDelete(${i.id})" class="text-slate-500 hover:text-rose-700"><svg class="w-3.5 h-3.5 inline text-zinc-400 hover:text-rose-600 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="text-xs text-slate-500 py-6 text-center">Aún no hay productos. Sube las bases técnicas o agrega uno manualmente abajo.</p>'}
    <form onsubmit="wsItemAdd(event)" class="bg-slate-50 border border-slate-200 rounded-lg p-3 grid grid-cols-1 md:grid-cols-7 gap-2 text-xs">
      <input name="product_name" required placeholder="Producto" class="md:col-span-2 bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
      <input name="technical_specs" placeholder="Especificaciones (una por línea con ;)" class="md:col-span-2 bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
      <input name="quantity" type="number" value="1" min="1" class="bg-white border border-slate-300 rounded px-2 py-1.5 text-slate-950">
      <input name="offered_price" type="number" placeholder="Precio unit." class="bg-white border border-slate-300 rounded px-2 py-1.5 text-slate-950">
      <button class="bg-blue-600 hover:bg-blue-700 text-white font-bold rounded py-1.5">Agregar</button></form></div>`;
}
async function wsItemEdit(id, field, value) {
  const body = {}; body[field] = field === 'confirmed' ? !!value : value;
  try { await wsApi(`/api/workspace/items/${id}`, jsonOpts('PUT', body)); await loadWorkspace(); }
  catch (e) { showToast(e.message, 'error'); }
}
async function wsItemDelete(id) {
  if (!confirm('¿Eliminar este producto?')) return;
  await wsApi(`/api/folders/requested-items/${id}`, { method: 'DELETE' }); await loadWorkspace();
}
async function wsItemAdd(e) {
  e.preventDefault();
  const f = e.target;
  const payload = { product_name: f.product_name.value, technical_specs: f.technical_specs.value.split(';').map(s => s.trim()).filter(Boolean).join('\n') || 'Sin especificaciones',
    quantity: parseFloat(f.quantity.value) || 1, offered_price: parseFloat(f.offered_price.value) || 0 };
  try { await wsApi(`/api/folders/${ws.id}/requested-items`, jsonOpts('POST', payload)); f.reset(); await loadWorkspace(); }
  catch (err) { showToast(err.message, 'error'); }
}
async function wsItemsToQuotation() {
  try { const r = await wsApi(`/api/workspace/${ws.id}/quotation/from-items`, { method: 'POST' }); showToast(r.message); ws.tab = 'cotizador'; await loadWorkspace(); }
  catch (e) { showToast(e.message, 'error'); }
}

// ---------------------------------------------------------------- COTIZADOR
function tabCotizador() {
  const q = ws.data.quotation;
  if (!q) {
    const pending = ws.data.items.filter(i => !i.in_quotation).length;
    return `<div class="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3"><div class="text-4xl"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M16 8h-6"/><path d="M16 12h-6"/><path d="M14 16h-4"/></svg></div>
      <h3 class="font-bold text-slate-950">Esta carpeta aún no tiene cotización</h3>
      <p class="text-xs text-slate-600">${pending ? `Hay ${pending} producto(s) listos para cotizar.` : 'Primero sube las bases o agrega productos.'}</p>
      <div class="space-x-2">${pending ? '<button onclick="wsItemsToQuotation()" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-sm">Crear cotización desde los productos</button>' : ''}
      <button onclick="wsNewBlankQuotation()" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold rounded-lg text-sm">Cotización en blanco</button></div></div>`;
  }
  if (!ws.q || ws.q.id !== q.id) ws.q = JSON.parse(JSON.stringify(q));
  const qq = ws.q;
  const inp = 'bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-slate-950 w-full';
  return `<div class="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div><h3 class="font-bold text-sm text-slate-950">Cotización ${esc(q.folio)} <span class="ml-2 px-2 py-0.5 rounded text-[10px] font-bold ${q.status === 'ACEPTADA' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}">${esc(q.status)}</span></h3>
        <p class="text-xs text-slate-600">Se edita y genera aquí mismo. Cliente: ${esc(q.client_name)}</p></div>
      <div class="flex flex-wrap gap-2">
        <button onclick="wsQSave()" class="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg">Guardar</button>
        <button onclick="wsQExport('pdf')" class="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-950 text-xs font-bold rounded-lg">⬇ PDF</button>
        <button onclick="wsQExport('docx')" class="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-950 text-xs font-bold rounded-lg">⬇ Word</button>
        <button onclick="wsQStatus('ENVIADA')" class="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg">Marcar enviada</button>
        <button onclick="wsQStatus('ACEPTADA')" class="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg">Aceptada (reserva stock)</button></div></div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
      <div><label class="block text-slate-600 mb-1">Validez (días)</label><input id="wsq-validity" type="number" value="${qq.validity_days}" class="${inp}"></div>
      <div><label class="block text-slate-600 mb-1">Condiciones de pago</label><input id="wsq-payment" value="${esc(qq.payment_terms)}" class="${inp}"></div>
      <div><label class="block text-slate-600 mb-1">Plazo de entrega</label><input id="wsq-delivery" value="${esc(qq.delivery_time)}" class="${inp}"></div>
      <div><label class="block text-slate-600 mb-1">Contacto / correo</label><input id="wsq-contact" value="${esc(qq.client_email || qq.client_contact || '')}" class="${inp}"></div></div>
    <div class="overflow-x-auto"><table class="w-full text-xs"><thead class="text-[10px] uppercase text-slate-500 border-b border-slate-200"><tr>
      <th class="py-2 px-1 text-left">SKU</th><th class="py-2 px-1 text-left w-[38%]">Descripción / especificaciones</th><th class="py-2 px-1 text-right">Cant.</th><th class="py-2 px-1">Unid.</th><th class="py-2 px-1 text-right">Costo</th><th class="py-2 px-1 text-right">Precio</th><th class="py-2 px-1 text-right">Dto %</th><th class="py-2 px-1 text-right">Margen</th><th class="py-2 px-1 text-right">Subtotal</th><th></th></tr></thead><tbody id="wsq-body">
      ${ws.q.items.map((it, i) => `<tr class="border-b border-slate-200 align-top">
        <td class="py-1.5 px-1"><input value="${esc(it.sku || '')}" onchange="wsQSet(${i},'sku',this.value)" class="${inp} w-24 font-mono"></td>
        <td class="py-1.5 px-1"><textarea rows="3" onchange="wsQSet(${i},'description',this.value)" class="${inp}">${esc(it.description)}</textarea></td>
        <td class="py-1.5 px-1"><input type="number" value="${it.quantity}" oninput="wsQSet(${i},'quantity',this.value)" class="${inp} w-16 text-right"></td>
        <td class="py-1.5 px-1"><input value="${esc(it.unit)}" onchange="wsQSet(${i},'unit',this.value)" class="${inp} w-14"></td>
        <td class="py-1.5 px-1"><input type="number" value="${it.unit_cost}" oninput="wsQSet(${i},'unit_cost',this.value)" class="${inp} w-24 text-right text-amber-700"></td>
        <td class="py-1.5 px-1"><input type="number" value="${it.unit_price}" oninput="wsQSet(${i},'unit_price',this.value)" class="${inp} w-24 text-right"></td>
        <td class="py-1.5 px-1"><input type="number" value="${it.discount_pct || 0}" oninput="wsQSet(${i},'discount_pct',this.value)" class="${inp} w-14 text-right"></td>
        <td class="py-1.5 px-1 text-right font-bold" id="wsq-m-${i}">-</td>
        <td class="py-1.5 px-1 text-right font-bold text-slate-950" id="wsq-s-${i}">-</td>
        <td class="py-1.5 px-1"><button onclick="wsQRemove(${i})" class="text-slate-500 hover:text-rose-700"><svg class="w-3.5 h-3.5 inline text-zinc-400 hover:text-rose-600 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></td></tr>`).join('')}</tbody></table></div>
    <button onclick="wsQAdd()" class="text-xs px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900">+ Agregar línea</button>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div><label class="block text-xs text-slate-600 mb-1">Observaciones / condiciones comerciales</label><textarea id="wsq-notes" rows="5" class="${inp} text-xs">${esc(qq.notes || '')}</textarea>
        <label class="mt-2 flex items-center space-x-2 text-xs text-slate-700"><input type="checkbox" id="wsq-use-sig" ${ws.data.signer?.has_signature ? 'checked' : 'disabled'} class="accent-emerald-500"><span>Estampar mi firma guardada ${ws.data.signer?.has_signature ? '(' + esc(ws.data.signer.name) + ')' : '— no hay firma guardada (ver Config)'}</span></label></div>
      <div class="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2 text-xs self-start">
        <div class="flex justify-between text-slate-600"><span>Neto</span><b id="wsq-net" class="text-slate-950">$0</b></div>
        <div class="flex justify-between text-slate-600"><span>IVA 19%</span><b id="wsq-iva" class="text-slate-950">$0</b></div>
        <div class="flex justify-between text-base border-t border-slate-200 pt-2"><span class="font-bold text-slate-900">Total</span><b id="wsq-total" class="text-emerald-700">$0</b></div>
        <div class="flex justify-between text-slate-600 pt-1"><span>Costo estimado</span><b id="wsq-cost" class="text-amber-700">$0</b></div>
        <div class="flex justify-between text-slate-600"><span>Utilidad / margen estimado</span><b id="wsq-margin" class="text-emerald-700">-</b></div></div></div>
    <div id="wsq-benchmarks-container" class="mt-4 pt-4 border-t border-slate-200"></div></div>`;
}
function wsQSet(i, field, val) {
  const numeric = ['quantity', 'unit_cost', 'unit_price', 'discount_pct'];
  ws.q.items[i][field] = numeric.includes(field) ? (parseFloat(val) || 0) : val;
  wsQRecalc();
}
function wsQAdd() { syncQHeader(); ws.q.items.push({ sku: '', description: '', unit: 'UND', quantity: 1, unit_cost: 0, unit_price: 0, discount_pct: 0 }); renderWsTab(); }
function wsQRemove(i) { syncQHeader(); ws.q.items.splice(i, 1); renderWsTab(); }
function wsQRecalc() {
  if (!ws.q) return;
  let net = 0, cost = 0;
  ws.q.items.forEach((it, i) => {
    const sub = Math.round(it.quantity * it.unit_price * (1 - (it.discount_pct || 0) / 100));
    net += sub; cost += it.quantity * it.unit_cost;
    const m = it.unit_price > 0 && it.unit_cost > 0 ? ((it.unit_price - it.unit_cost) / it.unit_price * 100).toFixed(1) + '%' : '-';
    const s = document.getElementById(`wsq-s-${i}`), mm = document.getElementById(`wsq-m-${i}`);
    if (s) s.textContent = formatCLP(sub); if (mm) mm.textContent = m;
  });
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('wsq-net', formatCLP(net)); set('wsq-iva', formatCLP(net * 0.19)); set('wsq-total', formatCLP(net * 1.19)); set('wsq-cost', formatCLP(cost));
  set('wsq-margin', cost > 0 ? `${formatCLP(net - cost)} · ${net > 0 ? ((net - cost) / net * 100).toFixed(1) : 0}%` : '-');
}
function syncQHeader() {
  if (!ws.q) return;
  const g = id => document.getElementById(id)?.value;
  ws.q.validity_days = parseInt(g('wsq-validity')) || 15; ws.q.payment_terms = g('wsq-payment'); ws.q.delivery_time = g('wsq-delivery');
  ws.q.client_email = g('wsq-contact'); ws.q.notes = g('wsq-notes');
}
async function wsQSave() {
  syncQHeader();
  const body = { ...ws.q, client_contact: ws.q.client_email };
  const useSig = document.getElementById('wsq-use-sig');
  if (useSig && useSig.checked) {
    const prof = await wsApi('/api/workspace/signer-profile');
    body.signature_data_url = prof.signature_data_url; body.signer_name = prof.name; body.signer_rut = prof.rut;
  }
  try { await wsApi(`/api/workspace/${ws.id}/quotation`, jsonOpts('PUT', body)); showToast('Cotización guardada'); ws.q = null; await loadWorkspace(); }
  catch (e) { showToast(e.message, 'error'); }
}
async function wsQExport(fmt) { await wsQSave(); window.location = `/api/workspace/quotation/${ws.data.quotation.id}/export?fmt=${fmt}`; }
async function wsQStatus(st) {
  await wsQSave();
  try { await wsApi(`/api/workspace/${ws.id}/quotation/status`, jsonOpts('PUT', { status: st })); showToast(`Cotización ${st.toLowerCase()}`); await loadWorkspace(); }
  catch (e) { showToast(e.message, 'error'); }
}
async function wsNewBlankQuotation() {
  try { await wsApi(`/api/workspace/${ws.id}/quotation`, jsonOpts('PUT', { items: [{ description: '', quantity: 1, unit_price: 0 }] })); ws.q = null; await loadWorkspace(); }
  catch (e) { showToast(e.message, 'error'); }
}

// ---------------------------------------------------------------- DOCUMENTOS Y FIRMA (MERCADO PÚBLICO - PASO 3)
function tabDocumentos() {
  const chk = ws.data.checklist || [];
  const docs = ws.data.documents || [];
  const signer = ws.data.signer || {};
  const quotation = ws.data.quotation;

  const adminItems = chk.filter(c => c.category === 'ADMINISTRATIVO');
  const techItems = chk.filter(c => c.category === 'TECNICO' || c.category === 'MUESTRA');
  const econItems = chk.filter(c => c.category === 'ECONOMICO');

  // Requisitos obligatorios / conflicto de interés
  const mandatoryItems = chk.filter(c => c.category === 'REQUISITO_OBLIGATORIO');
  const conflictItem = mandatoryItems.find(c => 
    c.title.toLowerCase().includes('conflicto') || 
    c.title.toLowerCase().includes('inhabilidad')
  ) || mandatoryItems[0] || {
    id: 0,
    title: 'Declaración de ausencia de conflicto de interés e inhabilidades por condenas',
    status: 'PENDIENTE',
    detail: 'Declaración jurada obligatoria Ley N° 19.886'
  };

  const isConflictSigned = conflictItem.status === 'HECHO';

  // Clasificación estricta: Anexos Oficiales a Firmar vs Documentos de Referencia
  function isOfficialAnnex(d) {
    const name = ((d.original_filename || '') + ' ' + (d.name || '')).toLowerCase();
    // Excluir bases, decretos, resoluciones, aclaraciones, fichas de referencia
    if (name.includes('decreto') || name.includes('bases_admin') || name.includes('bases admin') ||
        name.includes('bases_tecnic') || name.includes('bases tecnic') || name.includes('respuestas') ||
        name.includes('aclaracion') || (name.includes('fichas') && !name.includes('anexo'))) {
      return false;
    }
    if (d.requires_signature || d.detected_by_ai) return true;
    if (name.includes('anexo') || name.includes('declaraci') || name.includes('formulario') || name.includes('formato') || name.includes('propuesta_econ') || name.includes('oferta_econ')) return true;
    if (['ANEXO_OFERTA', 'ANEXO_DECLARACION', 'DECLARACION', 'ANEXO'].includes(d.doc_type)) return true;
    return false;
  }

  // Anexos oficiales que requieren firma (Sección Superior Prioritaria)
  const annexDocs = docs.filter(d => isOfficialAnnex(d));

  // Bases, decretos y documentos de referencia (Sección Inferior Colapsable)
  const referenceDocs = docs.filter(d => !isOfficialAnnex(d));

  // Conteo de completitud
  const annexSignedCount = annexDocs.filter(d => d.status === 'FIRMADO' || d.has_signature || d.signed_file_path).length;
  const adminDone = adminItems.filter(c => c.file_path || c.status === 'HECHO').length;
  const techDone = techItems.filter(c => c.file_path || c.status === 'HECHO').length;
  const econDone = econItems.filter(c => c.file_path || c.status === 'HECHO').length;

  const renderChecklistCard = (it, colCategory) => {
    const hasFile = Boolean(it.file_path);
    const isDone = it.status === 'HECHO';

    return `
      <div class="bg-slate-50 border ${hasFile ? 'border-emerald-200' : 'border-slate-200'} rounded-xl p-3.5 space-y-2 hover:border-slate-300 transition">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h4 class="font-bold text-xs text-slate-950 flex items-center gap-1.5 flex-wrap">
              <span>${esc(it.title)}</span>
              ${it.is_mandatory ? '<span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200 uppercase">Obligatorio</span>' : '<span class="text-[9px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">Opcional</span>'}
            </h4>
            ${it.detail ? `<p class="text-[11px] text-slate-600 mt-1 leading-snug">${esc(it.detail)}</p>` : ''}
          </div>
          <button onclick="wsDeleteChecklistItem(${it.id})" title="Eliminar requisito" class="text-slate-600 hover:text-rose-700 p-1 rounded shrink-0">
            <i data-lucide="trash-2" class="w-3 h-3"></i>
          </button>
        </div>

        ${hasFile ? `
          <div class="mt-2 p-2 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-2">
            <div class="flex items-center space-x-1.5 min-w-0">
              <i data-lucide="file-check-2" class="w-4 h-4 text-emerald-700 shrink-0"></i>
              <span class="text-xs font-semibold text-emerald-700 truncate" title="${esc(it.original_filename || 'respaldo.pdf')}">${esc(it.original_filename || 'Respaldo adjuntado')}</span>
            </div>
            <div class="flex items-center space-x-1 shrink-0">
              <button onclick="wsDownloadChecklistFile(${it.id}, '${esc(it.original_filename || 'respaldo.pdf')}')" title="Descargar archivo" class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-emerald-700 hover:text-emerald-700 text-xs font-bold flex items-center gap-1">
                <i data-lucide="download" class="w-3 h-3"></i> Ver
              </button>
              <button onclick="wsDeleteChecklistFile(${it.id})" title="Quitar archivo adjunto" class="p-1 rounded bg-slate-100 hover:bg-rose-100 text-slate-600 hover:text-rose-700">
                <i data-lucide="x" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </div>
        ` : `
          <div class="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5">
              <span class="text-[11px] text-amber-700 font-medium flex items-center gap-1">
                <i data-lucide="alert-circle" class="w-3 h-3 text-amber-700"></i> ${isDone ? 'Acreditado sin archivo' : 'Sin archivo adjunto'}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <label class="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm transition">
                <i data-lucide="upload" class="w-3 h-3"></i>
                <span>Seleccionar archivo</span>
                <input type="file" class="hidden" accept=".pdf,.doc,.docx,.xlsx,.png,.jpg" onchange="wsUploadChecklistFile(${it.id}, this.files[0])">
              </label>
            </div>
          </div>
        `}
      </div>
    `;
  };

  return `
    <div class="space-y-6">
      <!-- 1. ENCABEZADO OFICIAL MERCADO PÚBLICO -->
      <div class="bg-gradient-to-r from-slate-50 via-white to-indigo-50 border border-slate-200 rounded-2xl p-5 shadow-lg">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <span class="px-2.5 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wide bg-blue-50 text-blue-700 border border-blue-200">
                Portal Mercado Público
              </span>
              <span class="text-xs text-slate-600 font-medium">Paso 3 de 4</span>
            </div>
            <h2 class="text-lg font-bold text-slate-950 font-heading mt-1 flex items-center gap-2">
              <span>Documentación Anexa / Requisitos para Ofertar</span>
            </h2>
            <p class="text-xs text-slate-600 mt-0.5">
              Complete y firme los anexos oficiales de las bases arriba. Luego adjunte los respaldos administrativos, técnicos y económicos requeridos.
            </p>
          </div>

          <div class="flex items-center gap-2.5 shrink-0 flex-wrap">
            <button onclick="wsOpenAddChecklistModal('ADMINISTRATIVO')" class="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-semibold flex items-center gap-1.5 border border-slate-300">
              <i data-lucide="plus" class="w-3.5 h-3.5 text-blue-700"></i> Agregar Requisito
            </button>
            <label class="cursor-pointer px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-semibold flex items-center gap-1.5 border border-slate-300">
              <i data-lucide="file-up" class="w-3.5 h-3.5 text-emerald-700"></i> Subir Bases / PDF
              <input id="ws-tab-doc-file-input" type="file" multiple class="hidden" accept=".pdf,.doc,.docx,.xlsx,.txt" onchange="wsUploadDirectDocs(this)">
            </label>
            <button onclick="wsSyncLegalVault()" class="px-3 py-2 rounded-xl bg-teal-100 hover:bg-teal-100 text-teal-700 text-xs font-semibold flex items-center gap-1.5 border border-teal-200" title="Sincronizar antecedentes laborales y legales vigentes desde la Bóveda Central">
              <i data-lucide="refresh-cw" class="w-3.5 h-3.5 text-teal-700"></i> Sincronizar Bóveda Legal
            </button>
            <button onclick="wsOpenWarrantySheetModal()" class="px-3 py-2 rounded-xl bg-amber-100 hover:bg-amber-100 text-amber-700 text-xs font-semibold flex items-center gap-1.5 border border-amber-200" title="Generar Ficha Oficial para Solicitud de Garantía Bancaria / Póliza">
              <i data-lucide="shield" class="w-3.5 h-3.5 text-amber-700"></i> Ficha de Garantías
            </button>
            <button onclick="wsSetTab('postular')" class="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md">
              <i data-lucide="package-check" class="w-3.5 h-3.5"></i> Paquete Postulación (.ZIP)
            </button>
          </div>
        </div>

        <!-- Barra de Progreso Resumida -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-200 text-xs">
          <div class="bg-slate-50 p-2.5 rounded-xl border ${annexSignedCount === annexDocs.length && annexDocs.length > 0 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}">
            <div class="text-[10px] uppercase font-semibold ${annexSignedCount === annexDocs.length && annexDocs.length > 0 ? 'text-emerald-700' : 'text-amber-700'}">Anexos a Firmar</div>
            <div class="text-sm font-bold ${annexSignedCount === annexDocs.length && annexDocs.length > 0 ? 'text-emerald-700' : 'text-amber-700'} mt-0.5">${annexSignedCount} de ${annexDocs.length} firmados</div>
          </div>
          <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
            <div class="text-[10px] text-slate-600 uppercase font-semibold">1. Administrativos</div>
            <div class="text-sm font-bold text-slate-900 mt-0.5">${adminDone} de ${adminItems.length} adjuntos</div>
          </div>
          <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
            <div class="text-[10px] text-slate-600 uppercase font-semibold">2. Técnicos</div>
            <div class="text-sm font-bold text-slate-900 mt-0.5">${techDone} de ${techItems.length} adjuntos</div>
          </div>
          <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
            <div class="text-[10px] text-slate-600 uppercase font-semibold">3. Económicos</div>
            <div class="text-sm font-bold text-slate-900 mt-0.5">${econDone} de ${econItems.length} adjuntos</div>
          </div>
        </div>
      </div>

      <!-- ========================================================================= -->
      <!-- 2. SECCIÓN SUPERIOR PRIORITARIA: ANEXOS OFICIALES DE LA LICITACIÓN A FIRMAR -->
      <!-- ========================================================================= -->
      <div class="space-y-4">
        <div class="flex items-center justify-between border-b border-slate-200 pb-2">
          <div>
            <h3 class="text-base font-bold text-slate-950 font-heading flex items-center gap-2">
              <span class="p-1.5 rounded-lg bg-indigo-50 text-indigo-700"><i data-lucide="pen-tool" class="w-4 h-4"></i></span>
              <span>Anexos Oficiales de la Licitación a Firmar</span>
            </h3>
            <p class="text-xs text-slate-600 mt-0.5">
              Anexos y formularios enviados por la entidad compradora que requieren llenado y firma digital del representante legal.
            </p>
          </div>
          <span class="px-2.5 py-1 rounded-full text-xs font-bold ${annexSignedCount === annexDocs.length && annexDocs.length > 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">
            ${annexSignedCount} de ${annexDocs.length} firmados
          </span>
        </div>

        <!-- TARJETA OFICIAL: DECLARACIÓN DE AUSENCIA DE CONFLICTO DE INTERÉS -->
        <div class="bg-gradient-to-br from-slate-50 via-white ${isConflictSigned ? 'to-emerald-50 border-2 border-emerald-300' : 'to-amber-50 border-2 border-amber-200'} rounded-2xl p-5 shadow-xl space-y-3">
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div class="space-y-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="px-2.5 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Ley N° 19.886 art. 4° · Requisito Habilitante ChileCompra
                </span>
                <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${isConflictSigned ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200 animate-pulse'}">
                  ${isConflictSigned ? 'FIRMADO Y REGISTRADO' : 'PENDIENTE DE FIRMA (OBLIGATORIO)'}
                </span>
              </div>
              <h4 class="text-base font-bold text-slate-950 font-heading">
                Declaración de ausencia de conflicto de interés e inhabilidades por condenas
              </h4>
            </div>

            <div class="shrink-0">
              ${isConflictSigned ? `
                <div class="flex items-center gap-2">
                  <span class="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                    <i data-lucide="check-check" class="w-4 h-4"></i> Listo para postulación
                  </span>
                  <button onclick="wsSignDeclaration(${conflictItem.id}, 'unsign')" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold">
                    Modificar / Deshacer
                  </button>
                </div>
              ` : `
                <button onclick="wsOpenConflictModal(${conflictItem.id})" class="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-sm flex items-center gap-2">
                  <i data-lucide="pen-tool" class="w-4 h-4"></i> Declarar y firmar
                </button>
              `}
            </div>
          </div>

          <div class="text-xs text-slate-700 bg-slate-50 p-3.5 rounded-xl border border-slate-200 leading-relaxed space-y-2">
            <p>
              El oferente declara bajo juramento no registrar condenas laborales por prácticas antisindicales (últimos 2 años), no tener conflictos de interés ni parentesco con funcionarios directivos del organismo licitante y encontrarse plenamente hábil en ChileCompra.
            </p>
            ${conflictItem.detail && conflictItem.detail.includes('[FIRMADO DIGITALMENTE') ? `
              <div class="pt-2 border-t border-slate-200 text-[11px] text-emerald-700 font-semibold font-mono">
                ${esc(conflictItem.detail.split('\n\n').slice(1).join(' '))}
              </div>
            ` : ''}
          </div>

          <!-- Perfil del Firmante -->
          <div class="flex items-center justify-between text-xs text-slate-600 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200">
            <div class="flex items-center gap-2">
              <i data-lucide="user-check" class="w-4 h-4 text-blue-700"></i>
              ${signer.has_signature ? `
                <span>Firmante Representante: <strong class="text-slate-900">${esc(signer.name)}</strong> (${esc(signer.rut || '')}) — <span class="text-emerald-700 font-semibold">Firma digital lista</span></span>
              ` : `
                <span class="text-amber-700"><svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Sin firma guardada. Ingrese a Multi-Empresa & Config para registrar la firma gráfica del representante.</span>
              `}
            </div>
            <button onclick="switchTab('companies')" class="text-blue-700 hover:underline text-[11px] font-semibold">
              ${signer.has_signature ? 'Gestionar firma' : 'Guardar firma'} ↗
            </button>
          </div>
        </div>

        <!-- LISTADO DE ANEXOS OFICIALES A COMPLETAR Y FIRMAR -->
        <div class="space-y-3">
          ${annexDocs.length ? annexDocs.map(d => {
            const isSigned = d.status === 'FIRMADO' || Boolean(d.has_signature) || Boolean(d.signed_file_path);
            const isWord = (d.original_filename || d.name || '').toLowerCase().endsWith('.docx');
            const isExcel = (d.original_filename || d.name || '').toLowerCase().endsWith('.xlsx') || (d.original_filename || d.name || '').toLowerCase().endsWith('.xls');

            return `
              <div class="bg-white border ${isSigned ? 'border-emerald-200' : 'border-slate-200'} rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:border-slate-300 transition shadow">
                <div class="space-y-1.5 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-bold text-xs text-slate-950 truncate">${esc(d.name)}</span>
                    ${isWord ? '<span class="text-[10px] px-1.5 py-0.5 rounded font-bold bg-blue-50 text-blue-700 border border-blue-200">Word Editable</span>' : ''}
                    ${isExcel ? '<span class="text-[10px] px-1.5 py-0.5 rounded font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Excel Planilla</span>' : ''}
                  </div>
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-[10px] px-2.5 py-0.5 rounded-full font-bold ${isSigned ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'} flex items-center gap-1">
                      ${isSigned ? '<i data-lucide="check-circle-2" class="w-3 h-3"></i> Firmado' : '<i data-lucide="clock" class="w-3 h-3"></i> Adjunto / Pendiente de Firma'}
                    </span>
                    <span class="text-[10px] px-2 py-0.5 rounded font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                      Exige Firma Digital
                    </span>
                    ${d.original_filename && d.original_filename !== d.name ? `<span class="text-[10px] text-slate-500">${esc(d.original_filename)}</span>` : ''}
                  </div>
                </div>

                <div class="flex items-center gap-2 shrink-0 flex-wrap">
                  <button onclick="openDocViewer(${d.id})" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center gap-1 shadow">
                    <i data-lucide="eye" class="w-3.5 h-3.5"></i> Visualizar / Editar
                  </button>
                  <button onclick="openAnnexSign(${d.id})" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 font-semibold text-xs flex items-center gap-1 border border-slate-300">
                    <i data-lucide="edit-3" class="w-3.5 h-3.5 text-blue-700"></i> Formulario rápido
                  </button>
                  ${!isSigned && signer.has_signature ? `
                    <button onclick="wsQuickSignAnnex(${d.id})" class="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs flex items-center gap-1 shadow">
                      <i data-lucide="stamp" class="w-3.5 h-3.5"></i> Estampar firma digital
                    </button>
                  ` : ''}
                  <button onclick="dvDownloadFile('/api/workspace/documents/${d.id}/annotated-pdf', 'anexo_${d.id}_final.pdf')" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold text-xs flex items-center gap-1 border border-slate-300">
                    <i data-lucide="download" class="w-3.5 h-3.5"></i> PDF
                  </button>
                  ${isSigned ? `
                    <a href="/api/workspace/documents/${d.id}/export?fmt=pdf" target="_blank" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 font-semibold text-xs flex items-center gap-1 border border-slate-300">
                      PDF formulario
                    </a>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('') : `
            <div class="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl bg-slate-50">
              Al subir las bases de la licitación (archivos Word, Excel o PDF de anexos), la IA los clasificará automáticamente en esta sección para que los completes y firmes.
            </div>
          `}
        </div>
      </div>

      <!-- ========================================================================= -->
      <!-- 3. SECCIÓN INTERMEDIA: 3 COLUMNAS OFICIALES DE MERCADO PÚBLICO            -->
      <!-- ========================================================================= -->
      <div class="space-y-4 pt-2">
        <div class="border-b border-slate-200 pb-2">
          <h3 class="text-base font-bold text-slate-950 font-heading flex items-center gap-2">
            <span>Antecedentes Requeridos en Mercado Público (3 Columnas)</span>
          </h3>
          <p class="text-xs text-slate-600 mt-0.5">
            Adjunte fila por fila los certificados de respaldo administrativos, fichas técnicas y propuesta económica.
          </p>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
          
          <!-- COLUMNA 1: ADMINISTRATIVOS -->
          <div class="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 flex flex-col">
            <div class="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <div class="flex items-center gap-1.5">
                  <span class="w-6 h-6 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-xs">1</span>
                  <h3 class="font-bold text-sm text-slate-950 font-heading">Administrativos</h3>
                </div>
                <p class="text-[11px] text-slate-600 mt-0.5">Patentes, vigencias, estatutos, F30-1 y cédula</p>
              </div>
              <span class="px-2 py-0.5 rounded-full text-xs font-bold ${adminDone === adminItems.length && adminItems.length > 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-700'}">
                ${adminDone}/${adminItems.length}
              </span>
            </div>

            <div class="space-y-3">
              ${adminItems.length ? adminItems.map(it => renderChecklistCard(it, 'ADMINISTRATIVO')).join('') : `
                <div class="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl">
                  Sin documentos administrativos requeridos.
                </div>
              `}
            </div>

            <button onclick="wsOpenAddChecklistModal('ADMINISTRATIVO')" class="w-full py-2 rounded-xl border border-dashed border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-900 text-xs font-semibold flex items-center justify-center gap-1.5 transition mt-2">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i> Agregar antecedente administrativo
            </button>
          </div>

          <!-- COLUMNA 2: TÉCNICOS -->
          <div class="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 flex flex-col">
            <div class="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <div class="flex items-center gap-1.5">
                  <span class="w-6 h-6 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold text-xs">2</span>
                  <h3 class="font-bold text-sm text-slate-950 font-heading">Técnicos</h3>
                </div>
                <p class="text-[11px] text-slate-600 mt-0.5">Fichas de prendas, normas EN ISO, certificaciones</p>
              </div>
              <span class="px-2 py-0.5 rounded-full text-xs font-bold ${techDone === techItems.length && techItems.length > 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-700'}">
                ${techDone}/${techItems.length}
              </span>
            </div>

            <div class="space-y-3">
              ${techItems.length ? techItems.map(it => renderChecklistCard(it, 'TECNICO')).join('') : `
                <div class="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl">
                  Sin requerimientos técnicos detectados.
                </div>
              `}
            </div>

            <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-600 flex items-center justify-between">
              <span>Fichas técnicas individuales por producto:</span>
              <button onclick="wsSetTab('productos')" class="text-indigo-700 hover:text-indigo-700 font-bold flex items-center gap-1">
                Ver Catálogo <i data-lucide="arrow-right" class="w-3 h-3"></i>
              </button>
            </div>

            <button onclick="wsOpenAddChecklistModal('TECNICO')" class="w-full py-2 rounded-xl border border-dashed border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-900 text-xs font-semibold flex items-center justify-center gap-1.5 transition mt-2">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i> Agregar requerimiento técnico
            </button>
          </div>

          <!-- COLUMNA 3: ECONÓMICOS -->
          <div class="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 flex flex-col">
            <div class="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <div class="flex items-center gap-1.5">
                  <span class="w-6 h-6 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold text-xs">3</span>
                  <h3 class="font-bold text-sm text-slate-950 font-heading">Económicos</h3>
                </div>
                <p class="text-[11px] text-slate-600 mt-0.5">Anexo N° 3, precios unitarios y cotización</p>
              </div>
              <span class="px-2 py-0.5 rounded-full text-xs font-bold ${econDone === econItems.length && econItems.length > 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-700'}">
                ${econDone}/${econItems.length}
              </span>
            </div>

            <div class="space-y-3">
              ${econItems.length ? econItems.map(it => renderChecklistCard(it, 'ECONOMICO')).join('') : `
                <div class="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl">
                  Sin anexos económicos requeridos.
                </div>
              `}
            </div>

            ${quotation ? `
              <div class="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-[11px] text-emerald-700 flex items-center justify-between">
                <div>
                  <div class="font-bold">Cotización Folio #${esc(quotation.folio)}</div>
                  <div class="text-[10px] text-emerald-700">Total: $${formatCLP(quotation.total_amount)}</div>
                </div>
                <button onclick="wsSetTab('cotizador')" class="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1">
                  Ir al Cotizador <i data-lucide="arrow-right" class="w-3 h-3"></i>
                </button>
              </div>
            ` : `
              <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-600 flex items-center justify-between">
                <span>Cotización formal:</span>
                <button onclick="wsSetTab('cotizador')" class="text-blue-700 hover:text-blue-700 font-bold flex items-center gap-1">
                  Crear en Cotizador <i data-lucide="arrow-right" class="w-3 h-3"></i>
                </button>
              </div>
            `}

            <button onclick="wsOpenAddChecklistModal('ECONOMICO')" class="w-full py-2 rounded-xl border border-dashed border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-900 text-xs font-semibold flex items-center justify-center gap-1.5 transition mt-2">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i> Agregar formulario económico
            </button>
          </div>

        </div>
      </div>

      <!-- ========================================================================= -->
      <!-- 4. SECCIÓN INFERIOR COLAPSABLE: BASES TÉCNICAS, ADMINISTRATIVAS Y OTROS   -->
      <!-- ========================================================================= -->
      ${referenceDocs.length ? `
        <details class="bg-white border border-slate-200 rounded-2xl overflow-hidden transition group" ${referenceDocs.length > 5 ? '' : 'open'}>
          <summary class="p-4 cursor-pointer flex items-center justify-between hover:bg-slate-200 transition select-none">
            <div class="flex items-center gap-2.5">
              <span class="p-1.5 rounded-lg bg-slate-100 text-blue-700"><i data-lucide="archive" class="w-4 h-4"></i></span>
              <div>
                <span class="font-bold text-sm text-slate-900">Bases Técnicas, Administrativas y Otros Respaldos de Referencia (${referenceDocs.length})</span>
                <div class="text-[11px] text-slate-500">Decretos alcaldicios, bases administrativas, bases técnicas y antecedentes de consulta</div>
              </div>
            </div>
            <div class="flex items-center gap-1.5 text-xs text-blue-700 font-semibold">
              <span>Ver / Ocultar</span>
              <i data-lucide="chevron-down" class="w-4 h-4 transition-transform group-open:rotate-180"></i>
            </div>
          </summary>
          
          <div class="p-4 pt-2 border-t border-slate-200 space-y-2">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              ${referenceDocs.map(d => `
                <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-2 hover:border-slate-300 transition">
                  <div class="min-w-0">
                    <div class="font-semibold text-slate-900 truncate text-xs" title="${esc(d.original_filename || d.name)}">${esc(d.original_filename || d.name)}</div>
                    <div class="text-[10px] text-slate-500 uppercase">${esc(d.doc_type || 'DOCUMENTO_REFERENCIA')}</div>
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    <button onclick="openDocViewer(${d.id})" class="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs">
                      Ver
                    </button>
                    ${d.has_file ? `
                      <button onclick="dvDownloadFile('/api/workspace/documents/${d.id}/file', ${JSON.stringify(esc(d.original_filename || 'documento')).replace(/"/g, '&quot;')})" class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-blue-700 text-xs font-semibold">
                        Descargar
                      </button>
                      <button onclick="wsReanalyze(${d.id})" class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-amber-700 text-xs font-semibold">
                        Re-analizar
                      </button>
                    ` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </details>
      ` : ''}

    </div>
  `;
}

async function wsReanalyze(docId) {
  try { await wsApi(`/api/workspace/${ws.id}/reanalyze/${docId}`, { method: 'POST' }); await loadWorkspace(); startPolling(); }
  catch (e) { showToast(e.message, 'error'); }
}

async function wsUploadDirectDocs(input) {
  if (!input.files || !input.files.length) return;
  await wsUploadFiles(input.files);
  input.value = '';
}

function wsDownloadChecklistFile(itemId, filename) {
  const url = `/api/workspace/checklist/${itemId}/file`;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'respaldo.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function wsDeleteChecklistItem(itemId) {
  if (!confirm('¿Deseas eliminar este requisito de la lista?')) return;
  try {
    await wsApi(`/api/workspace/checklist/${itemId}`, { method: 'DELETE' });
    showToast('Requisito eliminado');
    await loadWorkspace();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

let currentConflictItemId = null;
function wsOpenConflictModal(itemId) {
  currentConflictItemId = itemId;
  const signer = ws.data?.signer || {};
  const nameEl = document.getElementById('conflict-signer-name');
  const rutEl = document.getElementById('conflict-signer-rut');
  if (nameEl) nameEl.value = signer.name || '';
  if (rutEl) rutEl.value = signer.rut || '';
  const modal = document.getElementById('ws-conflict-modal');
  if (modal) modal.classList.remove('hidden');
  lucide.createIcons();
}

function wsCloseConflictModal() {
  const modal = document.getElementById('ws-conflict-modal');
  if (modal) modal.classList.add('hidden');
  currentConflictItemId = null;
}

async function wsConfirmConflictDeclaration() {
  if (!currentConflictItemId) return;
  const name = document.getElementById('conflict-signer-name')?.value?.trim();
  const rut = document.getElementById('conflict-signer-rut')?.value?.trim();
  if (!name) {
    showToast('Indique el nombre del representante legal', 'error');
    return;
  }
  try {
    showToast('Registrando declaración jurada...', 'info');
    const r = await wsApi(`/api/workspace/checklist/${currentConflictItemId}/sign-declaration`, jsonOpts('POST', {
      signer_name: name,
      signer_rut: rut,
      action: 'sign'
    }));
    showToast(r.message || 'Declaración firmada exitosamente');
    wsCloseConflictModal();
    await loadWorkspace();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function wsSignDeclaration(itemId, action) {
  try {
    const r = await wsApi(`/api/workspace/checklist/${itemId}/sign-declaration`, jsonOpts('POST', { action }));
    showToast(r.message || 'Estado actualizado');
    await loadWorkspace();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function wsQuickSignAnnex(docId) {
  const signer = ws.data?.signer || {};
  if (!signer.has_signature) {
    showToast('Debe registrar y guardar su firma en Multi-Empresa & Config primero', 'error');
    return;
  }
  const company = state.currentCompany || {};
  const form = {
    razon_social: company.razon_social || '',
    rut: company.rut || '',
    rep_legal: signer.name || '',
    rut_rep: signer.rut || '',
    direccion: company.direccion || '',
    email: company.email || ''
  };
  try {
    showToast('Estampando firma guardada...', 'info');
    const r = await wsApi(`/api/workspace/documents/${docId}/complete-and-sign`, jsonOpts('POST', {
      form_data: form,
      use_saved_signature: true,
      signer_name: signer.name,
      signer_rut: signer.rut
    }));
    showToast(r.message || 'Anexo firmado exitosamente');
    await loadWorkspace();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function wsOpenAddChecklistModal(defaultCategory = 'ADMINISTRATIVO') {
  const catEl = document.getElementById('new-chk-category');
  if (catEl) catEl.value = defaultCategory;
  const titleEl = document.getElementById('new-chk-title');
  if (titleEl) titleEl.value = '';
  const detailEl = document.getElementById('new-chk-detail');
  if (detailEl) detailEl.value = '';
  const modal = document.getElementById('ws-add-chk-modal');
  if (modal) modal.classList.remove('hidden');
  lucide.createIcons();
}

function wsCloseAddChecklistModal() {
  const modal = document.getElementById('ws-add-chk-modal');
  if (modal) modal.classList.add('hidden');
}

async function wsSubmitAddChecklist() {
  const category = document.getElementById('new-chk-category')?.value;
  const title = document.getElementById('new-chk-title')?.value?.trim();
  const detail = document.getElementById('new-chk-detail')?.value?.trim();
  if (!title) {
    showToast('Ingrese el nombre del documento o requisito', 'error');
    return;
  }
  try {
    await wsApi(`/api/workspace/${ws.id}/checklist`, jsonOpts('POST', {
      category,
      title,
      detail,
      is_mandatory: 1
    }));
    showToast('Requisito agregado exitosamente');
    wsCloseAddChecklistModal();
    await loadWorkspace();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

let annexDocId = null;
async function openAnnexSign(docId) {
  try {
    annexDocId = docId;
    const doc = await wsApi(`/api/workspace/documents/${docId}`);
    const company = state.currentCompany || {};
    let form = {}; try { form = JSON.parse(doc.form_data_json || '{}'); } catch (e) { /* vacío */ }
    const signer = ws.data?.signer || {};
    document.getElementById('anexo-doc-title').textContent = doc.name;
    const fields = [
      ['razon_social', 'Razón social oferente', form.razon_social || company.razon_social || ''],
      ['rut', 'RUT oferente', form.rut || company.rut || ''],
      ['rep_legal', 'Representante legal', form.rep_legal || signer.name || ''],
      ['rut_rep', 'RUT representante', form.rut_rep || signer.rut || ''],
      ['direccion', 'Domicilio', form.direccion || company.direccion || ''],
      ['email', 'Correo electrónico', form.email || company.email || '']
    ];
    document.getElementById('anexo-form-fields').innerHTML = fields.map(([k, l, v]) => `<div><label class="block text-xs font-semibold text-slate-600 mb-1">${l}</label><input id="anexo-field-${k}" value="${esc(v)}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-950"></div>`).join('');
    clearSignatureCanvas('anexo-signature-canvas');
    document.getElementById('anexo-editor-modal').classList.remove('hidden');
    lucide.createIcons();
  } catch (e) { showToast(e.message, 'error'); }
}
function closeAnexoEditorModal() { document.getElementById('anexo-editor-modal').classList.add('hidden'); }
function collectAnnexForm() {
  const f = {};
  ['razon_social', 'rut', 'rep_legal', 'rut_rep', 'direccion', 'email'].forEach(k => f[k] = document.getElementById(`anexo-field-${k}`)?.value || '');
  return f;
}
async function submitAnnex(body) {
  try {
    const r = await wsApi(`/api/workspace/documents/${annexDocId}/complete-and-sign`, jsonOpts('POST', body));
    showToast(r.message); closeAnexoEditorModal(); await loadWorkspace();
    window.open(r.pdf, '_blank');
  } catch (e) { showToast(e.message, 'error'); }
}
async function signAnnexWithSaved() {
  const f = collectAnnexForm();
  await submitAnnex({ form_data: f, use_saved_signature: true, signer_name: f.rep_legal, signer_rut: f.rut_rep });
}
async function saveAndSignAnexo() {
  const canvas = document.getElementById('anexo-signature-canvas');
  const f = collectAnnexForm();
  await submitAnnex({ form_data: f, signature_data_url: canvas.toDataURL('image/png'), signer_name: f.rep_legal, signer_rut: f.rut_rep });
}

// ---------------------------------------------------------------- FINANZAS
function tabFinanzas() {
  const d = ws.data, fin = d.financials, f = d.folder;
  const isAwarded = fin.is_awarded_stage || ['ADJUDICADA', 'EN_EJECUCION', 'CERRADA'].includes(f.status);
  const card = (l, v, c, sub, btn) => `<div class="bg-slate-50 p-3.5 rounded-xl border border-slate-200 flex flex-col justify-between"><div><div class="text-[10px] text-slate-500 uppercase font-semibold">${l}</div><div class="text-base font-bold ${c} mt-1">${v}</div><div class="text-[10px] text-slate-500">${sub || ''}</div></div>${btn || ''}</div>`;
  const tbl = (title, head, rows) => `<div class="bg-white border border-slate-200 rounded-xl p-5"><h4 class="font-bold text-xs uppercase text-slate-600 mb-2">${title}</h4><table class="w-full text-xs text-left"><thead class="text-[10px] uppercase text-slate-500 border-b border-slate-200"><tr>${head.map(h => `<th class="py-2 px-2">${h}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${head.length}" class="py-3 px-2 text-slate-600">Sin registros</td></tr>`}</tbody></table></div>`;

  let salesCards = '';
  if (!isAwarded) {
    salesCards = `
      ${card('Presupuesto Estimado MP', formatCLP(fin.presupuesto_estimado_mp || f.budget_amount), 'text-blue-700', 'Referencial de bases')}
      ${card('Venta neta contable', '$0', 'text-slate-600', 'Se activa en Adjudicado / OC', `<button type="button" onclick="wsOpenAwardedModal()" class="mt-2 text-[10px] px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-600 text-blue-700 font-semibold border border-blue-200"><svg class="w-3.5 h-3.5 inline text-zinc-400 hover:text-zinc-700 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Registrar Monto OC</button>`)}
    `;
  } else {
    salesCards = `
      ${card('Venta neta (OC / Facturada)', formatCLP(fin.venta_neta), 'text-slate-950', `Bruta ${formatCLP(fin.venta_bruta)}${fin.oc_number ? ' · OC: ' + esc(fin.oc_number) : ''}`, `<button type="button" onclick="wsOpenAwardedModal()" class="mt-2 text-[10px] px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"><svg class="w-3.5 h-3.5 inline text-zinc-400 hover:text-zinc-700 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Ajustar Monto OC</button>`)}
      ${card('Presupuesto Original MP', formatCLP(fin.presupuesto_estimado_mp || f.budget_amount), 'text-slate-600', 'Referencial de bases')}
    `;
  }

  return `<div class="grid grid-cols-2 md:grid-cols-6 gap-3">
    ${salesCards}
    ${card('Costo directo', formatCLP(fin.costo_directo), 'text-rose-700', 'Facturas de compra')}
    ${card('Gastos operativos', formatCLP(fin.gastos_asociados), 'text-amber-700', 'Fletes, viáticos…')}
    ${card('Costo neto total', formatCLP(fin.costo_total), 'text-rose-700', 'Directo + gastos')}
    ${card('Utilidad neta', formatCLP(fin.utilidad_neta), fin.utilidad_neta >= 0 ? 'text-emerald-700' : 'text-rose-700', 'Margen ' + fin.margen_pct + '%')}</div>
  ${tbl('Ingresos (DTE de venta)', ['Documento', 'Fecha', 'Neto', 'Total', 'Cobranza'], d.dtes_emitidos.map(x => `<tr class="border-b border-slate-200"><td class="py-2 px-2 text-blue-700 font-bold">DTE ${x.dte_type} #${x.folio}</td><td class="px-2">${fmtDate(x.emission_date)}</td><td class="px-2">${formatCLP(x.net_amount)}</td><td class="px-2">${formatCLP(x.total_amount)}</td><td class="px-2">${x.is_reconciled ? 'Cobrada' : 'Pendiente'}</td></tr>`).join(''))}
  ${tbl('Costos directos (DTE de compra)', ['Documento', 'Proveedor', 'Fecha', 'Neto', 'Pago'], d.dtes_recibidos.map(x => `<tr class="border-b border-slate-200"><td class="py-2 px-2 text-amber-700 font-bold">DTE ${x.dte_type} #${x.folio}</td><td class="px-2">${esc(x.razon_social_emisor)}</td><td class="px-2">${fmtDate(x.emission_date)}</td><td class="px-2 text-rose-700">${formatCLP(x.net_amount)}</td><td class="px-2">${x.is_reconciled ? 'Pagada' : 'Por pagar'}</td></tr>`).join(''))}
  ${tbl('Gastos operativos', ['Fecha', 'Categoría', 'Descripción', 'Monto', ''], d.gastos.map(g => `<tr class="border-b border-slate-200"><td class="py-2 px-2">${fmtDate(g.date)}</td><td class="px-2">${esc(g.category)}</td><td class="px-2">${esc(g.description)}</td><td class="px-2 text-amber-700 font-bold">${formatCLP(g.amount)}</td><td class="px-2"><button onclick="wsDelExpense(${g.id})" class="text-slate-500 hover:text-rose-700"><svg class="w-3.5 h-3.5 inline text-zinc-400 hover:text-rose-600 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></td></tr>`).join(''))}
  <form onsubmit="wsAddExpense(event)" class="bg-white border border-slate-200 rounded-xl p-3 grid grid-cols-1 md:grid-cols-5 gap-2 text-xs">
    <input type="date" name="date" class="bg-white border border-slate-300 rounded px-2 py-1.5 text-slate-950">
    <select name="category" class="bg-white border border-slate-300 rounded px-2 py-1.5 text-slate-950"><option value="FLETE">Flete</option><option value="SUBCONTRATO">Subcontrato</option><option value="HONORARIOS">Honorarios</option><option value="VIATICO">Viático</option><option value="SEGUROS">Seguros / Garantía</option><option value="OTRO">Otro</option></select>
    <input name="description" required placeholder="Descripción del gasto" class="bg-white border border-slate-300 rounded px-2 py-1.5 text-slate-950">
    <input name="amount" type="number" required placeholder="Monto $" class="bg-white border border-slate-300 rounded px-2 py-1.5 text-slate-950">
    <button class="bg-amber-600 hover:bg-amber-700 text-white font-bold rounded py-1.5">Imputar gasto</button></form>`;
}
async function wsAddExpense(e) {
  e.preventDefault(); const f = e.target;
  try {
    await wsApi('/api/folders/expenses', jsonOpts('POST', { folder_id: ws.id, description: f.description.value, category: f.category.value, amount: parseFloat(f.amount.value) || 0, date: f.date.value || new Date().toISOString().slice(0, 10) }));
    await loadWorkspace(); showToast('Gasto registrado');
  } catch (err) { showToast(err.message, 'error'); }
}
async function wsDelExpense(id) { if (!confirm('¿Eliminar gasto?')) return; await wsApi(`/api/folders/expenses/${id}`, { method: 'DELETE' }); await loadWorkspace(); }

// ---------------------------------------------------------------- POSTULAR (Compilador y Validador Final)
function tabPostular() {
  const d = ws.data, f = d.folder;
  const docs = d.documents || [];
  const items = d.items || [];
  const cl = d.checklist || [];
  const adminItems = cl.filter(c => c.category === 'ADMINISTRATIVO');
  const q = d.quotation;

  // 1. Pilar Anexos y Formularios Oficiales Firmados
  const requiredDocs = docs.filter(doc => doc.requires_signature || ['DECLARACION', 'ANEXO', 'ANEXO_OFERTA'].includes(doc.doc_type));
  const docsToCheck = requiredDocs.length ? requiredDocs : docs;
  const docsSigned = docsToCheck.filter(doc => doc.status === 'FIRMADO' || doc.has_signature);

  // 2. Pilar Fichas Técnicas de Productos
  const techReady = items.filter(it => it.tech_sheet_status === 'LISTA' || it.tech_sheet_file);

  // 3. Pilar Antecedentes Administrativos
  const adminReady = adminItems.filter(a => (a.file_path && a.file_path.trim() !== '') || a.status === 'HECHO');

  // 4. Pilar Propuesta Económica / Cotización
  const quoteReady = Boolean(q && (q.net_amount || 0) > 0);

  // Cálculo de Porcentaje Consolidado
  const totalTasks = docsToCheck.length + items.length + adminItems.length + 1;
  const completedTasks = docsSigned.length + techReady.length + adminReady.length + (quoteReady ? 1 : 0);
  const pct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 100;

  // Faltantes para advertencias visuales
  const missingItems = [];
  docsToCheck.forEach(doc => {
    if (doc.status !== 'FIRMADO' && !doc.has_signature) {
      missingItems.push({
        cat: 'ANEXO',
        icon: '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 2 4 4-12 12H6v-4L18 2z"/><path d="m14 6 4 4"/></svg>',
        label: `Falta firmar anexo: "${esc(doc.name || doc.original_filename)}"`,
        actionHtml: `<button onclick="openDocViewer(${doc.id})" class="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-bold transition-colors">Firmar</button>`
      });
    }
  });

  items.forEach(it => {
    if (it.tech_sheet_status !== 'LISTA' && !it.tech_sheet_file) {
      missingItems.push({
        cat: 'FICHA',
        icon: '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
        label: `Falta adjuntar ficha técnica del ítem #${it.item_number}: "${esc(it.product_name)}"`,
        actionHtml: `<button onclick="wsSetTab('pendientes')" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold transition-colors">Subir ficha</button>`
      });
    }
  });

  adminItems.forEach(a => {
    if (!a.file_path && a.status !== 'HECHO') {
      missingItems.push({
        cat: 'ADMIN',
        icon: '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>',
        label: `Falta cargar antecedente administrativo: "${esc(a.title)}"`,
        actionHtml: `<button onclick="wsSetTab('pendientes')" class="px-2.5 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded text-xs font-bold transition-colors">Cargar</button>`
      });
    }
  });

  if (!quoteReady) {
    missingItems.push({
      cat: 'COTIZACION',
      icon: '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M16 8h-6"/><path d="M16 12h-6"/><path d="M14 16h-4"/></svg>',
      label: 'Falta generar y aprobar la cotización / oferta económica de la licitación',
      actionHtml: `<button onclick="wsSetTab('cotizador')" class="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-bold transition-colors">Ir al Cotizador</button>`
    });
  }

  const isReadyAll = missingItems.length === 0;

  return `
    <div class="space-y-6">
      <!-- Encabezado con KPI de Preparación y Botón Descarga ZIP -->
      <div class="bg-gradient-to-br from-slate-50 via-white to-indigo-50 border border-slate-200 rounded-2xl p-6 shadow-xl space-y-5">
        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div class="space-y-1">
            <div class="flex items-center space-x-2">
              <span class="px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200">
                Compilador & Validador Final
              </span>
              <span class="text-xs text-slate-600 font-mono">${esc(f.code)}</span>
            </div>
            <h2 class="text-xl font-heading font-extrabold text-slate-950">Expediente de Postulación: ${esc(f.title)}</h2>
            <p class="text-xs text-slate-600 max-w-2xl leading-relaxed">
              Verifica que todos los antecedentes, formularios firmados, fichas técnicas y oferta económica estén 100% listos antes de subir al portal de Mercado Público o enviar al cliente.
            </p>
          </div>
          <div class="shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <a href="/api/workspace/${ws.id}/postulacion-zip" class="px-6 py-3.5 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-indigo-500 text-white font-extrabold text-sm shadow-lg shadow-sm flex items-center justify-center space-x-2 transition-all transform hover:-translate-y-0.5">
              <i data-lucide="package-check" class="w-5 h-5"></i>
              <span>Descargar Paquete Completo de Postulación (.ZIP)</span>
            </a>
          </div>
        </div>

        <!-- Barra de Progreso General -->
        <div class="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2">
          <div class="flex justify-between items-center text-xs">
            <span class="font-bold text-slate-700 flex items-center space-x-2">
              <span>Nivel de Preparación del Expediente</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-extrabold ${isReadyAll ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">${pct}% LISTO</span>
            </span>
            <span class="text-slate-600 font-mono">${completedTasks} de ${totalTasks} requisitos cumplidos</span>
          </div>
          <div class="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
            <div class="h-full bg-gradient-to-r ${isReadyAll ? 'from-emerald-500 to-teal-400' : 'from-amber-500 via-blue-500 to-indigo-500'} transition-all duration-500" style="width: ${pct}%"></div>
          </div>
        </div>
      </div>

      <!-- Alertas de Faltantes / Banner de Éxito -->
      ${isReadyAll ? `
        <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center space-x-3 text-emerald-700 text-xs">
          <div class="text-2xl"><svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></div>
          <div>
            <div class="font-bold text-sm text-emerald-700">¡Expediente de postulación completo y verificado!</div>
            <div>Todos los anexos firmados, fichas técnicas y antecedentes administrativos están cargados. Ya puedes descargar el paquete ZIP y cargarlo en Mercado Público.</div>
          </div>
        </div>
      ` : `
        <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2.5">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-2 text-amber-700 font-bold text-xs">
              <span class="text-base"><svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
              <span>Atención: Quedan ${missingItems.length} requisito(s) pendientes antes de postular</span>
            </div>
            <span class="text-[11px] text-amber-700">Revisa la lista a continuación para subsanar</span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            ${missingItems.map(m => `
              <div class="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-amber-200 text-slate-700">
                <div class="flex items-center space-x-2 min-w-0 mr-2">
                  <span class="shrink-0">${m.icon}</span>
                  <span class="truncate text-[11px]">${m.label}</span>
                </div>
                <div class="shrink-0">${m.actionHtml}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `}

      <!-- 4 Pilares de Verificación en Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <!-- Pilar 1: Anexos Firmados -->
        <div class="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between space-y-3">
          <div>
            <div class="flex items-center justify-between text-xs mb-1">
              <span class="font-bold text-slate-900 flex items-center space-x-1.5">
                <span><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 2 4 4-12 12H6v-4L18 2z"/><path d="m14 6 4 4"/></svg></span>
                <span>Anexos Oficiales</span>
              </span>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold ${docsSigned.length === docsToCheck.length && docsToCheck.length > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}">${docsSigned.length}/${docsToCheck.length}</span>
            </div>
            <p class="text-[11px] text-slate-600">Formularios y declaraciones juradas que exigen firma.</p>
            <div class="mt-3 space-y-1.5 max-h-48 overflow-y-auto pr-1">
              ${docsToCheck.map(doc => {
                const s = doc.status === 'FIRMADO' || doc.has_signature;
                return `
                  <div class="flex items-center justify-between p-2 rounded-lg bg-slate-50 text-[11px] border border-slate-200">
                    <span class="truncate max-w-[150px] text-slate-700" title="${esc(doc.name)}">${esc(doc.name)}</span>
                    ${s ? '<span class="text-emerald-700 font-bold shrink-0">Firmado</span>' : `<button onclick="openDocViewer(${doc.id})" class="text-indigo-700 hover:underline shrink-0 font-semibold">Firmar</button>`}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
          <button onclick="wsSetTab('documentos')" class="w-full py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors">Gestionar firmas</button>
        </div>

        <!-- Pilar 2: Fichas Técnicas -->
        <div class="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between space-y-3">
          <div>
            <div class="flex items-center justify-between text-xs mb-1">
              <span class="font-bold text-slate-900 flex items-center space-x-1.5">
                <span><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>
                <span>Fichas Técnicas</span>
              </span>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold ${techReady.length === items.length && items.length > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}">${techReady.length}/${items.length}</span>
            </div>
            <p class="text-[11px] text-slate-600">Fichas de respaldo del fabricante por cada producto.</p>
            <div class="mt-3 space-y-1.5 max-h-48 overflow-y-auto pr-1">
              ${items.map(it => {
                const ok = it.tech_sheet_status === 'LISTA' || Boolean(it.tech_sheet_file);
                return `
                  <div class="flex items-center justify-between p-2 rounded-lg bg-slate-50 text-[11px] border border-slate-200">
                    <span class="truncate max-w-[150px] text-slate-700" title="${esc(it.product_name)}">#${it.item_number} ${esc(it.product_name)}</span>
                    ${ok ? '<span class="text-emerald-700 font-bold shrink-0">Lista</span>' : '<span class="text-rose-700 font-bold shrink-0">Pendiente</span>'}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
          <button onclick="wsSetTab('pendientes')" class="w-full py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors">Subir fichas</button>
        </div>

        <!-- Pilar 3: Antecedentes Administrativos -->
        <div class="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between space-y-3">
          <div>
            <div class="flex items-center justify-between text-xs mb-1">
              <span class="font-bold text-slate-900 flex items-center space-x-1.5">
                <span><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg></span>
                <span>Administrativos</span>
              </span>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold ${adminReady.length === adminItems.length && adminItems.length > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}">${adminReady.length}/${adminItems.length}</span>
            </div>
            <p class="text-[11px] text-slate-600">Patente, estatutos, F30-1, vigencia, cédula.</p>
            <div class="mt-3 space-y-1.5 max-h-48 overflow-y-auto pr-1">
              ${adminItems.map(a => {
                const ok = Boolean(a.file_path) || a.status === 'HECHO';
                return `
                  <div class="flex items-center justify-between p-2 rounded-lg bg-slate-50 text-[11px] border border-slate-200">
                    <span class="truncate max-w-[150px] text-slate-700" title="${esc(a.title)}">${esc(a.title)}</span>
                    ${ok ? '<span class="text-teal-700 font-bold shrink-0">Listo</span>' : '<span class="text-amber-700 font-bold shrink-0">Falta</span>'}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
          <button onclick="wsSetTab('pendientes')" class="w-full py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors">Adjuntar respaldos</button>
        </div>

        <!-- Pilar 4: Oferta Económica -->
        <div class="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between space-y-3">
          <div>
            <div class="flex items-center justify-between text-xs mb-1">
              <span class="font-bold text-slate-900 flex items-center space-x-1.5">
                <span><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M16 8h-6"/><path d="M16 12h-6"/><path d="M14 16h-4"/></svg></span>
                <span>Oferta Económica</span>
              </span>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold ${quoteReady ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}">${quoteReady ? 'LISTA' : 'PENDIENTE'}</span>
            </div>
            <p class="text-[11px] text-slate-600">Cotización formal valorizada para la postulación.</p>
            <div class="mt-3 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
              ${quoteReady ? `
                <div class="text-[11px] text-slate-600 font-mono">${esc(q.folio)}</div>
                <div class="font-extrabold text-slate-950 text-sm">${formatCLP(q.total_amount)}</div>
                <div class="text-[10px] text-emerald-700">Neto: ${formatCLP(q.net_amount)}</div>
              ` : `
                <div class="text-slate-600 text-[11px] italic">Aún no se ha generado cotización formal.</div>
              `}
            </div>
          </div>
          <button onclick="wsSetTab('cotizador')" class="w-full py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors">Ir al Cotizador</button>
        </div>
      </div>

      <!-- Contenido del Paquete ZIP generado -->
      <div class="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-xs">
        <h4 class="font-bold text-slate-900 flex items-center space-x-2">
          <span>Estructura del Archivo ZIP descargado</span>
        </h4>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3 text-[11px] font-mono">
          <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 text-slate-700 space-y-1">
            <div class="font-bold text-blue-700">00_RESUMEN_POSTULACION.txt</div>
            <div class="text-slate-500 text-[10px]">Acta de control, metadatos y checklist de cumplimiento.</div>
          </div>
          <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 text-slate-700 space-y-1">
            <div class="font-bold text-indigo-700">01_ANEXOS_FIRMADOS/</div>
            <div class="text-slate-500 text-[10px]">Todos los anexos oficiales con firmas estampadas en PDF.</div>
          </div>
          <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 text-slate-700 space-y-1">
            <div class="font-bold text-emerald-700">02_FICHAS_TECNICAS/</div>
            <div class="text-slate-500 text-[10px]">Fichas técnicas renombradas ordenadas por ítem de prenda.</div>
          </div>
          <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 text-slate-700 space-y-1">
            <div class="font-bold text-teal-700">03_ANTECEDENTES_ADMIN/</div>
            <div class="text-slate-500 text-[10px]">Patente comercial, estatutos, F30-1 y cédula del representante.</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------- CONFIG: IA y firma
async function loadAiSettings() {
  try {
    const s = await wsApi('/api/workspace/ai-settings');
    document.getElementById('ai-provider').value = s.provider;
    document.getElementById('ai-model').value = s.model || '';
    document.getElementById('ai-base-url').value = s.base_url || '';
    document.getElementById('ai-key').placeholder = s.has_key ? s.api_key_masked + ' (guardada; deja vacío para conservar)' : 'Pega aquí tu clave';
    const b = document.getElementById('ai-status-badge');
    const on = s.provider !== 'none';
    b.textContent = on ? `IA activa: ${s.provider === 'gemini' ? 'Gemini' : 'OpenAI-compatible'} (${s.model})` : 'Sin IA: análisis local por reglas';
    b.className = 'inline-block px-2.5 py-1 rounded-full font-bold ' + (on ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700');
  } catch (e) { /* sin config */ }
}
async function saveAiSettings() {
  try {
    await wsApi('/api/workspace/ai-settings', jsonOpts('PUT', { provider: document.getElementById('ai-provider').value, model: document.getElementById('ai-model').value.trim(), base_url: document.getElementById('ai-base-url').value.trim(), api_key: document.getElementById('ai-key').value.trim() }));
    document.getElementById('ai-key').value = '';
    showToast('Configuración de IA guardada'); await loadAiSettings();
  } catch (e) { showToast(e.message, 'error'); }
}
async function loadSignerProfile() {
  try {
    const p = await wsApi('/api/workspace/signer-profile');
    document.getElementById('signer-name').value = p.name || '';
    document.getElementById('signer-rut').value = p.rut || '';
    clearSignatureCanvas('profile-signature-canvas');
    if (p.signature_data_url) loadSignatureImage('profile-signature-canvas', p.signature_data_url);
    document.getElementById('signer-status').textContent = p.signature_data_url ? '<svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Firma guardada. Dibuja otra para reemplazarla.' : 'Aún no hay firma guardada.';
  } catch (e) { /* vacío */ }
}
function loadSignerImage(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => loadSignatureImage('profile-signature-canvas', r.result);
  r.readAsDataURL(file);
}
async function saveSignerProfile() {
  const canvas = document.getElementById('profile-signature-canvas');
  try {
    await wsApi('/api/workspace/signer-profile', jsonOpts('PUT', { name: document.getElementById('signer-name').value, rut: document.getElementById('signer-rut').value, signature_data_url: canvas.toDataURL('image/png') }));
    showToast('Firma guardada'); await loadSignerProfile();
  } catch (e) { showToast(e.message, 'error'); }
}

document.addEventListener('DOMContentLoaded', () => { setupSignatureCanvas('profile-signature-canvas'); });

// ============================================================================
// EXTENSIONES AVANZADAS: MERCADO PÚBLICO, POST-ADJUDICACIÓN & BÓVEDA LEGAL
// ============================================================================

// ----------------------------------------------------------------------------
// 1. FORO INVERSO Y SUBSANACIONES (POST-CIERRE DE OFERTAS)
// ----------------------------------------------------------------------------
let _clarificationTimerInterval = null;

async function wsRenderClarificationsBanner() {
  const container = document.getElementById('ws-clarifications-banner');
  if (!container || !ws.id) return;
  try {
    const list = await wsApi(`/api/folders/${ws.id}/clarifications`);
    ws._clarifications = list || [];
    const pend = ws._clarifications.filter(c => c.status === 'PENDIENTE');
    ws._clarificationsCount = pend.length;

    if (!pend.length) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');
    const withDue = pend.filter(c => c.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const closest = withDue[0];

    container.innerHTML = `
      <div class="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-amber-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-lg">
        <div class="flex items-center space-x-3">
          <span class="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold text-base shrink-0 animate-pulse">
            <svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </span>
          <div>
            <div class="font-bold text-slate-950 flex items-center gap-2">
              <span>Foro Inverso y Solicitudes de Aclaración / Subsanación</span>
              <span class="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-extrabold text-[10px] border border-amber-200">
                ${pend.length} PENDIENTE${pend.length > 1 ? 'S' : ''}
              </span>
            </div>
            <div class="text-slate-700 mt-0.5">
              ${closest ? `Plazo fatal más próximo: <b class="text-amber-700">${fmtDateTime(closest.due_date)}</b> · ` : ''}
              <span id="ws-clarif-countdown-top" class="font-mono font-bold text-amber-700">Calculando tiempo...</span>
            </div>
          </div>
        </div>
        <div class="flex items-center space-x-2 shrink-0">
          <button onclick="wsOpenClarificationsModal()" class="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs inline-flex items-center space-x-1.5 shadow">
            <span>Ver y Responder en Portal</span>
          </button>
        </div>
      </div>
    `;
    wsUpdateClarificationCountdowns();
    if (!_clarificationTimerInterval) {
      _clarificationTimerInterval = setInterval(wsUpdateClarificationCountdowns, 1000);
    }
  } catch (err) {
    console.warn('Error cargando subsanaciones:', err);
  }
}

function wsUpdateClarificationCountdowns() {
  const topEl = document.getElementById('ws-clarif-countdown-top');
  const pend = (ws._clarifications || []).filter(c => c.status === 'PENDIENTE' && c.due_date);
  if (topEl && pend.length) {
    const closest = pend.sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
    const diffMs = new Date(closest.due_date.replace(' ', 'T')).getTime() - Date.now();
    if (diffMs <= 0) {
      topEl.innerHTML = '<span class="text-rose-700 font-extrabold">¡PLAZO VENCIDO!</span>';
    } else {
      const hours = Math.floor(diffMs / 3600000);
      const mins = Math.floor((diffMs % 3600000) / 60000);
      const secs = Math.floor((diffMs % 60000) / 1000);
      const isUrgent = hours < 12;
      topEl.innerHTML = `<span class="${isUrgent ? 'text-rose-700 animate-pulse' : 'text-amber-700'} font-bold"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${hours}h ${mins}m ${secs}s restantes</span>`;
    }
  }

  const modalTimers = document.querySelectorAll('.ws-clarif-timer-item');
  modalTimers.forEach(el => {
    const due = el.getAttribute('data-due');
    if (!due) return;
    const diffMs = new Date(due.replace(' ', 'T')).getTime() - Date.now();
    if (diffMs <= 0) {
      el.innerHTML = '<span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-50 text-rose-700 border border-rose-200">Vencido</span>';
    } else {
      const hours = Math.floor(diffMs / 3600000);
      const mins = Math.floor((diffMs % 3600000) / 60000);
      const secs = Math.floor((diffMs % 60000) / 1000);
      const isUrgent = hours < 12;
      el.innerHTML = `<span class="px-2 py-0.5 rounded text-[10px] font-bold ${isUrgent ? 'bg-rose-50 text-rose-700 border border-rose-200 animate-pulse' : 'bg-amber-50 text-amber-700 border border-amber-200'}"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${hours}h ${mins}m ${secs}s</span>`;
    }
  });
}

async function wsOpenClarificationsModal() {
  try {
    const list = await wsApi(`/api/folders/${ws.id}/clarifications`);
    ws._clarifications = list || [];
  } catch (e) {
    ws._clarifications = [];
  }

  const items = ws._clarifications;

  const itemsHtml = items.length ? items.map(c => {
    const isPend = c.status === 'PENDIENTE';
    const isResp = c.status === 'RESPONDIDO';
    return `
      <div class="rounded-xl border ${isPend ? 'border-amber-200 bg-slate-50' : 'border-slate-200 bg-white'} p-4 space-y-3">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-2">
          <div class="flex items-center space-x-2">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${c.clarification_type === 'FORO_INVERSO' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}">
              ${c.clarification_type}
            </span>
            <span class="font-bold text-slate-900 text-xs">Solicitado por: ${esc(c.requested_by || 'Entidad licitante')}</span>
          </div>
          <div class="flex items-center space-x-2">
            ${isPend ? `<div class="ws-clarif-timer-item text-xs font-mono" data-due="${c.due_date || ''}"></div>` : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"><svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Respondido</span>'}
            <button onclick="wsDeleteClarification(${c.id})" class="text-slate-500 hover:text-rose-700 p-1"><svg class="w-3.5 h-3.5 inline text-zinc-400 hover:text-rose-600 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
          </div>
        </div>

        <div class="text-xs text-slate-700">
          <div class="text-slate-600 text-[10px] uppercase font-semibold">Requerimiento:</div>
          <p class="mt-0.5 whitespace-pre-wrap">${esc(c.description || '')}</p>
        </div>

        <div class="grid grid-cols-2 gap-2 text-[11px] text-slate-600 pt-1">
          <div>Fecha solicitud: <b class="text-slate-700">${esc(c.request_date || '—')}</b></div>
          <div>Límite fatal: <b class="text-amber-700">${esc(c.due_date || '—')}</b></div>
        </div>

        ${isResp ? `
          <div class="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-xs text-emerald-700 space-y-1">
            <div class="text-[10px] uppercase font-bold">Respuesta Registrada (${c.response_date || ''}):</div>
            <div>${esc(c.response_notes || 'Sin detalle de respuesta')}</div>
          </div>
        ` : `
          <div class="pt-2 border-t border-slate-200 flex flex-col sm:flex-row gap-2 items-end">
            <div class="flex-1 w-full">
              <label class="block text-[10px] text-slate-600 mb-1">Registrar respuesta oficial entregada en Mercado Público:</label>
              <input id="ws-resp-notes-${c.id}" type="text" placeholder="Ej: Adjuntado Anexo N° 2 corregido y certificado F30 vigente en el foro de aclaraciones" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-950">
            </div>
            <button onclick="wsRespondClarification(${c.id})" class="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shrink-0">
              Marcar Respondido
            </button>
          </div>
        `}
      </div>
    `;
  }).join('') : '<div class="text-xs text-slate-500 py-6 text-center">No hay solicitudes de aclaración o foro inverso registradas para esta licitación.</div>';

  const modalHtml = `
    <div class="space-y-5">
      <form onsubmit="wsSubmitClarification(event)" class="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 text-xs">
        <div class="font-bold text-slate-900 flex items-center justify-between">
          <span class="flex items-center gap-1.5"><span><svg class="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></span> Registrar Nueva Solicitud de Aclaración / Foro Inverso</span>
          <span class="text-[10px] text-slate-600 font-normal">Plazo fatal de Mercado Público</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="block text-slate-600 mb-1">Tipo de Requerimiento *</label>
            <select id="ws-clarif-type" required class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
              <option value="FORO_INVERSO">Foro Inverso / Aclaración de Oferta</option>
              <option value="SUBSANACION">Subsanación de Documentos (Anexos / Certificados)</option>
              <option value="OTRO">Otro Requerimiento Formal</option>
            </select>
          </div>
          <div>
            <label class="block text-slate-600 mb-1">Mandante / Solicitante</label>
            <input id="ws-clarif-by" type="text" value="${esc(ws.data?.folder?.client_name || '')}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
          </div>
          <div>
            <label class="block text-slate-600 mb-1">Fecha y Hora Límite Fatal *</label>
            <input id="ws-clarif-due" type="datetime-local" required class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-amber-700 font-semibold">
          </div>
        </div>
        <div>
          <label class="block text-slate-600 mb-1">Descripción del Requerimiento en el Portal *</label>
          <textarea id="ws-clarif-desc" required rows="2" placeholder="Ej: Se solicita aclarar la ficha técnica de la parka reflectante y remitir certificado de vigencia de poderes del firmante" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950"></textarea>
        </div>
        <div class="flex justify-end">
          <button type="submit" class="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold">
            Guardar y Activar Temporizador
          </button>
        </div>
      </form>

      <div class="space-y-3">
        <h4 class="font-bold text-xs text-slate-900">Requerimientos Registrados (${items.length}):</h4>
        ${itemsHtml}
      </div>

      <div class="flex justify-end pt-3 border-t border-slate-200">
        <button onclick="closePfModal()" class="px-4 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs">
          Cerrar
        </button>
      </div>
    </div>
  `;
  pfModal('Panel de Subsanaciones y Foro Inverso (Post-Cierre)', modalHtml, true);
  wsUpdateClarificationCountdowns();
}

async function wsSubmitClarification(e) {
  e.preventDefault();
  const type = document.getElementById('ws-clarif-type').value;
  const requestedBy = document.getElementById('ws-clarif-by').value;
  const due = document.getElementById('ws-clarif-due').value;
  const desc = document.getElementById('ws-clarif-desc').value;

  try {
    await wsApi(`/api/folders/${ws.id}/clarifications`, jsonOpts('POST', {
      clarification_type: type,
      requested_by: requestedBy,
      due_date: due ? due.replace('T', ' ') : null,
      description: desc
    }));
    showToast('Requerimiento registrado y temporizador iniciado');
    await wsOpenClarificationsModal();
    await wsRenderClarificationsBanner();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function wsRespondClarification(id) {
  const notes = document.getElementById(`ws-resp-notes-${id}`)?.value || '';
  try {
    await wsApi(`/api/folders/${ws.id}/clarifications/${id}`, jsonOpts('PUT', {
      response_notes: notes,
      status: 'RESPONDIDO'
    }));
    showToast('Requerimiento marcado como respondido');
    await wsOpenClarificationsModal();
    await wsRenderClarificationsBanner();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function wsDeleteClarification(id) {
  if (!confirm('¿Eliminar este requerimiento?')) return;
  try {
    await wsApi(`/api/folders/${ws.id}/clarifications/${id}`, { method: 'DELETE' });
    showToast('Requerimiento eliminado');
    await wsOpenClarificationsModal();
    await wsRenderClarificationsBanner();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------------------------------
// 2. FICHA DE SOLICITUD DE GARANTÍAS (1-CLIC PDF PARA BANCO / ASEGURADORA)
// ----------------------------------------------------------------------------
async function wsOpenWarrantySheetModal() {
  try {
    const data = await wsApi(`/api/folders/${ws.id}/warranty-sheet`);
    const modalHtml = `
      <form onsubmit="wsDownloadWarrantySheetPdf(event)" class="space-y-4 text-xs">
        <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-700">
          Esta ficha extrae los datos oficiales de las bases de la licitación para remitirlos directamente al banco o compañía de seguros y emitir la póliza/boleta sin errores de glosa ni de tomador.
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-slate-600 mb-1">Entidad Licitante / Mandante</label>
            <input id="ws-war-client" value="${esc(data.client_name || '')}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
          </div>
          <div>
            <label class="block text-slate-600 mb-1">RUT Mandante</label>
            <input id="ws-war-rut" value="${esc(data.client_rut || '')}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950 font-mono">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="block text-slate-600 mb-1">ID Mercado Público</label>
            <input id="ws-war-tid" value="${esc(data.tender_id || '')}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950 font-mono">
          </div>
          <div>
            <label class="block text-slate-600 mb-1">Tipo de Garantía</label>
            <select id="ws-war-type" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
              <option value="SERIEDAD_OFERTA" ${data.warranty_type === 'SERIEDAD_OFERTA' ? 'selected' : ''}>Seriedad de la Oferta</option>
              <option value="FIEL_CUMPLIMIENTO" ${data.warranty_type === 'FIEL_CUMPLIMIENTO' ? 'selected' : ''}>Fiel Cumplimiento de Contrato</option>
            </select>
          </div>
          <div>
            <label class="block text-slate-600 mb-1">Monto en Pesos (CLP)</label>
            <input id="ws-war-clp" type="number" value="${Math.round(data.amount_clp || 500000)}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-amber-700 font-bold">
          </div>
        </div>

        <div>
          <label class="block text-slate-600 mb-1">Glosa Exacta Obligatoria según Bases *</label>
          <textarea id="ws-war-glosa" rows="3" required class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950 text-xs font-mono">${esc(data.glosa_exacta || '')}</textarea>
        </div>

        <div class="border-t border-slate-200 pt-3">
          <div class="font-bold text-slate-700 mb-2">Datos del Proponente / Tomador (Empresa):</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-600 mb-1">Razón Social</label>
              <input id="ws-war-app-name" value="${esc(data.applicant_name || '')}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
            </div>
            <div>
              <label class="block text-slate-600 mb-1">RUT Proponente</label>
              <input id="ws-war-app-rut" value="${esc(data.applicant_rut || '')}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950 font-mono">
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-3 border-t border-slate-200">
          <button type="button" onclick="closePfModal()" class="px-3.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900">Cancelar</button>
          <button type="submit" class="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold flex items-center gap-1.5 shadow">
            <span>⬇️</span> Descargar Ficha PDF para Banco
          </button>
        </div>
      </form>
    `;
    pfModal('Ficha de Solicitud de Garantía Bancaria / Póliza', modalHtml, true);
  } catch (err) {
    showToast('Error cargando datos de garantía: ' + err.message, 'error');
  }
}

function wsDownloadWarrantySheetPdf(e) {
  e.preventDefault();
  const warType = document.getElementById('ws-war-type').value;
  const glosa = encodeURIComponent(document.getElementById('ws-war-glosa').value);
  const amtClp = document.getElementById('ws-war-clp').value;
  const url = `/api/folders/${ws.id}/warranty-sheet/pdf?warranty_type=${warType}&amount_clp=${amtClp}&glosa_exacta=${glosa}`;
  window.open(url, '_blank');
  closePfModal();
  showToast('Generando Ficha de Garantía en PDF...');
}

// ----------------------------------------------------------------------------
// 3. HISTORIAL REFERENCIAL DE ADJUDICACIONES (BENCHMARK EN COTIZADOR)
// ----------------------------------------------------------------------------
async function wsLoadBenchmarks() {
  const container = document.getElementById('wsq-benchmarks-container');
  if (!container || !ws.id) return;
  try {
    const list = await wsApi(`/api/folders/${ws.id}/benchmarks`);
    ws._benchmarks = list || [];

    const rows = ws._benchmarks.map(b => `
      <tr class="border-b border-slate-200 text-xs">
        <td class="py-2 px-2 font-semibold text-slate-900">${esc(b.product_name)}</td>
        <td class="py-2 px-2 text-slate-600">${esc(b.awarded_supplier || '—')}</td>
        <td class="py-2 px-2 text-right font-bold text-amber-700">$${Math.round(b.unit_price_net || 0).toLocaleString('es-CL')}</td>
        <td class="py-2 px-2 text-slate-600 font-mono text-[10px]">${esc(b.tender_id || '—')}</td>
        <td class="py-2 px-2 text-slate-600 text-[10px]">${esc(b.notes || '')}</td>
        <td class="py-2 px-2 text-right">
          <button onclick="wsDeleteBenchmark(${b.id})" class="text-slate-500 hover:text-rose-700"><svg class="w-3.5 h-3.5 inline text-zinc-400 hover:text-rose-600 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div class="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h4 class="font-bold text-xs text-slate-900 flex items-center gap-1.5">
              <span>Historial Referencial de Adjudicaciones / Precios Ganadores Anteriores</span>
            </h4>
            <p class="text-[11px] text-slate-600 mt-0.5">
              Referencia de precios históricos adjudicados en Mercado Público para calibrar el precio cotizado y maximizar puntaje económico.
            </p>
          </div>
          <div>
            <button onclick="wsOpenAddBenchmarkModal()" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-semibold flex items-center gap-1">
              <span>+</span> Agregar Precio Referencial
            </button>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead class="text-[10px] uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th class="py-1 px-2">Producto / Ítem</th>
                <th class="py-1 px-2">Proveedor Ganador</th>
                <th class="py-1 px-2 text-right">P. Unitario Neto</th>
                <th class="py-1 px-2">ID Licitación</th>
                <th class="py-1 px-2">Notas</th>
                <th class="py-1 px-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="6" class="py-3 text-center text-slate-500 text-xs">Sin referencias registradas. Ingresa precios de adjudicaciones pasadas para comparar.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    console.warn('Error cargando benchmarks:', err);
  }
}

function wsOpenAddBenchmarkModal() {
  const currentItems = (ws.data?.items || []).map(i => i.title || i.product_name);
  const options = currentItems.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');

  const html = `
    <form onsubmit="wsSubmitBenchmark(event)" class="space-y-4 text-xs">
      <div>
        <label class="block font-semibold text-slate-700 mb-1">Producto / Ítem Referencial *</label>
        <input id="ws-bm-prod" list="ws-bm-item-list" required placeholder="Ej: Parka reflectante de alta visibilidad" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
        <datalist id="ws-bm-item-list">${options}</datalist>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block font-semibold text-slate-700 mb-1">Proveedor Adjudicado</label>
          <input id="ws-bm-supp" placeholder="Ej: Comercializadora Global SpA" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
        </div>
        <div>
          <label class="block font-semibold text-slate-700 mb-1">Precio Unitario Neto Adjudicado ($) *</label>
          <input id="ws-bm-price" type="number" required placeholder="Ej: 32500" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-amber-700 font-bold">
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block font-semibold text-slate-700 mb-1">ID Licitación Mercado Público</label>
          <input id="ws-bm-tid" placeholder="Ej: 2405-12-LR24" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950 font-mono">
        </div>
        <div>
          <label class="block font-semibold text-slate-700 mb-1">Fecha Adjudicación</label>
          <input id="ws-bm-date" type="date" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
        </div>
      </div>
      <div>
        <label class="block font-semibold text-slate-700 mb-1">Observaciones / Especificación Clave</label>
        <input id="ws-bm-notes" placeholder="Ej: Precio por 300 unidades entrega en Santiago" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
      </div>
      <div class="flex justify-end gap-2 pt-2 border-t border-slate-200">
        <button type="button" onclick="closePfModal()" class="px-3.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900">Cancelar</button>
        <button type="submit" class="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Guardar Referencia</button>
      </div>
    </form>
  `;
  pfModal('Registrar Precio Referencial de Adjudicación', html, false);
}

async function wsSubmitBenchmark(e) {
  e.preventDefault();
  const prod = document.getElementById('ws-bm-prod').value;
  const supp = document.getElementById('ws-bm-supp').value;
  const price = parseFloat(document.getElementById('ws-bm-price').value) || 0;
  const tid = document.getElementById('ws-bm-tid').value;
  const date = document.getElementById('ws-bm-date').value;
  const notes = document.getElementById('ws-bm-notes').value;

  try {
    await wsApi(`/api/folders/${ws.id}/benchmarks`, jsonOpts('POST', {
      product_name: prod,
      awarded_supplier: supp,
      unit_price_net: price,
      tender_id: tid,
      tender_date: date,
      notes: notes
    }));
    showToast('Precio referencial guardado');
    closePfModal();
    await wsLoadBenchmarks();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function wsDeleteBenchmark(id) {
  if (!confirm('¿Eliminar este precio referencial?')) return;
  try {
    await wsApi(`/api/folders/${ws.id}/benchmarks/${id}`, { method: 'DELETE' });
    showToast('Referencia eliminada');
    await wsLoadBenchmarks();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------------------------------
// 4. POST-ADJUDICACIÓN: SEMÁFORO DE DESPACHO, MULTAS Y CURVAS DE TALLA
// ----------------------------------------------------------------------------
async function wsRenderPostAwardBanner() {
  const container = document.getElementById('ws-post-award-banner');
  if (!container || !ws.id) return;
  try {
    const res = await wsApi(`/api/folders/${ws.id}/dispatch-status`);
    const f = ws.data?.folder || {};

    const isPostAward = ['ADJUDICADA', 'EN_EJECUCION', 'CERRADA'].includes(f.status) || f.oc_date || f.delivery_days || res.guide_number;
    if (!isPostAward) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');

    let badgeCls = 'bg-slate-100 text-slate-700 border-slate-300';
    let statusLabel = 'Configurar Despacho';
    let borderCls = 'border-slate-200 bg-white';

    if (res.status === 'ENTREGADO') {
      badgeCls = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      statusLabel = `ENTREGADO (Guía #${res.guide_number || 'S/N'})`;
      borderCls = 'border-emerald-200 bg-emerald-50';
    } else if (res.status === 'EN_PLAZO') {
      if (res.alert_level === 'CRITICO') {
        badgeCls = 'bg-rose-100 text-rose-700 border-rose-300 animate-pulse';
        statusLabel = `¡CRÍTICO! Vence en ${res.days_remaining} día`;
        borderCls = 'border-rose-300 bg-rose-50';
      } else if (res.alert_level === 'ALTA') {
        badgeCls = 'bg-amber-100 text-amber-700 border-amber-300';
        statusLabel = `ALERTA: ${res.days_remaining} días restantes`;
        borderCls = 'border-amber-200 bg-amber-50';
      } else if (res.alert_level === 'MEDIA') {
        badgeCls = 'bg-amber-50 text-amber-700 border-amber-200';
        statusLabel = `<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${res.days_remaining} días restantes`;
        borderCls = 'border-amber-200 bg-white';
      } else {
        badgeCls = 'bg-emerald-50 text-emerald-700 border-emerald-200';
        statusLabel = `AL DÍA (${res.days_remaining} días restantes)`;
        borderCls = 'border-emerald-200 bg-white';
      }
    } else if (res.status === 'VENCIDO') {
      badgeCls = 'bg-rose-600 text-white font-extrabold animate-pulse';
      statusLabel = `¡PLAZO VENCIDO (${Math.abs(res.days_remaining)} DÍAS ATRASO)!`;
      borderCls = 'border-rose-600 bg-rose-50';
    }

    container.innerHTML = `
      <div class="rounded-xl border ${borderCls} p-4 text-xs space-y-3 shadow-lg">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-2">
          <div class="flex items-center space-x-2">
            <span class="text-lg"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg></span>
            <div class="font-bold text-slate-950 flex items-center gap-2">
              <span>Control y Alerta de Plazo de Despacho</span>
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${badgeCls}">${statusLabel}</span>
            </div>
          </div>
          <div class="flex items-center space-x-2">
            <button onclick="wsOpenDispatchSheetModal()" class="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-1 shadow">
              <span><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg></span> Planilla y Curvas de Talla
            </button>
            <button onclick="wsOpenDispatchGuideModal()" class="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-semibold flex items-center gap-1">
              <span><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg></span> Registrar Guía Despacho
            </button>
            <button onclick="wsOpenDispatchConfigModal()" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold" title="Configurar parámetros de entrega y multas">
              <svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-slate-700">
          <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <div class="text-[10px] text-slate-500 uppercase font-semibold">Orden de Compra (OC)</div>
            <div class="font-bold text-slate-950 mt-0.5">#${esc(res.oc_number || f.oc_number || 'S/N')}</div>
            <div class="text-[10px] text-slate-600 mt-0.5">Fecha: ${esc(res.oc_date || 'Sin fecha')}</div>
          </div>
          <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <div class="text-[10px] text-slate-500 uppercase font-semibold">Plazo Fatal de Entrega</div>
            <div class="font-bold text-amber-700 mt-0.5">${esc(res.fatal_date || 'Sin definir')}</div>
            <div class="text-[10px] text-slate-600 mt-0.5">${res.delivery_days || 0} días corridos</div>
          </div>
          <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <div class="text-[10px] text-slate-500 uppercase font-semibold">Multa Diaria por Atraso</div>
            <div class="font-bold text-rose-700 mt-0.5">$${Math.round(res.fine_per_day_clp || 0).toLocaleString('es-CL')} / día</div>
            <div class="text-[10px] text-slate-600 mt-0.5">${res.daily_penalty_pct || 0.5}% sobre monto OC</div>
          </div>
          <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <div class="text-[10px] text-slate-500 uppercase font-semibold">${res.status === 'VENCIDO' ? 'Multa Acumulada' : 'Guía de Despacho'}</div>
            <div class="font-bold ${res.status === 'VENCIDO' ? 'text-rose-700' : 'text-slate-950'} mt-0.5">
              ${res.status === 'VENCIDO' ? '$' + Math.round(res.estimated_penalty_clp || 0).toLocaleString('es-CL') : (res.guide_number ? '#' + esc(res.guide_number) : 'Pendiente')}
            </div>
            <div class="text-[10px] text-slate-600 mt-0.5">${res.guide_date ? 'Fecha: ' + esc(res.guide_date) : (res.status === 'VENCIDO' ? 'Aplica cobro municipal' : 'Sin guía emitida')}</div>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.warn('Error cargando semaforo de despacho:', err);
  }
}

async function wsOpenDispatchSheetModal() {
  try {
    const items = await wsApi(`/api/folders/${ws.id}/dispatch-items`);
    ws._dispatchItems = items || [];
  } catch (e) {
    ws._dispatchItems = [];
  }

  const items = ws._dispatchItems;
  const rows = items.map((it, idx) => {
    const sc = it.size_curve || {};
    return `
      <tr class="border-b border-slate-200 text-xs">
        <td class="py-2 px-2 font-mono text-slate-600">${esc(it.sku || '—')}</td>
        <td class="py-2 px-2 font-semibold text-slate-950">${esc(it.description || '')}</td>
        <td class="py-2 px-2 text-slate-700">${esc(it.color || '—')}</td>
        <td class="py-2 px-1 text-center font-bold text-slate-900">${sc.S || 0}</td>
        <td class="py-2 px-1 text-center font-bold text-slate-900">${sc.M || 0}</td>
        <td class="py-2 px-1 text-center font-bold text-slate-900">${sc.L || 0}</td>
        <td class="py-2 px-1 text-center font-bold text-slate-900">${sc.XL || 0}</td>
        <td class="py-2 px-1 text-center font-bold text-slate-900">${sc.XXL || 0}</td>
        <td class="py-2 px-2 text-right font-bold text-emerald-700 text-sm">${it.total_qty || 0}</td>
        <td class="py-2 px-2 text-slate-600 text-[11px]">${esc(it.destination_address || 'Bodega Central')}</td>
        <td class="py-2 px-1 text-right">
          <button onclick="wsDeleteDispatchItem(${it.id})" class="text-slate-500 hover:text-rose-700"><svg class="w-3.5 h-3.5 inline text-zinc-400 hover:text-rose-600 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </td>
      </tr>
    `;
  }).join('');

  const modalHtml = `
    <div class="space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h3 class="font-bold text-sm text-slate-950 flex items-center gap-2">
            <span>Planilla Oficial de Despacho y Curvas de Talla</span>
          </h3>
          <p class="text-xs text-slate-600 mt-0.5">
            Genera la planilla con desglose por curvas de talla (S, M, L, XL, XXL) y bloque formal para la Recepción Conforme municipal.
          </p>
        </div>
        <div class="flex items-center space-x-2">
          <a href="/api/folders/${ws.id}/dispatch-sheet/pdf" target="_blank" class="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow">
            <span>⬇️</span> Descargar Planilla PDF
          </a>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead class="text-[10px] uppercase text-slate-600 border-b border-slate-200 bg-slate-50">
            <tr>
              <th class="py-2 px-2">SKU</th>
              <th class="py-2 px-2">Descripción Producto</th>
              <th class="py-2 px-2">Color</th>
              <th class="py-2 px-1 text-center">S</th>
              <th class="py-2 px-1 text-center">M</th>
              <th class="py-2 px-1 text-center">L</th>
              <th class="py-2 px-1 text-center">XL</th>
              <th class="py-2 px-1 text-center">XXL</th>
              <th class="py-2 px-2 text-right">Total</th>
              <th class="py-2 px-2">Destino</th>
              <th class="py-2 px-1 text-right"></th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="11" class="py-4 text-center text-xs text-slate-500">No hay líneas de despacho registradas aún. Agrega los productos abajo.</td></tr>'}
          </tbody>
        </table>
      </div>

      <form onsubmit="wsSubmitDispatchItem(event)" class="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3 text-xs">
        <div class="font-bold text-slate-900">Agregar Línea de Despacho:</div>
        <div class="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
          <div class="sm:col-span-2">
            <label class="block text-slate-600 mb-0.5">Descripción del Producto *</label>
            <input id="ws-disp-desc" required placeholder="Ej: Parka reflectante impermeable naranja" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1 text-slate-950">
          </div>
          <div>
            <label class="block text-slate-600 mb-0.5">SKU / Código</label>
            <input id="ws-disp-sku" placeholder="PRK-NAR-01" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1 text-slate-950 font-mono">
          </div>
          <div>
            <label class="block text-slate-600 mb-0.5">Color</label>
            <input id="ws-disp-col" placeholder="Naranja flúor" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1 text-slate-950">
          </div>
        </div>

        <div>
          <label class="block text-slate-600 mb-1">Curva de Tallas (Cantidades por talla):</label>
          <div class="grid grid-cols-5 gap-2">
            <div><span class="text-[10px] text-slate-500">Talla S</span><input id="ws-disp-s" type="number" value="0" min="0" oninput="wsCalcDispatchTotal()" class="w-full bg-white border border-slate-300 rounded px-2 py-1 text-center font-bold text-slate-950"></div>
            <div><span class="text-[10px] text-slate-500">Talla M</span><input id="ws-disp-m" type="number" value="0" min="0" oninput="wsCalcDispatchTotal()" class="w-full bg-white border border-slate-300 rounded px-2 py-1 text-center font-bold text-slate-950"></div>
            <div><span class="text-[10px] text-slate-500">Talla L</span><input id="ws-disp-l" type="number" value="0" min="0" oninput="wsCalcDispatchTotal()" class="w-full bg-white border border-slate-300 rounded px-2 py-1 text-center font-bold text-slate-950"></div>
            <div><span class="text-[10px] text-slate-500">Talla XL</span><input id="ws-disp-xl" type="number" value="0" min="0" oninput="wsCalcDispatchTotal()" class="w-full bg-white border border-slate-300 rounded px-2 py-1 text-center font-bold text-slate-950"></div>
            <div><span class="text-[10px] text-slate-500">Talla XXL</span><input id="ws-disp-xxl" type="number" value="0" min="0" oninput="wsCalcDispatchTotal()" class="w-full bg-white border border-slate-300 rounded px-2 py-1 text-center font-bold text-slate-950"></div>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label class="block text-slate-600 mb-0.5">Destino / Lugar de Entrega</label>
            <input id="ws-disp-dest" placeholder="Ej: Bodega Central Municipalidad de Maipú" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1 text-slate-950">
          </div>
          <div class="flex items-end justify-between">
            <div>
              <span class="text-[10px] text-slate-600">Total calculado:</span>
              <span id="ws-disp-total-preview" class="ml-2 font-bold text-emerald-700 text-sm">0 unid.</span>
            </div>
            <button type="submit" class="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">
              + Agregar a Planilla
            </button>
          </div>
        </div>
      </form>

      <div class="flex justify-end pt-3 border-t border-slate-200">
        <button onclick="closePfModal()" class="px-4 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs">
          Cerrar
        </button>
      </div>
    </div>
  `;
  pfModal('Planilla de Despacho y Curvas de Talla', modalHtml, true);
}

function wsCalcDispatchTotal() {
  const s = parseInt(document.getElementById('ws-disp-s')?.value) || 0;
  const m = parseInt(document.getElementById('ws-disp-m')?.value) || 0;
  const l = parseInt(document.getElementById('ws-disp-l')?.value) || 0;
  const xl = parseInt(document.getElementById('ws-disp-xl')?.value) || 0;
  const xxl = parseInt(document.getElementById('ws-disp-xxl')?.value) || 0;
  const total = s + m + l + xl + xxl;
  const el = document.getElementById('ws-disp-total-preview');
  if (el) el.textContent = `${total} unid.`;
}

async function wsSubmitDispatchItem(e) {
  e.preventDefault();
  const desc = document.getElementById('ws-disp-desc').value;
  const sku = document.getElementById('ws-disp-sku').value;
  const col = document.getElementById('ws-disp-col').value;
  const dest = document.getElementById('ws-disp-dest').value;

  const s = parseInt(document.getElementById('ws-disp-s').value) || 0;
  const m = parseInt(document.getElementById('ws-disp-m').value) || 0;
  const l = parseInt(document.getElementById('ws-disp-l').value) || 0;
  const xl = parseInt(document.getElementById('ws-disp-xl').value) || 0;
  const xxl = parseInt(document.getElementById('ws-disp-xxl').value) || 0;
  const total = s + m + l + xl + xxl;

  try {
    await wsApi(`/api/folders/${ws.id}/dispatch-items`, jsonOpts('POST', [{
      description: desc,
      sku: sku,
      color: col,
      size_curve: { S: s, M: m, L: l, XL: xl, XXL: xxl },
      total_qty: total || 1,
      destination_address: dest
    }]));
    showToast('Línea agregada a la planilla de despacho');
    await wsOpenDispatchSheetModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function wsDeleteDispatchItem(id) {
  if (!confirm('¿Eliminar esta línea de despacho?')) return;
  try {
    await wsApi(`/api/folders/${ws.id}/dispatch-items/${id}`, { method: 'DELETE' });
    showToast('Línea eliminada');
    await wsOpenDispatchSheetModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function wsOpenDispatchGuideModal() {
  const f = ws.data?.folder || {};
  const today = new Date().toISOString().slice(0, 10);

  const html = `
    <form onsubmit="wsSubmitDispatchGuide(event)" class="space-y-4 text-xs">
      <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-emerald-700">
        Registra el número de Guía de Despacho y la fecha de entrega efectiva para cerrar el plazo y acreditar cumplimiento ante el mandante.
      </div>
      <div>
        <label class="block font-semibold text-slate-700 mb-1">N° de Guía de Despacho *</label>
        <input id="ws-dg-num" type="text" required placeholder="Ej: 10425" value="${esc(f.dispatch_guide_number || '')}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950 font-mono text-sm font-bold">
      </div>
      <div>
        <label class="block font-semibold text-slate-700 mb-1">Fecha de Despacho / Entrega Efectiva *</label>
        <input id="ws-dg-date" type="date" required value="${esc(f.dispatch_guide_date || today)}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950 font-semibold">
      </div>
      <div class="flex justify-end gap-2 pt-2 border-t border-slate-200">
        <button type="button" onclick="closePfModal()" class="px-3.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900">Cancelar</button>
        <button type="submit" class="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">Registrar Guía</button>
      </div>
    </form>
  `;
  pfModal('Registrar Guía de Despacho', html, false);
}

async function wsSubmitDispatchGuide(e) {
  e.preventDefault();
  const num = document.getElementById('ws-dg-num').value;
  const date = document.getElementById('ws-dg-date').value;

  try {
    await wsApi(`/api/folders/${ws.id}/dispatch-guide`, jsonOpts('POST', {
      guide_number: num,
      guide_date: date
    }));
    showToast('Guía de despacho registrada exitosamente');
    closePfModal();
    await loadWorkspace();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function wsOpenDispatchConfigModal() {
  const f = ws.data?.folder || {};
  const html = `
    <form onsubmit="wsSubmitDispatchConfig(event)" class="space-y-4 text-xs">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block font-semibold text-slate-700 mb-1">Fecha de la Orden de Compra (OC)</label>
          <input id="ws-dc-date" type="date" value="${esc(f.oc_date || '')}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
        </div>
        <div>
          <label class="block font-semibold text-slate-700 mb-1">Plazo de Entrega (días corridos)</label>
          <input id="ws-dc-days" type="number" min="1" value="${f.delivery_days || 15}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950 font-bold">
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block font-semibold text-slate-700 mb-1">% Multa Diaria por Atraso</label>
          <input id="ws-dc-pct" type="number" step="0.1" value="${f.daily_penalty_pct || 0.5}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-rose-700 font-bold">
          <div class="text-[10px] text-slate-500 mt-0.5">Estándar Mercado Público: 0.5% a 1% diario</div>
        </div>
        <div>
          <label class="block font-semibold text-slate-700 mb-1">Multa Fija Diaria (CLP, opcional)</label>
          <input id="ws-dc-fixed" type="number" value="${f.daily_penalty_fixed || 0}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
        </div>
      </div>
      <div class="flex justify-end gap-2 pt-2 border-t border-slate-200">
        <button type="button" onclick="closePfModal()" class="px-3.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900">Cancelar</button>
        <button type="submit" class="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Guardar Parámetros</button>
      </div>
    </form>
  `;
  pfModal('Configurar Plazos de Entrega y Multas', html, false);
}

async function wsSubmitDispatchConfig(e) {
  e.preventDefault();
  const date = document.getElementById('ws-dc-date').value;
  const days = parseInt(document.getElementById('ws-dc-days').value) || 15;
  const pct = parseFloat(document.getElementById('ws-dc-pct').value) || 0.5;
  const fixed = parseFloat(document.getElementById('ws-dc-fixed').value) || 0;

  try {
    await wsApi(`/api/folders/${ws.id}/dispatch-guide`, jsonOpts('POST', {
      oc_date: date || null,
      delivery_days: days,
      daily_penalty_pct: pct,
      daily_penalty_fixed: fixed
    }));
    showToast('Parámetros de entrega actualizados');
    closePfModal();
    await loadWorkspace();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------------------------------
// 5. BÓVEDA LEGAL: SINCRONIZACIÓN UNIVERSAL A CHECKLIST DE LICITACIÓN
// ----------------------------------------------------------------------------
async function wsSyncLegalVault() {
  if (!ws.id) return;
  try {
    showToast('Sincronizando antecedentes desde la Bóveda Legal...', 'info');
    const res = await wsApi(`/api/folders/${ws.id}/sync-vault-to-checklist`, { method: 'POST' });
    if (res.matched_count > 0) {
      showToast(`¡Bóveda Sincronizada! Se asociaron ${res.matched_count} antecedentes vigentes.`);
    } else {
      showToast('No se encontraron nuevos antecedentes pendientes para sincronizar desde la Bóveda.');
    }
    await loadWorkspace();
  } catch (err) {
    showToast('Error sincronizando bóveda: ' + err.message, 'error');
  }
}
