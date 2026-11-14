// ============================================================================
// ERP COMERCIAL Y OPERATIVO - CONTROLADOR PRINCIPAL SPA
// ============================================================================

const state = {
  activeTab: 'dashboard',
  companies: [],
  currentCompany: null,
  folders: [],
  products: [],
  quotations: [],
  dtes: [],
  transactions: [],
  aging: null,
  taxProjection: null,
  currentFolderDetail: null,
  chartInstance: null,
  currentPeriod: '2026-10'
};

// --- Estado y Manejo Centralizado del Período Fiscal (Mes / Año) ---
function getGlobalPeriod() {
  const el = document.getElementById('global-period-selector') || document.getElementById('sii-period');
  return (el && el.value) ? el.value : (state.currentPeriod || '2026-10');
}

function getGlobalPeriodQuery(paramName = 'month') {
  const per = getGlobalPeriod();
  if (!per) return '';
  if (paramName === 'month') return '?month=' + per;
  const parts = per.split('-');
  return '?year=' + parseInt(parts[0], 10) + '&month=' + parseInt(parts[1], 10);
}

window.getGlobalPeriod = getGlobalPeriod;
window.getGlobalPeriodQuery = getGlobalPeriodQuery;
window.siiPeriodMonthQuery = function () { return getGlobalPeriodQuery('month'); };
window.siiPeriodQuery = function () { return getGlobalPeriodQuery('both'); };

async function onGlobalPeriodChange(newVal) {
  if (!newVal) return;
  state.currentPeriod = newVal;

  // Sincronizar selectores en pantalla
  const gEl = document.getElementById('global-period-selector');
  if (gEl && gEl.value !== newVal) gEl.value = newVal;
  const sEl = document.getElementById('sii-period');
  if (sEl && sEl.value !== newVal) sEl.value = newVal;
  const rcvEl = document.getElementById('rcv-per');
  if (rcvEl && rcvEl.value !== newVal) rcvEl.value = newVal;

  // Actualizar etiqueta del período en F29
  const f29Per = document.getElementById('sii-f29-periodo');
  if (f29Per) f29Per.textContent = newVal;

  try {
    const promises = [];
    if (typeof renderDashboard === 'function') promises.push(renderDashboard());
    if (typeof renderSII === 'function') promises.push(renderSII());
    if (typeof renderBanking === 'function' && document.getElementById('view-banking') && !document.getElementById('view-banking').classList.contains('hidden')) {
      promises.push(renderBanking());
    }
    await Promise.all(promises);
  } catch (err) {
    console.error('Error al actualizar datos por cambio de período:', err);
  }
}
window.onGlobalPeriodChange = onGlobalPeriodChange;
window.siiPeriodChanged = function () {
  const el = document.getElementById('sii-period') || document.getElementById('global-period-selector');
  if (el) onGlobalPeriodChange(el.value);
};

function stepGlobalPeriod(delta) {
  const cur = getGlobalPeriod();
  const [y, m] = cur.split('-').map(Number);
  const d = new Date(y, (m - 1) + delta, 1);
  const nextVal = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  onGlobalPeriodChange(nextVal);
}
window.stepGlobalPeriod = stepGlobalPeriod;

function setGlobalPeriodCurrent() {
  const d = new Date();
  const nextVal = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  onGlobalPeriodChange(nextVal);
}
window.setGlobalPeriodCurrent = setGlobalPeriodCurrent;

// --- Utilidades de Formato ---
function formatCLP(val) {
  if (val === null || val === undefined || isNaN(val)) return '$0';
  return '$' + Math.round(Number(val)).toLocaleString('es-CL');
}

function formatRUT(rut) {
  if (!rut) return '';
  let clean = rut.replace(/[^0-9kK]/g, '').toUpperCase();
  if (clean.length < 2) return clean;
  let cuerpo = clean.slice(0, -1);
  let dv = clean.slice(-1);
  let formatted = '';
  while (cuerpo.length > 3) {
    formatted = '.' + cuerpo.slice(-3) + formatted;
    cuerpo = cuerpo.slice(0, -3);
  }
  return cuerpo + formatted + '-' + dv;
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  const bg = type === 'success' ? 'bg-emerald-600' : (type === 'error' ? 'bg-rose-600' : 'bg-blue-600');
  toast.className = `${bg} text-white px-4 py-3 rounded-lg shadow-xl flex items-center space-x-2 text-sm fade-in transition-all duration-300`;
  toast.innerHTML = `<i data-lucide="${type === 'success' ? 'check-circle' : 'alert-circle'}" class="w-4 h-4"></i><span>${message}</span>`;
  container.appendChild(toast);
  lucide.createIcons();
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// --- Inicialización de la Aplicación ---
document.addEventListener('DOMContentLoaded', async () => {
  await loadCompanies();
  setupNavigation();
  const params = new URLSearchParams(window.location.search);
  const validTabs = ['dashboard', 'folders', 'pipeline', 'sii', 'banking', 'inventory', 'companies', 'users'];
  const requestedTab = params.get('tab') || (window.location.hash ? window.location.hash.slice(1) : '');
  const initialTab = validTabs.includes(requestedTab) ? requestedTab : 'dashboard';
  await switchTab(initialTab);
  setupSignatureCanvas('signature-canvas');
  setupSignatureCanvas('anexo-signature-canvas');
});

// --- Navegación por Pestañas ---
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-tab-btn');
  navItems.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = btn.dataset.tab;
      if (tab) switchTab(tab);
    });
  });
}

async function switchTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll('.nav-tab-btn').forEach(b => {
    if (b.dataset.tab === tabName) {
      b.classList.add('bg-blue-600', 'text-slate-950', 'font-semibold');
      b.classList.remove('text-slate-700', 'hover:bg-slate-100');
    } else {
      b.classList.remove('bg-blue-600', 'text-slate-950', 'font-semibold');
      b.classList.add('text-slate-700', 'hover:bg-slate-100');
    }
  });
  document.querySelectorAll('.rail-tab-btn[data-rail-tab]').forEach(rb => {
    const isRailActive = rb.dataset.railTab === tabName || (tabName === 'workspace' && rb.dataset.railTab === 'folders') || (tabName === 'users' && rb.dataset.railTab === 'companies');
    rb.classList.toggle('rail-active', isRailActive);
  });

  document.querySelectorAll('.tab-view-content').forEach(view => {
    view.classList.add('hidden');
  });

  const activeView = document.getElementById(`view-${tabName}`);
  if (activeView) activeView.classList.remove('hidden');

  // Carga de datos según la pestaña activa
  if (tabName === 'dashboard') await renderDashboard();
  if (tabName === 'folders') await renderFolders();
  if (tabName === 'tenders') await renderTenders();
  if (tabName === 'quotations') await renderQuotations();
  if (tabName === 'sii') await renderSII();
  if (tabName === 'banking') await renderBanking();
  if (tabName === 'inventory') await renderInventory();
  if (tabName === 'companies') await renderCompaniesConfig();

  lucide.createIcons();
}

// --- Carga de Empresas ---
async function loadCompanies() {
  try {
    const res = await fetch('/api/companies/');
    state.companies = await res.json();
    state.currentCompany = state.companies.find(c => c.is_default === 1) || state.companies[0];
    const compSelect = document.getElementById('header-company-name');
    if (compSelect && state.currentCompany) {
      compSelect.textContent = state.currentCompany.razon_social;
      document.getElementById('header-company-rut').textContent = state.currentCompany.rut;
    }
    const compCountEl = document.getElementById('nav-count-companies');
    if (compCountEl && Array.isArray(state.companies)) {
      compCountEl.textContent = String(state.companies.length);
    }
  } catch (err) {
    console.error('Error cargando empresas:', err);
  }
}

// ============================================================================
// 1. DASHBOARD EJECUTIVO
// ============================================================================
async function renderDashboard() {
  try {
    const qProj = (typeof siiPeriodQuery === 'function' ? siiPeriodQuery() : '');
    const qAging = (typeof getGlobalPeriodQuery === 'function' ? getGlobalPeriodQuery('month') : '');
    const [foldersRes, invRes, taxRes, agingRes] = await Promise.all([
      fetch('/api/folders/').then(r => r.json()),
      fetch('/api/inventory/summary').then(r => r.json()),
      fetch('/api/sii/projection' + qProj).then(r => r.json()),
      fetch('/api/banking/aging-dashboard' + qAging).then(r => r.json())
    ]);

    state.folders = foldersRes;
    state.taxProjection = taxRes;
    state.aging = agingRes;

    // Calcular KPIs
    let totalVentasNetas = foldersRes.reduce((acc, f) => acc + (f.venta_neta || 0), 0);
    let totalCostos = foldersRes.reduce((acc, f) => acc + (f.costo_total || 0), 0);
    let totalUtilidadNeta = foldersRes.reduce((acc, f) => acc + (f.utilidad_neta || 0), 0);

    // Consolidar con DTEs del mes si no hay carpetas con movimientos para el período
    if (totalVentasNetas === 0 && (taxRes.base_ventas_neta || 0) > 0) {
      totalVentasNetas = taxRes.base_ventas_neta;
    }
    if (totalCostos === 0 && (taxRes.base_compras_neta || 0) > 0) {
      totalCostos = taxRes.base_compras_neta;
    }
    if (foldersRes.length === 0 || (totalVentasNetas > 0 && totalUtilidadNeta === 0)) {
      totalUtilidadNeta = totalVentasNetas - totalCostos;
    }

    const margenGlobal = totalVentasNetas > 0 ? ((totalUtilidadNeta / totalVentasNetas) * 100).toFixed(1) : 0;

    document.getElementById('kpi-ventas-netas').textContent = formatCLP(totalVentasNetas);
    document.getElementById('kpi-utilidad-neta').textContent = formatCLP(totalUtilidadNeta);
    document.getElementById('kpi-margen-promedio').textContent = `${margenGlobal}%`;

    // Proyección Tributaria F29
    const debitoEl = document.getElementById('kpi-iva-debito');
    if (debitoEl) debitoEl.textContent = formatCLP(taxRes.iva_debito);
    const creditoEl = document.getElementById('kpi-iva-credito');
    if (creditoEl) creditoEl.textContent = formatCLP(taxRes.iva_credito);
    const ppmEl = document.getElementById('kpi-ppm-monto');
    if (ppmEl) ppmEl.textContent = formatCLP(taxRes.monto_ppm);
    const f29El = document.getElementById('kpi-f29-total');
    if (f29El) f29El.textContent = formatCLP(taxRes.total_f29_pagar);
    
    const badgeIva = document.getElementById('kpi-iva-badge');
    if (taxRes.iva_a_pagar > 0) {
      badgeIva.textContent = `A Pagar: ${formatCLP(taxRes.iva_a_pagar)}`;
      badgeIva.className = 'text-xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 font-semibold';
    } else {
      badgeIva.textContent = `Remanente: ${formatCLP(taxRes.remanente_iva)}`;
      badgeIva.className = 'text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold';
    }

    // Cobranzas y Pagos
    document.getElementById('kpi-cxc-total').textContent = formatCLP(agingRes.cxc.total_monto);
    document.getElementById('kpi-cxp-total').textContent = formatCLP(agingRes.cxp.total_monto);

    // Stock Crítico
    document.getElementById('kpi-stock-critico').textContent = `${invRes.articulos_criticos_count} ítems`;

    // Gráfico de Rendimiento por Carpeta
    renderDashboardChart(foldersRes);

    // Tabla de Carpetas Destacadas
    const tbody = document.getElementById('dashboard-folders-tbody');
    tbody.innerHTML = '';
    foldersRes.slice(0, 5).forEach(f => {
      const semClass = f.semaforo === 'VERDE' ? 'badge-verde' : (f.semaforo === 'AMARILLO' ? 'badge-amarillo' : 'badge-rojo');
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-200 hover:bg-slate-100 text-sm';
      tr.innerHTML = `
        <td class="py-3 px-3 font-semibold text-blue-700 cursor-pointer" onclick="openFolderDetail(${f.folder_id})">${f.code}</td>
        <td class="py-3 px-3 text-slate-900">${f.title}</td>
        <td class="py-3 px-3 text-slate-600">${f.client_name}</td>
        <td class="py-3 px-3 text-right font-medium text-slate-900">${formatCLP(f.venta_neta)}</td>
        <td class="py-3 px-3 text-right text-rose-700">${formatCLP(f.costo_total)}</td>
        <td class="py-3 px-3 text-right font-bold text-emerald-700">${formatCLP(f.utilidad_neta)}</td>
        <td class="py-3 px-3 text-center"><span class="px-2.5 py-1 rounded-full text-xs font-bold ${semClass}">${f.margen_pct}%</span></td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error('Error renderizando dashboard:', err);
  }
}

function renderDashboardChart(folders) {
  const ctx = document.getElementById('dashboardChart');
  if (!ctx) return;
  if (state.chartInstance) state.chartInstance.destroy();

  const labels = folders.map(f => f.code);
  const ventas = folders.map(f => f.venta_neta);
  const costos = folders.map(f => f.costo_total);
  const utilidades = folders.map(f => f.utilidad_neta);

  state.chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { label: 'Venta Neta ($CLP)', data: ventas, backgroundColor: '#3b82f6', borderRadius: 4 },
        { label: 'Costo Total ($CLP)', data: costos, backgroundColor: '#ef4444', borderRadius: 4 },
        { label: 'Utilidad Neta ($CLP)', data: utilidades, backgroundColor: '#10b981', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#0f172a', font: { family: 'Plus Jakarta Sans' } } }
      },
      scales: {
        x: { ticks: { color: '#334155' }, grid: { color: '#e2e8f0' } },
        y: {
          ticks: {
            color: '#334155',
            callback: (v) => '$' + (v / 1000000).toFixed(1) + 'M'
          },
          grid: { color: '#e2e8f0' }
        }
      }
    }
  });
}

// ============================================================================
// 2. MÓDULO CARPETAS / NOTAS DE NEGOCIO (COSTEO Y MARGEN)
// ============================================================================
async function renderFolders() {
  try {
    const res = await fetch('/api/folders/');
    state.folders = await res.json();
    const tbody = document.getElementById('folders-table-tbody');
    tbody.innerHTML = '';

    state.folders.forEach(f => {
      const semClass = f.semaforo === 'VERDE' ? 'badge-verde' : (f.semaforo === 'AMARILLO' ? 'badge-amarillo' : 'badge-rojo');
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-200 hover:bg-slate-100 transition-colors text-sm';
      tr.innerHTML = `
        <td class="py-3 px-3 font-bold text-blue-700 cursor-pointer" onclick="openFolderDetail(${f.folder_id})">
          <div class="flex items-center space-x-1.5">
            <i data-lucide="folder" class="w-4 h-4 text-blue-700"></i>
            <span>${f.code}</span>
          </div>
        </td>
        <td class="py-3 px-3 font-medium text-slate-950 max-w-xs truncate">${f.title}</td>
        <td class="py-3 px-3 text-slate-700">
          <div>${f.client_name}</div>
          <div class="text-xs text-slate-500">${f.client_rut}</div>
        </td>
        <td class="py-3 px-3">
          <span class="px-2 py-0.5 rounded text-xs font-semibold ${f.type === 'MERCADO_PUBLICO' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-slate-100 text-slate-700'}">
            ${f.type === 'MERCADO_PUBLICO' ? 'Mercado Público' : 'Privado'}
          </span>
        </td>
        <td class="py-3 px-3 text-right font-bold text-slate-950">${formatCLP(f.venta_neta)}</td>
        <td class="py-3 px-3 text-right text-rose-700">${formatCLP(f.costo_directo)}</td>
        <td class="py-3 px-3 text-right text-amber-700">${formatCLP(f.gastos_asociados)}</td>
        <td class="py-3 px-3 text-right font-bold text-emerald-700">${formatCLP(f.utilidad_neta)}</td>
        <td class="py-3 px-3 text-center">
          <span class="px-2.5 py-1 rounded-full text-xs font-bold ${semClass}">${f.margen_pct}%</span>
        </td>
        <td class="py-3 px-3 text-center">
          <div class="flex items-center justify-center space-x-2">
            <button onclick="openFolderDetail(${f.folder_id})" class="p-1.5 text-blue-700 hover:bg-blue-100 rounded" title="Ver detalle y costeo">
              <i data-lucide="eye" class="w-4 h-4"></i>
            </button>
            <a href="/api/export/folder/${f.folder_id}" class="p-1.5 text-emerald-700 hover:bg-emerald-100 rounded" title="Descargar Excel de carpeta">
              <i data-lucide="file-spreadsheet" class="w-4 h-4"></i>
            </a>
            <button type="button" onclick="event.stopPropagation(); deleteFolderAction(${f.folder_id}, '${esc(f.title)}')" class="p-1.5 text-slate-600 hover:text-rose-700 hover:bg-rose-100 rounded" title="Eliminar Carpeta / Negocio">
              <i data-lucide="trash-2" class="w-4 h-4 text-rose-700"></i>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
    lucide.createIcons();
  } catch (err) {
    console.error('Error renderizando carpetas:', err);
  }
}

// Abrir detalle de Carpeta de Negocio con cálculo en vivo
async function openFolderDetail(folderId) {
  if (typeof openWorkspace === 'function') {
    return openWorkspace(folderId);
  }
  const modal = document.getElementById('folder-detail-modal');
  if (!modal) {
    if (typeof openWorkspaceView === 'function') return openWorkspaceView(folderId);
    return;
  }
  try {
    const res = await fetch(`/api/folders/${folderId}`);
    const data = await res.json();
    state.currentFolderDetail = data;

    const f = data.folder;
    const fin = data.financials;

    const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setT('modal-folder-code', f.code);
    setT('modal-folder-title', f.title);
    setT('modal-folder-client', `${f.client_name} (${f.client_rut})`);
    setT('modal-folder-type', f.type === 'MERCADO_PUBLICO' ? `Mercado Público (ID: ${f.tender_id || 'N/A'})` : 'Venta Privada');
    
    // Indicadores financieros de la tarjeta
    setT('modal-fin-venta-neta', formatCLP(fin.venta_neta));
    setT('modal-fin-venta-bruta', formatCLP(fin.venta_bruta));
    setT('modal-fin-costo-directo', formatCLP(fin.costo_directo));
    setT('modal-fin-gastos', formatCLP(fin.gastos_asociados));
    setT('modal-fin-costo-total', formatCLP(fin.costo_total));
    setT('modal-fin-utilidad', formatCLP(fin.utilidad_neta));
    setT('modal-fin-margen', `${fin.margen_pct}%`);

    const semBadge = document.getElementById('modal-fin-semaforo');
    if (semBadge) {
      semBadge.textContent = fin.semaforo;
      semBadge.className = `px-3 py-1 rounded-full text-xs font-bold ${fin.semaforo === 'VERDE' ? 'badge-verde' : (fin.semaforo === 'AMARILLO' ? 'badge-amarillo' : 'badge-rojo')}`;
    }

    const expBtn = document.getElementById('modal-folder-export-btn');
    if (expBtn) expBtn.href = `/api/export/folder/${f.id}`;

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error abriendo detalle de carpeta:', err);
    showToast('Error cargando detalle de la carpeta', 'error');
  }
}

function closeFolderDetailModal() {
  const modal = document.getElementById('folder-detail-modal');
  if (modal) modal.classList.add('hidden');
}

// Modal Crear Nueva Carpeta
function openNewFolderModal() {
  document.getElementById('new-folder-form').reset();
  document.getElementById('new-folder-modal').classList.remove('hidden');
}

function closeNewFolderModal() {
  document.getElementById('new-folder-modal').classList.add('hidden');
}

async function handleCreateFolder(e) {
  e.preventDefault();
  const form = document.getElementById('new-folder-form');
  const payload = {
    title: form.title.value.trim(),
    client_name: form.client_name.value.trim(),
    client_rut: form.client_rut.value.trim(),
    type: form.type.value,
    tender_id: form.tender_id.value.trim() || null,
    budget_amount: parseFloat(form.budget_amount.value) || 0,
    target_margin_pct: parseFloat(form.target_margin_pct.value) || 25.0,
    status: 'EN_EJECUCION',
    notes: form.notes.value.trim()
  };

  try {
    const res = await fetch('/api/folders/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast('Carpeta de Negocio creada exitosamente');
      closeNewFolderModal();
      await renderFolders();
    } else {
      showToast('Error al crear la carpeta', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Error de conexión', 'error');
  }
}

// Agregar Gasto Manual a Carpeta
async function handleAddExpense(e) {
  e.preventDefault();
  if (!state.currentFolderDetail) return;
  const form = document.getElementById('add-expense-form');
  const payload = {
    folder_id: state.currentFolderDetail.folder.id,
    description: form.description.value.trim(),
    category: form.category.value,
    amount: parseFloat(form.amount.value) || 0,
    date: form.date.value || new Date().toISOString().slice(0, 10),
    doc_number: form.doc_number.value.trim() || null,
    supplier_rut: form.supplier_rut.value.trim() || null,
    notes: form.notes.value.trim() || null
  };

  try {
    const res = await fetch('/api/folders/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast('Gasto registrado en la carpeta');
      form.reset();
      await openFolderDetail(state.currentFolderDetail.folder.id);
      await renderFolders();
    }
  } catch (err) {
    showToast('Error al registrar gasto', 'error');
  }
}

async function deleteFolderExpense(expenseId, folderId) {
  if (!confirm('¿Deseas eliminar este gasto de la carpeta?')) return;
  try {
    const res = await fetch(`/api/folders/expenses/${expenseId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Gasto eliminado');
      await openFolderDetail(folderId);
      await renderFolders();
    }
  } catch (err) {
    showToast('Error al eliminar gasto', 'error');
  }
}

// ============================================================================
// 3. MÓDULO COMERCIAL Y LICITACIONES (MERCADO PÚBLICO & FIRMAS)
// ============================================================================
async function renderTenders() {
  try {
    const res = await fetch('/api/tenders/');
    const tenders = await res.json();
    const container = document.getElementById('tenders-cards-container');
    container.innerHTML = '';

    tenders.forEach(t => {
      const card = document.createElement('div');
      card.className = 'bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-all shadow-lg flex flex-col justify-between';
      card.innerHTML = `
        <div>
          <div class="flex items-center justify-between mb-3">
            <span class="px-2.5 py-1 rounded bg-blue-50 text-blue-700 text-xs font-bold border border-blue-200">
              ID: ${t.tender_id || 'Sin ID'}
            </span>
            <span class="text-xs text-slate-600 font-mono">${t.code}</span>
          </div>
          <h3 class="text-base font-bold text-slate-950 mb-1 leading-snug">${t.title}</h3>
          <p class="text-xs text-slate-600 mb-4">${t.client_name}</p>
          
          <div class="space-y-2 mb-4 text-xs text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div class="flex justify-between">
              <span class="text-slate-500">Presupuesto Referencial:</span>
              <span class="font-bold text-slate-900">${formatCLP(t.budget_amount)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Cierre / Apertura:</span>
              <span class="font-medium text-amber-700">${t.tender_closing_date || 'En curso'}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Documentos Asociados:</span>
              <span class="font-semibold text-emerald-700">${t.docs_firmados_count} firmados / ${t.docs_count} total</span>
            </div>
          </div>
        </div>

        <div class="pt-3 border-t border-slate-200 flex items-center justify-between">
          <button onclick="openTenderDocumentsModal(${t.id}, '${t.code}', '${t.title.replace(/'/g, "\\'")}')" class="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2 px-3 rounded-lg flex items-center justify-center space-x-1.5 transition-colors">
            <i data-lucide="file-signature" class="w-4 h-4"></i>
            <span>Ver y Firmar Anexos / Bases</span>
          </button>
        </div>
      `;
      container.appendChild(card);
    });
    lucide.createIcons();
  } catch (err) {
    console.error('Error renderizando licitaciones:', err);
  }
}

// Modal de Documentos y Anexos de Licitación
async function openTenderDocumentsModal(folderId, code, title) {
  try {
    const res = await fetch(`/api/tenders/folders/${folderId}/documents`);
    const docs = await res.json();

    document.getElementById('tender-doc-modal-header').textContent = `Gestor Documental: ${code} - ${title}`;
    const list = document.getElementById('tender-doc-list');
    list.innerHTML = '';

    docs.forEach(doc => {
      const isSigned = doc.status === 'FIRMADO';
      const item = document.createElement('div');
      item.className = 'bg-slate-50 p-4 rounded-xl border border-slate-200 flex items-center justify-between';
      item.innerHTML = `
        <div>
          <div class="flex items-center space-x-2 mb-1">
            <i data-lucide="${isSigned ? 'check-circle' : 'file-text'}" class="w-4 h-4 ${isSigned ? 'text-emerald-700' : 'text-blue-700'}"></i>
            <h4 class="font-semibold text-sm text-slate-950">${doc.name}</h4>
            <span class="text-xs px-2 py-0.5 rounded font-bold ${isSigned ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}">
              ${doc.status}
            </span>
          </div>
          <p class="text-xs text-slate-600">${doc.original_filename || 'Plantilla en plataforma'} ${isSigned ? `• Firmado por: ${doc.signer_name || 'Representante Legal'} (${doc.signer_rut})` : ''}</p>
        </div>
        <div class="flex items-center space-x-2">
          <button onclick="openAnexoEditorModal(${doc.id})" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs rounded-lg flex items-center space-x-1">
            <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
            <span>Completar y Firmar</span>
          </button>
        </div>
      `;
      list.appendChild(item);
    });

    document.getElementById('tender-docs-modal').classList.remove('hidden');
    lucide.createIcons();
  } catch (err) {
    showToast('Error cargando documentos', 'error');
  }
}

function closeTenderDocsModal() {
  document.getElementById('tender-docs-modal').classList.add('hidden');
}

// Modal de Edición de Anexo y Estampador de Firma Digital
let currentDocIdToSign = null;

async function openAnexoEditorModal(docId) {
  try {
    currentDocIdToSign = docId;
    const res = await fetch(`/api/tenders/documents/${docId}`);
    const doc = await res.json();

    document.getElementById('anexo-doc-title').textContent = doc.name;
    const formFieldsContainer = document.getElementById('anexo-form-fields');
    formFieldsContainer.innerHTML = '';

    let formData = {};
    try {
      formData = JSON.parse(doc.form_data_json || '{}');
    } catch (e) {
      formData = {};
    }

    // Campos automáticos según tipo de anexo
    const fieldsToRender = [
      { key: 'razon_social', label: 'Razón Social Oferente', val: formData.razon_social || state.currentCompany?.razon_social || '' },
      { key: 'rut', label: 'RUT Oferente', val: formData.rut || state.currentCompany?.rut || '' },
      { key: 'rep_legal', label: 'Nombre Representante Legal', val: formData.rep_legal || 'Carlos Mendoza Silva' },
      { key: 'rut_rep', label: 'RUT Representante Legal', val: formData.rut_rep || '14.892.341-2' },
      { key: 'plazo_entrega', label: 'Plazo de Entrega Ofertado', val: formData.plazo_entrega || '5 días hábiles' },
      { key: 'vigencia_oferta_dias', label: 'Días de Validez de Oferta', val: formData.vigencia_oferta_dias || 60 }
    ];

    fieldsToRender.forEach(f => {
      const fieldDiv = document.createElement('div');
      fieldDiv.innerHTML = `
        <label class="block text-xs font-semibold text-slate-600 mb-1">${f.label}</label>
        <input type="text" id="anexo-field-${f.key}" value="${f.val}" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-950">
      `;
      formFieldsContainer.appendChild(fieldDiv);
    });

    // Resetear canvas de firma
    clearSignatureCanvas('anexo-signature-canvas');
    if (doc.signature_data_url) {
      loadSignatureImage('anexo-signature-canvas', doc.signature_data_url);
    }

    document.getElementById('anexo-editor-modal').classList.remove('hidden');
    lucide.createIcons();
  } catch (err) {
    showToast('Error cargando anexo', 'error');
  }
}

function closeAnexoEditorModal() {
  document.getElementById('anexo-editor-modal').classList.add('hidden');
}

async function saveAndSignAnexo() {
  if (!currentDocIdToSign) return;
  const canvas = document.getElementById('anexo-signature-canvas');
  const signatureDataUrl = canvas.toDataURL('image/png');

  // Recoger campos editables
  const form_data = {
    razon_social: document.getElementById('anexo-field-razon_social')?.value,
    rut: document.getElementById('anexo-field-rut')?.value,
    rep_legal: document.getElementById('anexo-field-rep_legal')?.value,
    rut_rep: document.getElementById('anexo-field-rut_rep')?.value,
    plazo_entrega: document.getElementById('anexo-field-plazo_entrega')?.value,
    vigencia_oferta_dias: document.getElementById('anexo-field-vigencia_oferta_dias')?.value
  };

  try {
    // 1. Guardar campos
    await fetch(`/api/tenders/documents/${currentDocIdToSign}/form-data`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ form_data: form_data, status: 'FIRMADO' })
    });

    // 2. Estampar firma digital
    const signRes = await fetch(`/api/tenders/documents/${currentDocIdToSign}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signature_data_url: signatureDataUrl,
        signer_name: form_data.rep_legal,
        signer_rut: form_data.rut_rep
      })
    });

    if (signRes.ok) {
      showToast('Anexo completado y firmado digitalmente');
      closeAnexoEditorModal();
      await renderTenders();
    }
  } catch (err) {
    showToast('Error guardando firma', 'error');
  }
}

// ============================================================================
// 4. CONSTRUCTOR DE COTIZACIONES (PÚBLICAS Y PRIVADAS)
// ============================================================================
let quotationItems = [];

async function renderQuotations() {
  try {
    const res = await fetch('/api/quotations/');
    state.quotations = await res.json();
    const tbody = document.getElementById('quotations-table-tbody');
    tbody.innerHTML = '';

    state.quotations.forEach(q => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-200 text-sm hover:bg-slate-100';
      tr.innerHTML = `
        <td class="py-3 px-3 font-bold text-blue-700 cursor-pointer" onclick="viewQuotationDetail(${q.id})">${q.folio}</td>
        <td class="py-3 px-3 text-slate-950">${q.client_name}</td>
        <td class="py-3 px-3 text-slate-600 text-xs">${q.date}</td>
        <td class="py-3 px-3">
          <span class="px-2 py-0.5 rounded text-xs font-semibold ${q.type === 'MERCADO_PUBLICO' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-700'}">
            ${q.type === 'MERCADO_PUBLICO' ? 'Mercado Público' : 'Privada'}
          </span>
        </td>
        <td class="py-3 px-3 text-right font-medium text-slate-700">${formatCLP(q.net_amount)}</td>
        <td class="py-3 px-3 text-right font-bold text-slate-950">${formatCLP(q.total_amount)}</td>
        <td class="py-3 px-3 text-center">
          <span class="px-2.5 py-1 rounded-full text-xs font-bold ${q.status === 'FACTURADA' ? 'bg-emerald-50 text-emerald-700' : (q.status === 'ACEPTADA' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-700')}">
            ${q.status}
          </span>
        </td>
        <td class="py-3 px-3 text-center">
          <div class="flex items-center justify-center space-x-2">
            <button onclick="viewQuotationDetail(${q.id})" class="p-1.5 text-blue-700 hover:bg-blue-100 rounded" title="Ver cotización">
              <i data-lucide="eye" class="w-4 h-4"></i>
            </button>
            <button onclick="printQuotation(${q.id})" class="p-1.5 text-slate-700 hover:bg-slate-200 rounded" title="Imprimir / Guardar PDF">
              <i data-lucide="printer" class="w-4 h-4"></i>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
    lucide.createIcons();
  } catch (err) {
    console.error('Error renderizando cotizaciones:', err);
  }
}

function openNewQuotationModal() {
  quotationItems = [];
  document.getElementById('new-quotation-form').reset();
  document.getElementById('quote-date').value = new Date().toISOString().slice(0, 10);
  renderQuoteItemsTable();
  clearSignatureCanvas('signature-canvas');

  // Llenar selector de carpetas si existen
  const folderSelect = document.getElementById('quote-folder-select');
  folderSelect.innerHTML = '<option value="">-- Sin Carpeta Asignada --</option>';
  state.folders.forEach(f => {
    folderSelect.innerHTML += `<option value="${f.folder_id}">${f.code} - ${f.title}</option>`;
  });

  document.getElementById('new-quotation-modal').classList.remove('hidden');
}

function closeNewQuotationModal() {
  document.getElementById('new-quotation-modal').classList.add('hidden');
}

function addQuotationItemRow() {
  quotationItems.push({
    sku: '',
    description: '',
    unit: 'UND',
    quantity: 1,
    unit_cost: 0,
    unit_price: 0,
    margin_pct: 25,
    subtotal: 0
  });
  renderQuoteItemsTable();
}

function removeQuotationItemRow(index) {
  quotationItems.splice(index, 1);
  renderQuoteItemsTable();
}

function updateQuoteItem(index, field, value) {
  const item = quotationItems[index];
  if (field === 'quantity' || field === 'unit_cost' || field === 'unit_price') {
    item[field] = parseFloat(value) || 0;
  } else {
    item[field] = value;
  }

  // Si se cambia costo o precio, recalcular margen %
  if (field === 'unit_cost' || field === 'unit_price') {
    if (item.unit_price > 0) {
      item.margin_pct = parseFloat((((item.unit_price - item.unit_cost) / item.unit_price) * 100).toFixed(1));
    }
  }

  // Recalcular subtotal
  item.subtotal = item.quantity * item.unit_price;
  renderQuoteItemsTable();
}

function renderQuoteItemsTable() {
  const tbody = document.getElementById('quote-items-tbody');
  tbody.innerHTML = '';

  let netoTotal = 0;

  quotationItems.forEach((it, idx) => {
    netoTotal += it.subtotal;
    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-200 text-xs';
    tr.innerHTML = `
      <td class="py-2 px-1">
        <input type="text" value="${it.sku}" onchange="updateQuoteItem(${idx}, 'sku', this.value)" placeholder="SKU" class="w-24 bg-white border border-slate-300 rounded px-2 py-1 text-slate-950">
      </td>
      <td class="py-2 px-1">
        <input type="text" value="${it.description}" onchange="updateQuoteItem(${idx}, 'description', this.value)" placeholder="Descripción del producto o servicio" class="w-full bg-white border border-slate-300 rounded px-2 py-1 text-slate-950">
      </td>
      <td class="py-2 px-1">
        <input type="number" step="1" min="1" value="${it.quantity}" onchange="updateQuoteItem(${idx}, 'quantity', this.value)" class="w-16 bg-white border border-slate-300 rounded px-2 py-1 text-right text-slate-950">
      </td>
      <td class="py-2 px-1">
        <input type="number" step="1000" min="0" value="${it.unit_cost}" onchange="updateQuoteItem(${idx}, 'unit_cost', this.value)" class="w-24 bg-white border border-slate-300 rounded px-2 py-1 text-right text-amber-700">
      </td>
      <td class="py-2 px-1">
        <input type="number" step="1000" min="0" value="${it.unit_price}" onchange="updateQuoteItem(${idx}, 'unit_price', this.value)" class="w-28 bg-white border border-slate-300 rounded px-2 py-1 text-right text-slate-950 font-bold">
      </td>
      <td class="py-2 px-1 text-center font-semibold text-emerald-700">
        ${it.margin_pct}%
      </td>
      <td class="py-2 px-1 text-right font-bold text-slate-950">
        ${formatCLP(it.subtotal)}
      </td>
      <td class="py-2 px-1 text-center">
        <button type="button" onclick="removeQuotationItemRow(${idx})" class="text-rose-700 hover:text-rose-700">
          <i data-lucide="trash" class="w-3.5 h-3.5"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  const ivaTotal = Math.round(netoTotal * 0.19);
  const totalGeneral = netoTotal + ivaTotal;

  document.getElementById('quote-neto-calc').textContent = formatCLP(netoTotal);
  document.getElementById('quote-iva-calc').textContent = formatCLP(ivaTotal);
  document.getElementById('quote-total-calc').textContent = formatCLP(totalGeneral);
  lucide.createIcons();
}

async function handleSaveQuotation(e) {
  e.preventDefault();
  if (quotationItems.length === 0) {
    showToast('Debes agregar al menos 1 ítem a la cotización', 'error');
    return;
  }

  const form = document.getElementById('new-quotation-form');
  const canvas = document.getElementById('signature-canvas');
  const signatureDataUrl = canvas.toDataURL('image/png');

  const neto = quotationItems.reduce((acc, it) => acc + it.subtotal, 0);
  const iva = Math.round(neto * 0.19);
  const total = neto + iva;

  const payload = {
    folder_id: form.folder_id.value ? parseInt(form.folder_id.value) : null,
    company_id: state.currentCompany ? state.currentCompany.id : null,
    client_name: form.client_name.value.trim(),
    client_rut: form.client_rut.value.trim(),
    client_address: form.client_address.value.trim(),
    client_contact: form.client_contact.value.trim(),
    client_email: form.client_email.value.trim(),
    date: form.date.value,
    validity_days: parseInt(form.validity_days.value) || 15,
    currency: 'CLP',
    payment_terms: form.payment_terms.value.trim(),
    delivery_time: form.delivery_time.value.trim(),
    subtotal: neto,
    discount_amount: 0,
    net_amount: neto,
    tax_amount: iva,
    total_amount: total,
    notes: form.notes.value.trim(),
    type: form.type.value,
    tender_id: form.tender_id.value.trim() || null,
    status: form.status.value,
    signature_data_url: signatureDataUrl,
    signer_name: form.signer_name.value.trim(),
    signer_rut: form.signer_rut.value.trim(),
    items: quotationItems
  };

  try {
    const res = await fetch('/api/quotations/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast('Cotización creada exitosamente con reserva de inventario');
      closeNewQuotationModal();
      await renderQuotations();
      await renderInventory();
    } else {
      showToast('Error al guardar cotización', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Error de conexión', 'error');
  }
}

// Vista previa / Impresión de Cotización
async function viewQuotationDetail(quotationId) {
  try {
    const res = await fetch(`/api/quotations/${quotationId}`);
    const q = await res.json();

    document.getElementById('view-q-folio').textContent = q.folio;
    document.getElementById('view-q-company-name').textContent = q.company_name;
    document.getElementById('view-q-company-rut').textContent = `RUT: ${q.company_rut}`;
    document.getElementById('view-q-company-giro').textContent = q.company_giro || '';
    document.getElementById('view-q-company-address').textContent = q.company_address || '';

    document.getElementById('view-q-client-name').textContent = q.client_name;
    document.getElementById('view-q-client-rut').textContent = `RUT: ${q.client_rut}`;
    document.getElementById('view-q-client-contact').textContent = q.client_contact ? `Contacto: ${q.client_contact}` : '';
    document.getElementById('view-q-date').textContent = q.date;
    document.getElementById('view-q-validity').textContent = `${q.validity_days} días`;
    document.getElementById('view-q-payment').textContent = q.payment_terms;
    document.getElementById('view-q-delivery').textContent = q.delivery_time;

    const tbody = document.getElementById('view-q-items-tbody');
    tbody.innerHTML = '';
    q.items.forEach(it => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-200 text-xs text-slate-800';
      tr.innerHTML = `
        <td class="py-2 px-2 font-mono">${it.sku || '-'}</td>
        <td class="py-2 px-2 font-medium">${it.description}</td>
        <td class="py-2 px-2 text-center">${it.quantity} ${it.unit}</td>
        <td class="py-2 px-2 text-right">${formatCLP(it.unit_price)}</td>
        <td class="py-2 px-2 text-right font-bold">${formatCLP(it.subtotal)}</td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('view-q-neto').textContent = formatCLP(q.net_amount);
    document.getElementById('view-q-iva').textContent = formatCLP(q.tax_amount);
    document.getElementById('view-q-total').textContent = formatCLP(q.total_amount);
    document.getElementById('view-q-notes').textContent = q.notes || 'Precios expresados en pesos chilenos ($CLP).';

    const sigImg = document.getElementById('view-q-signature-img');
    if (q.signature_data_url) {
      sigImg.src = q.signature_data_url;
      sigImg.classList.remove('hidden');
    } else {
      sigImg.classList.add('hidden');
    }
    document.getElementById('view-q-signer-name').textContent = q.signer_name || 'Representante Autorizado';
    document.getElementById('view-q-signer-rut').textContent = q.signer_rut ? `RUT: ${q.signer_rut}` : '';

    document.getElementById('view-quotation-modal').classList.remove('hidden');
    lucide.createIcons();
  } catch (err) {
    showToast('Error cargando cotización', 'error');
  }
}

function closeViewQuotationModal() {
  document.getElementById('view-quotation-modal').classList.add('hidden');
}

function printQuotation() {
  window.print();
}

// ============================================================================
// 5. MÓDULO SII (RCV, EMISIÓN DIRECTA & PROYECCIÓN TRIBUTARIA F29)
// ============================================================================
async function renderSII() {
  try {
    const qMonth = typeof siiPeriodMonthQuery === 'function' ? siiPeriodMonthQuery() : (typeof siiPeriodQuery === 'function' ? siiPeriodQuery() : '');
    const qProj = typeof siiPeriodQuery === 'function' ? siiPeriodQuery() : '';
    const [dtes, tax] = await Promise.all([
      fetch('/api/sii/dtes' + qMonth).then(r => r.json()),
      fetch('/api/sii/projection' + qProj).then(r => r.json())
    ]);

    state.dtes = dtes;
    state.taxProjection = tax;

    // Métricas F29 en vivo
    document.getElementById('sii-f29-periodo').textContent = tax.periodo;
    document.getElementById('sii-f29-iva-debito').textContent = formatCLP(tax.iva_debito);
    document.getElementById('sii-f29-iva-credito').textContent = formatCLP(tax.iva_credito);
    document.getElementById('sii-f29-iva-balance').textContent = formatCLP(tax.iva_a_pagar > 0 ? tax.iva_a_pagar : tax.remanente_iva);
    document.getElementById('sii-f29-iva-estado').textContent = tax.iva_a_pagar > 0 ? 'IVA a Pagar' : 'Remanente de Crédito';
    document.getElementById('sii-f29-ventas-netas').textContent = formatCLP(tax.base_ventas_neta);
    document.getElementById('sii-f29-ppm-monto').textContent = `${formatCLP(tax.monto_ppm)} (${tax.ppm_rate}%)`;
    document.getElementById('sii-f29-total-pagar').textContent = formatCLP(tax.total_f29_pagar);

    // Tabla de DTEs
    renderDtesTable(dtes);

    // Semáforo Tributario de Cierre de Mes (Optimización F29)
    await renderF29ClosingOptimization();

    // Inteligencia Comercial SII: Top Clientes, Top Proveedores, Alertas SII y Guía Contabilidad desde Cero
    await renderSiiAnalytics();
  } catch (err) {
    console.error('Error renderizando SII:', err);
  }
}

function renderDtesTable(dtesList) {
  const tbody = document.getElementById('sii-dtes-tbody');
  tbody.innerHTML = '';

  if (!dtesList || dtesList.length === 0) {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-200 text-xs text-slate-600';
    tr.innerHTML = `<td colspan="9" class="py-8 px-4 text-center">No hay documentos registrados para el período fiscal seleccionado.</td>`;
    tbody.appendChild(tr);
    return;
  }

  dtesList.forEach(d => {
    const isVenta = d.direction === 'EMITIDO';
    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-200 text-xs hover:bg-slate-100';
    tr.innerHTML = `
      <td class="py-2.5 px-3">
        <span class="px-2 py-0.5 rounded text-xs font-bold ${isVenta ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}">
          ${isVenta ? 'Venta (Emitido)' : 'Compra (Recibido)'}
        </span>
      </td>
      <td class="py-2.5 px-3 font-bold text-slate-950">DTE ${d.dte_type} #${d.folio}</td>
      <td class="py-2.5 px-3 text-slate-600">${d.emission_date}</td>
      <td class="py-2.5 px-3 text-slate-900">
        <div class="font-medium">${isVenta ? d.razon_social_receptor : d.razon_social_emisor}</div>
        <div class="text-[10px] text-slate-500">${isVenta ? d.rut_receptor : d.rut_emisor}</div>
      </td>
      <td class="py-2.5 px-3 text-right font-medium text-slate-900">${formatCLP(d.net_amount)}</td>
      <td class="py-2.5 px-3 text-right text-slate-600">${formatCLP(d.iva_amount)}</td>
      <td class="py-2.5 px-3 text-right font-bold text-slate-950">${formatCLP(d.total_amount)}</td>
      <td class="py-2.5 px-3">
        <select onchange="handleAssignDteToFolder(${d.id}, this.value)" class="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs text-blue-700 font-semibold">
          <option value="">-- Sin Carpeta --</option>
          ${state.folders.map(f => `<option value="${f.folder_id}" ${d.folder_id === f.folder_id ? 'selected' : ''}>${f.code} - ${f.title.substring(0, 20)}...</option>`).join('')}
        </select>
      </td>
      <td class="py-2.5 px-3 text-center">
        ${typeof ppStatusCell === 'function' ? ppStatusCell(d) : `<span class="px-2 py-0.5 rounded text-[10px] font-bold ${d.is_reconciled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}">${d.is_reconciled ? 'Conciliado' : 'Pendiente'}</span>`}
      </td>
    `;
    tbody.appendChild(tr);
  });
  lucide.createIcons();
}

async function renderF29ClosingOptimization() {
  const container = document.getElementById('sii-f29-optimization-container');
  if (!container) return;
  const periodVal = document.getElementById('sii-period')?.value || '';
  let q = '';
  if (periodVal && periodVal.includes('-')) {
    const parts = periodVal.split('-');
    q = `?year=${parts[0]}&month=${parts[1]}`;
  }
  try {
    const res = await fetch('/api/sii/f29-closing-optimization' + q);
    if (!res.ok) return;
    const d = await res.json();

    const isDeficit = d.tax_gap > 0;
    const borderCls = isDeficit ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50';
    const statusBadge = isDeficit
      ? `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200"><svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Optimización Sugerida</span>`
      : `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"><svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Crédito a Favor</span>`;

    container.innerHTML = `
      <div class="border ${borderCls} rounded-xl p-5 shadow-lg space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <div class="flex items-center space-x-2">
            <span class="w-8 h-8 rounded-lg ${isDeficit ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'} flex items-center justify-center font-bold text-sm">
              ${isDeficit ? '<svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' : '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'}
            </span>
            <div>
              <h3 class="font-heading font-bold text-sm text-slate-950 flex items-center gap-2">
                <span>Semáforo Tributario de Cierre de Mes (Optimización F29)</span>
              </h3>
              <div class="text-xs text-slate-600 mt-0.5">
                Día <b>${d.current_day}</b> del mes · <b>${d.days_remaining_in_month} días restantes</b> para el cierre del período fiscal
              </div>
            </div>
          </div>
          <div>${statusBadge}</div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div class="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div class="text-slate-600">IVA Débito Acumulado (Ventas)</div>
            <div class="text-base font-bold text-blue-700 mt-0.5">${formatCLP(d.debito_fiscal)}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">Ventas Netas: ${formatCLP(d.sales_net)}</div>
          </div>
          <div class="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div class="text-slate-600">IVA Crédito Acumulado (Compras)</div>
            <div class="text-base font-bold text-rose-700 mt-0.5">${formatCLP(d.credito_fiscal)}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">Compras Netas: ${formatCLP(d.purchases_net)}</div>
          </div>
          <div class="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div class="text-slate-600">${isDeficit ? 'IVA Líquido a Pagar' : 'Remanente a Favor'}</div>
            <div class="text-base font-bold ${isDeficit ? 'text-amber-700' : 'text-emerald-700'} mt-0.5">
              ${formatCLP(Math.abs(d.tax_gap))}
            </div>
            <div class="text-[10px] text-slate-500 mt-0.5">PPM Proyectado: ${formatCLP(d.projected_f29_tax - (isDeficit ? d.tax_gap : 0))}</div>
          </div>
        </div>

        ${isDeficit ? `
          <div class="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-700 flex items-start gap-3">
            <span class="text-xl"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></span>
            <div class="space-y-1">
              <div class="font-bold text-amber-700">Estrategia de Cierre de Mes (Días 20 al 30):</div>
              <p class="text-slate-700">
                Para absorber la brecha tributaria de <b class="text-amber-700">${formatCLP(d.tax_gap)}</b> antes del corte mensual y evitar pagar este IVA al fisco, se sugiere adelantar compras operacionales, insumos, reposición de inventario o servicios con factura por un valor neto de aprox. <b class="text-emerald-700 font-mono text-sm">${formatCLP(d.suggested_net_purchases_to_balance)}</b>.
              </p>
            </div>
          </div>
        ` : `
          <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 text-xs text-emerald-700 flex items-start gap-3">
            <span class="text-xl"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
            <div>
              <div class="font-bold text-emerald-700">Situación Fiscal Protegida:</div>
              <p class="text-slate-700">
                El crédito fiscal acumulado en compras supera las ventas. Cuentas con un remanente neto de <b class="text-emerald-700">${formatCLP(Math.abs(d.tax_gap))}</b> que se transferirá íntegramente al siguiente período tributario sin generar desembolso de IVA.
              </p>
            </div>
          </div>
        `}
      </div>
    `;
    lucide.createIcons();
  } catch (e) {
    console.warn('Error cargando optimizacion F29:', e);
  }
}

async function handleAssignDteToFolder(dteId, folderId) {
  try {
    const res = await fetch('/api/sii/dtes/assign', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dte_id: dteId,
        folder_id: folderId ? parseInt(folderId) : null
      })
    });
    if (res.ok) {
      showToast('DTE clasificado a la Carpeta de Negocio');
      await renderFolders();
    }
  } catch (err) {
    showToast('Error asignando DTE', 'error');
  }
}

// La sincronización real con el SII vive en rcv.js (siiSyncView); ya no existen datos simulados.

// Emisión Directa de DTE (Factura Electrónica, Notas de Crédito, Guías de Despacho)
async function openEmitDteModal() {
  document.getElementById('emit-dte-form').reset();
  document.getElementById('emit-dte-date').value = new Date().toISOString().slice(0, 10);
  
  // Sugerir siguiente folio
  const maxFolio = state.dtes.filter(d => d.direction === 'EMITIDO').reduce((max, d) => Math.max(max, d.folio), 10522);
  document.getElementById('emit-dte-folio').value = maxFolio + 1;

  // Llenar selector de carpetas
  const folderSelect = document.getElementById('emit-dte-folder');
  folderSelect.innerHTML = '<option value="">-- Sin Carpeta --</option>';
  state.folders.forEach(f => {
    folderSelect.innerHTML += `<option value="${f.folder_id}">${f.code} - ${f.title}</option>`;
  });

  // Llenar selector de SKUs de inventario para vinculación de stock
  const skuSelect = document.getElementById('emit-dte-sku');
  if (skuSelect) {
    if (!state.products || !state.products.length) {
      try {
        const invRes = await fetch('/api/inventory/summary');
        if (invRes.ok) {
          const invData = await invRes.json();
          state.products = invData.productos || [];
        }
      } catch (e) { /* opcional */ }
    }
    skuSelect.innerHTML = '<option value="">— Sin movimiento de bodega —</option>';
    (state.products || []).forEach(p => {
      skuSelect.innerHTML += `<option value="${p.sku}">${p.sku} · ${p.name} (Stock disp: ${p.stock_disponible})</option>`;
    });
  }

  document.getElementById('emit-dte-modal').classList.remove('hidden');
}

function closeEmitDteModal() {
  document.getElementById('emit-dte-modal').classList.add('hidden');
}

function updateEmitDteTotals() {
  const neto = parseFloat(document.getElementById('emit-dte-neto').value) || 0;
  const iva = Math.round(neto * 0.19);
  const total = neto + iva;
  document.getElementById('emit-dte-iva').value = iva;
  document.getElementById('emit-dte-total').value = total;
}

async function handleEmitDte(e) {
  e.preventDefault();
  const form = document.getElementById('emit-dte-form');
  const neto = parseFloat(form.neto.value) || 0;
  const iva = parseFloat(form.iva.value) || 0;
  const total = parseFloat(form.total.value) || (neto + iva);
  const direction = form.direction ? form.direction.value : 'EMITIDO';
  const counterpartyRut = form.rut_receptor.value.trim();
  const counterpartyName = form.razon_social_receptor.value.trim();
  const compRut = state.currentCompany ? state.currentCompany.rut : '76.842.159-4';
  const compName = state.currentCompany ? state.currentCompany.razon_social : 'Andes Tech SpA';
  const skuVal = document.getElementById('emit-dte-sku')?.value || null;
  const qtyVal = parseFloat(document.getElementById('emit-dte-qty')?.value) || 1;

  const payload = {
    dte_type: parseInt(form.dte_type.value),
    folio: parseInt(form.folio.value),
    rut_emisor: direction === 'EMITIDO' ? compRut : counterpartyRut,
    razon_social_emisor: direction === 'EMITIDO' ? compName : counterpartyName,
    rut_receptor: direction === 'EMITIDO' ? counterpartyRut : compRut,
    razon_social_receptor: direction === 'EMITIDO' ? counterpartyName : compName,
    emission_date: form.emission_date.value,
    expiration_date: form.expiration_date.value || form.emission_date.value,
    net_amount: neto,
    exempt_amount: 0,
    iva_amount: iva,
    total_amount: total,
    direction: direction,
    status_sii: 'ACEPTADO',
    folder_id: form.folder_id.value ? parseInt(form.folder_id.value) : null,
    source: 'EMISION_DIRECTA',
    payment_method: form.payment_method ? form.payment_method.value : 'CREDITO_DIRECTO',
    sku: skuVal || null,
    quantity: skuVal ? qtyVal : null
  };

  try {
    const res = await fetch('/api/sii/dtes/emit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const rData = await res.json();
      showToast(rData.message || `DTE Folio #${payload.folio} registrado exitosamente`);
      closeEmitDteModal();
      await renderSII();
      await renderFolders();
      await renderInventory();
    } else {
      const errData = await res.json();
      showToast(errData.detail || 'Error al emitir DTE', 'error');
    }
  } catch (err) {
    showToast('Error de conexión con SII', 'error');
  }
}

async function renderSiiAnalytics() {
  const container = document.getElementById('sii-analytics-container');
  if (!container) return;
  const qMonth = typeof siiPeriodMonthQuery === 'function' ? siiPeriodMonthQuery() : '';
  try {
    const res = await fetch('/api/sii/analytics' + qMonth);
    if (!res.ok) return;
    const data = await res.json();
    const topClients = data.top_clients || [];
    const topSuppliers = data.top_suppliers || [];
    const alerts = data.alerts || data.sii_alerts || [];

    const alertsHtml = alerts.length
      ? alerts.map(a => {
          const lvl = a.level || a.severity || 'OK';
          const isHigh = lvl === 'CRITICA' || lvl === 'ALTA';
          const isMed = lvl === 'MEDIA';
          const cls = isHigh ? 'border-rose-200 bg-rose-50 text-rose-700' : (isMed ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700');
          return `<div class="rounded-xl border ${cls} p-3 text-xs space-y-1">
            <div class="font-bold flex items-center justify-between">
              <span>${isHigh ? '<svg class="w-3.5 h-3.5 inline text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' : (isMed ? '<svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' : '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>')} ${a.title}</span>
              <span class="text-[10px] px-2 py-0.5 rounded bg-slate-50 font-mono">${lvl}</span>
            </div>
            <p class="text-slate-700 leading-relaxed">${a.detail}</p>
          </div>`;
        }).join('')
      : '';

    const clientRows = topClients.length
      ? topClients.map((c, idx) => `
          <div class="flex items-center justify-between py-2 border-b border-slate-200 text-xs">
            <div class="truncate pr-2">
              <span class="text-blue-700 font-bold mr-1.5">#${idx + 1}</span>
              <span class="font-semibold text-slate-950">${c.name}</span>
              <span class="text-[10px] text-slate-500 font-mono ml-1">(${c.rut}) · ${c.doc_count || c.docs || 1} DTE</span>
            </div>
            <div class="font-bold text-emerald-700 whitespace-nowrap">${formatCLP(c.total_amount ?? c.total ?? 0)}</div>
          </div>`).join('')
      : '<div class="py-4 text-center text-xs text-slate-500">Sin facturas de venta emitidas en este período.</div>';

    const supplierRows = topSuppliers.length
      ? topSuppliers.map((s, idx) => `
          <div class="flex items-center justify-between py-2 border-b border-slate-200 text-xs">
            <div class="truncate pr-2">
              <span class="text-amber-700 font-bold mr-1.5">#${idx + 1}</span>
              <span class="font-semibold text-slate-950">${s.name}</span>
              <span class="text-[10px] text-slate-500 font-mono ml-1">(${s.rut}) · ${s.doc_count || s.docs || 1} DTE</span>
            </div>
            <div class="font-bold text-rose-700 whitespace-nowrap">${formatCLP(s.total_amount ?? s.total ?? 0)}</div>
          </div>`).join('')
      : '<div class="py-4 text-center text-xs text-slate-500">Sin facturas de compra recibidas en este período.</div>';

    container.innerHTML = `
      <div class="space-y-4">
        <!-- Alertas Preventivas SII & Ranking de Clientes y Proveedores -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div class="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
            <div class="flex items-center justify-between border-b border-slate-200 pb-2">
              <h4 class="font-heading font-bold text-xs text-slate-950 flex items-center gap-1.5">
                <i data-lucide="award" class="w-4 h-4 text-emerald-700"></i>
                <span>¿A quién le vendemos más? (Top Clientes)</span>
              </h4>
              <span class="text-[10px] text-slate-500">Ventas SII</span>
            </div>
            <div>${clientRows}</div>
          </div>

          <div class="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
            <div class="flex items-center justify-between border-b border-slate-200 pb-2">
              <h4 class="font-heading font-bold text-xs text-slate-950 flex items-center gap-1.5">
                <i data-lucide="truck" class="w-4 h-4 text-amber-700"></i>
                <span>¿A quién le compramos más? (Top Proveedores)</span>
              </h4>
              <span class="text-[10px] text-slate-500">Compras SII</span>
            </div>
            <div>${supplierRows}</div>
          </div>

          <div class="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
            <div class="flex items-center justify-between border-b border-slate-200 pb-2">
              <h4 class="font-heading font-bold text-xs text-slate-950 flex items-center gap-1.5">
                <i data-lucide="shield-alert" class="w-4 h-4 text-blue-700"></i>
                <span>Alertas Preventivas SII (Plazo 8 días & RCV)</span>
              </h4>
              <span class="text-[10px] text-slate-500">Cumplimiento</span>
            </div>
            <div class="space-y-2">${alertsHtml}</div>
          </div>
        </div>

        <!-- Modo Educativo: Contabilidad desde Cero para no contadores -->
        <details class="bg-gradient-to-r from-indigo-50 via-white to-white border border-indigo-200 rounded-xl p-4 text-xs group">
          <summary class="cursor-pointer font-heading font-bold text-sm text-indigo-700 flex items-center justify-between list-none">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px]"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg> Guía Interactiva</span>
              <span>Aprende Contabilidad desde Cero: ¿Cómo funcionan tus impuestos, el IVA y tus facturas en el SII?</span>
            </div>
            <span class="text-xs text-indigo-700 group-open:rotate-180 transition-transform">▼ Ver explicación paso a paso</span>
          </summary>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4 pt-3 border-t border-slate-200 text-slate-700">
            <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1">
              <div class="font-bold text-blue-700">1. IVA Débito vs IVA Crédito</div>
              <p class="text-[11px] text-slate-600 leading-relaxed">Cada vez que vendes con factura cobras un <b>19% de IVA Débito</b> que le pertenece al Fisco. Pero cada vez que compras insumos con factura a nombre de tu empresa acumulas <b>IVA Crédito</b> que descuenta peso a peso lo que debes pagar.</p>
            </div>
            <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1">
              <div class="font-bold text-emerald-700">2. Remanente y PPM (F29)</div>
              <p class="text-[11px] text-slate-600 leading-relaxed">Si compraste más de lo que vendiste en el mes, no pagas IVA y la diferencia queda guardada a tu favor (<b>Remanente</b>). El <b>PPM</b> es un ahorro obligatorio mensual (1% a 1.5% de tus ventas netas) para cubrir tu impuesto anual en abril (F22).</p>
            </div>
            <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1">
              <div class="font-bold text-amber-700">3. Regla de los 8 Días del SII</div>
              <p class="text-[11px] text-slate-600 leading-relaxed">Cuando un proveedor te emite una factura a crédito, tienes <b>8 días corridos</b> para aceptarla o reclamarla en el SII. Si pasa el día 8 sin reclamar, queda aceptada por ley y estás obligado a pagarla.</p>
            </div>
            <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1">
              <div class="font-bold text-purple-700">4. Carpetas, Pagos y Stock</div>
              <p class="text-[11px] text-slate-600 leading-relaxed">Asigna cada factura a su <b>Carpeta de Negocio</b> en la tabla inferior para calcular tu utilidad real, registra si se pagó al <b>Contado, Cheque o Crédito</b>, y vincula el SKU al emitir para llevar control exacto de bodega.</p>
            </div>
          </div>
        </details>
      </div>
    `;
    lucide.createIcons();
  } catch (e) {
    console.warn('Error cargando analitica SII:', e);
  }
}

// ============================================================================
// 6. MÓDULO INTEGRACIÓN BANCARIA Y CONCILIACIÓN INTELIGENTE
// ============================================================================
async function renderBanking() {
  try {
    const qAging = typeof getGlobalPeriodQuery === 'function' ? getGlobalPeriodQuery('month') : '';
    const [accounts, txs, suggestions, aging] = await Promise.all([
      fetch('/api/banking/accounts').then(r => r.json()),
      fetch('/api/banking/transactions').then(r => r.json()),
      fetch('/api/banking/reconciliation-suggestions').then(r => r.json()),
      fetch('/api/banking/aging-dashboard' + qAging).then(r => r.json())
    ]);

    state.transactions = txs;
    state.aging = aging;

    // Resumen de Cuentas
    const accountsContainer = document.getElementById('banking-accounts-cards');
    accountsContainer.innerHTML = '';
    accounts.forEach(a => {
      const card = document.createElement('div');
      card.className = 'bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between shadow';
      card.innerHTML = `
        <div class="flex items-center space-x-3">
          <div class="w-10 h-10 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center font-bold">
            <i data-lucide="landmark" class="w-5 h-5"></i>
          </div>
          <div>
            <h4 class="font-bold text-sm text-slate-950">${a.bank_name}</h4>
            <p class="text-xs text-slate-600">${a.account_type} • ${a.account_number}</p>
          </div>
        </div>
        <div class="text-right">
          <div class="text-xs text-slate-500">Saldo Disponible</div>
          <div class="text-base font-bold text-emerald-700">${formatCLP(a.balance)}</div>
        </div>
      `;
      accountsContainer.appendChild(card);
    });

    // Sugerencias de Conciliación Inteligente
    const suggContainer = document.getElementById('banking-suggestions-container');
    suggContainer.innerHTML = '';

    if (suggestions.length === 0) {
      suggContainer.innerHTML = `
        <div class="p-6 text-center text-slate-600 bg-white rounded-xl border border-slate-200">
          <i data-lucide="check-circle-2" class="w-8 h-8 text-emerald-700 mx-auto mb-2"></i>
          <p class="text-sm font-semibold text-slate-700">¡Al día! No hay cruces automáticos pendientes de conciliar.</p>
        </div>
      `;
    } else {
      suggestions.forEach(s => {
        const tx = s.transaction;
        const dte = s.dte;
        const card = document.createElement('div');
        card.className = 'bg-white border-2 border-blue-200 rounded-xl p-4 shadow-lg flex flex-col md:flex-row items-center justify-between gap-4';
        card.innerHTML = `
          <div class="space-y-1 w-full md:w-auto">
            <div class="flex items-center space-x-2">
              <span class="px-2 py-0.5 rounded text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                ${s.confidence}% Confianza Coincidencia
              </span>
              <span class="text-xs text-slate-600">${tx.transaction_date}</span>
            </div>
            <div class="text-sm font-semibold text-slate-950">
              Movimiento: <span class="text-blue-700">${tx.description}</span> (${tx.transaction_type === 'ABONO' ? '+' : '-'}${formatCLP(tx.amount)})
            </div>
            <div class="text-xs text-emerald-700 flex items-center space-x-1">
              <i data-lucide="link" class="w-3.5 h-3.5"></i>
              <span>Cruce Sugerido: DTE ${dte.dte_type} Folio #${dte.folio} • ${dte.direction === 'EMITIDO' ? dte.razon_social_receptor : dte.razon_social_emisor} (${formatCLP(dte.total_amount)})</span>
            </div>
            <p class="text-[11px] text-slate-600 italic">${s.reason}</p>
          </div>
          <button onclick="applySmartReconcile(${tx.id}, ${dte.id}, ${dte.folder_id || 'null'})" class="w-full md:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2 px-4 rounded-lg flex items-center justify-center space-x-1.5 whitespace-nowrap shadow-md transition-colors">
            <i data-lucide="check" class="w-4 h-4"></i>
            <span>Conciliar en 1 Clic</span>
          </button>
        `;
        suggContainer.appendChild(card);
      });
    }

    // Tabla de Cartola Bancaria
    const txTbody = document.getElementById('banking-transactions-tbody');
    txTbody.innerHTML = '';
    txs.forEach(t => {
      const isAbono = t.transaction_type === 'ABONO';
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-200 text-xs hover:bg-slate-100';
      tr.innerHTML = `
        <td class="py-2.5 px-3 text-slate-600">${t.transaction_date}</td>
        <td class="py-2.5 px-3 font-medium text-slate-900">${t.description}</td>
        <td class="py-2.5 px-3 text-slate-600">${t.bank_name}</td>
        <td class="py-2.5 px-3 text-right font-bold ${isAbono ? 'text-emerald-700' : 'text-rose-700'}">
          ${isAbono ? '+' : '-'}${formatCLP(t.amount)}
        </td>
        <td class="py-2.5 px-3 text-right text-slate-600">${formatCLP(t.balance)}</td>
        <td class="py-2.5 px-3 text-center">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${t.is_reconciled ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}">
            ${t.is_reconciled ? `Conciliado (DTE #${t.dte_folio || 'OK'})` : 'Pendiente'}
          </span>
        </td>
      `;
      txTbody.appendChild(tr);
    });

    // Renderizar Dashboard de Vencimientos CxC / CxP
    renderAgingSection(aging);

    // Renderizar Dinero Compacto, Cuadratura SII+Banco, Análisis de Gastos y Estrategias Mensuales
    await renderBankingIntelligentAnalysis();

    // Renderizar Control de Deudas Financieras (Prevención Mora y DICOM)
    await renderBankingDebts();

    lucide.createIcons();
  } catch (err) {
    console.error('Error renderizando bancos:', err);
  }
}

async function renderBankingIntelligentAnalysis() {
  const container = document.getElementById('banking-intelligent-analysis-container');
  if (!container) return;
  const qMonth = typeof getGlobalPeriodQuery === 'function' ? getGlobalPeriodQuery('month') : '';
  try {
    const res = await fetch('/api/banking/intelligent-analysis' + qMonth);
    if (!res.ok) return;
    const d = await res.json();
    const dc = d.compact_money || d.dinero_compacto || {};
    const breakdown = d.expense_breakdown || [];
    const strategies = d.strategies || [];
    const totalExpenses = breakdown.reduce((acc, b) => acc + (b.amount || 0), 0);

    const expHtml = breakdown.length
      ? breakdown.map(b => {
          const pct = b.share_pct ?? b.pct ?? 0;
          return `
          <div class="space-y-1 text-xs">
            <div class="flex items-center justify-between">
              <span class="text-slate-900 font-semibold">${b.label || b.category} <span class="text-[10px] text-slate-500">(${b.count} mov.)</span></span>
              <span class="font-bold text-rose-700">${formatCLP(b.amount)} <span class="text-[10px] text-slate-600">(${pct}%)</span></span>
            </div>
            <div class="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div class="h-full bg-gradient-to-r from-blue-500 to-indigo-500" style="width:${Math.min(100, pct)}%"></div>
            </div>
          </div>`;
        }).join('')
      : '<div class="py-4 text-center text-xs text-slate-500">Sin cargos bancarios ni egresos registrados en este período.</div>';

    const stratHtml = strategies.map(s => {
      const p = s.priority || s.type || 'OK';
      const isCrit = p === 'CRITICA' || p === 'ALERTA';
      const isHigh = p === 'ALTA' || p === 'ACCION' || p === 'MEDIA';
      const cls = isCrit
        ? 'border-rose-200 bg-rose-50 text-rose-700'
        : (isHigh ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700');
      return `<div class="rounded-xl border ${cls} p-3 text-xs space-y-1">
        <div class="font-bold">${isCrit ? '<svg class="w-3.5 h-3.5 inline text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' : (isHigh ? '<svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' : '<svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5"/></svg>')} ${s.title}</div>
        <p class="text-slate-700 leading-relaxed">${s.advice || s.detail || ''}</p>
      </div>`;
    }).join('');

    container.innerHTML = `
      <div class="bg-gradient-to-br from-slate-50 via-white to-white border border-slate-200 rounded-2xl p-5 shadow-xl space-y-5">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <div class="flex items-center space-x-2.5">
            <span class="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center font-bold">
              <i data-lucide="wallet" class="w-5 h-5"></i>
            </span>
            <div>
              <h3 class="font-heading font-bold text-base text-slate-950 flex items-center gap-2">
                <span>Dinero Compacto & Cuadratura Exacta 100% SII + Banco</span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">Inteligencia Financiera</span>
              </h3>
              <p class="text-xs text-slate-600">Posición real de caja, facturas pagadas vs pendientes por cobrar/pagar con montos exactos y estrategias mensuales.</p>
            </div>
          </div>
          <div class="text-right">
            <span class="text-[10px] uppercase font-bold text-slate-600">Liquidez Neta Proyectada (Fin de Mes)</span>
            <div class="text-xl font-heading font-extrabold ${dc.net_projected_liquidity >= 0 ? 'text-emerald-700' : 'text-rose-700'}">${formatCLP(dc.net_projected_liquidity || 0)}</div>
          </div>
        </div>

        <!-- 5 Indicadores de Dinero Compacto y Cuadratura SII + Banco -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          <div class="bg-slate-50 p-3.5 rounded-xl border border-emerald-200">
            <div class="text-slate-600 font-semibold">1. Caja Real en Banco</div>
            <div class="text-lg font-bold text-emerald-700 mt-1">${formatCLP(dc.cash_in_bank || 0)}</div>
            <div class="text-[10px] text-slate-500 mt-1">Saldo disponible en cuentas</div>
          </div>
          <div class="bg-slate-50 p-3.5 rounded-xl border border-blue-200">
            <div class="text-slate-600 font-semibold">2. Facturas Ventas (SII)</div>
            <div class="text-sm font-bold text-blue-700 mt-1">Por cobrar: ${formatCLP(dc.ventas_pendientes || 0)}</div>
            <div class="text-[10px] text-emerald-700 mt-1">Ya cobradas: ${formatCLP(dc.ventas_pagadas || 0)}</div>
          </div>
          <div class="bg-slate-50 p-3.5 rounded-xl border border-rose-200">
            <div class="text-slate-600 font-semibold">3. Facturas Compras (SII)</div>
            <div class="text-sm font-bold text-rose-700 mt-1">Falta pagar: ${formatCLP(dc.compras_pendientes || 0)}</div>
            <div class="text-[10px] text-emerald-700 mt-1">Ya pagadas: ${formatCLP(dc.compras_pagadas || 0)}</div>
          </div>
          <div class="bg-slate-50 p-3.5 rounded-xl border border-amber-200">
            <div class="text-slate-600 font-semibold">4. Cuotas Deuda Financiera</div>
            <div class="text-lg font-bold text-amber-700 mt-1">-${formatCLP(dc.monthly_debt_installments || 0)}</div>
            <div class="text-[10px] text-slate-500 mt-1">Compromisos bancarios del mes</div>
          </div>
          <div class="bg-slate-50 p-3.5 rounded-xl border border-indigo-200">
            <div class="text-slate-600 font-semibold">5. Dinero Compacto Libre</div>
            <div class="text-lg font-bold ${dc.net_projected_liquidity >= 0 ? 'text-emerald-700' : 'text-rose-700'} mt-1">${formatCLP(dc.net_projected_liquidity || 0)}</div>
            <div class="text-[10px] text-slate-500 mt-1">Caja + CxC - CxP - Cuotas</div>
          </div>
        </div>

        <!-- Clasificación Inteligente de Movimientos y Estrategias Mensuales -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1">
          <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <div class="flex items-center justify-between">
              <h4 class="font-heading font-bold text-xs text-slate-950 flex items-center gap-1.5">
                <i data-lucide="bar-chart-3" class="w-4 h-4 text-blue-700"></i>
                <span>Detección Inteligente: ¿A qué corresponde cada movimiento de gasto?</span>
              </h4>
              <span class="text-[11px] font-bold text-rose-700">Total Egresos: ${formatCLP(totalExpenses)}</span>
            </div>
            <div class="space-y-2.5">${expHtml}</div>
          </div>

          <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <h4 class="font-heading font-bold text-xs text-slate-950 flex items-center gap-1.5">
              <i data-lucide="compass" class="w-4 h-4 text-emerald-700"></i>
              <span>Estrategias Mensuales y Consejos Financieros para el Cliente</span>
            </h4>
            <div class="space-y-2">${stratHtml}</div>
          </div>
        </div>
      </div>
    `;
    lucide.createIcons();
  } catch (e) {
    console.warn('Error cargando analisis inteligente bancario:', e);
  }
}

async function renderBankingDebts() {
  const container = document.getElementById('banking-debts-container');
  if (!container) return;
  try {
    const res = await fetch('/api/banking/debts');
    if (!res.ok) return;
    const data = await res.json();
    const debts = data.items || data.debts || [];
    const sum = data.summary || {};

    const rowsHtml = debts.length
      ? debts.map(d => {
          const isPaid = d.status === 'PAGADO_MES' || d.status === 'PAGADO';
          const isAlert = d.alert_level === 'CRITICA' || d.alert_level === 'ALTA';
          const badge = isPaid
            ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700">Cuota mes pagada</span>'
            : (isAlert
                ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200"><svg class="w-3.5 h-3.5 inline text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> ${d.alert_label || 'Próximo a vencer'}</span>`
                : `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700">${d.alert_label || `Vence día ${d.due_day}`}</span>`);
          return `<tr class="border-b border-slate-200 text-xs hover:bg-slate-200">
            <td class="py-2.5 px-3 font-bold text-slate-950">${d.entity_name || d.institution}</td>
            <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold">${d.debt_type}</span> <span class="text-slate-900 ml-1">${d.description || d.title || ''}</span></td>
            <td class="py-2.5 px-3 text-right text-slate-700">${formatCLP(d.used_amount ?? d.remaining_amount ?? 0)} <span class="text-[10px] text-slate-500">/ ${formatCLP(d.total_limit ?? d.total_amount ?? 0)}</span></td>
            <td class="py-2.5 px-3 text-right font-bold text-amber-700">${formatCLP(d.monthly_installment ?? d.monthly_payment ?? 0)}</td>
            <td class="py-2.5 px-3 text-center text-slate-700">${d.interest_rate_pct ?? d.interest_rate ?? 0}%</td>
            <td class="py-2.5 px-3 text-center">${badge}</td>
            <td class="py-2.5 px-3 text-right space-x-1.5 whitespace-nowrap">
              ${!isPaid ? `<button onclick="payFinancialDebtMonth(${d.id})" class="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px]"><svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Pagar Cuota</button>` : ''}
              <button onclick="deleteFinancialDebt(${d.id})" class="px-2 py-1 rounded bg-slate-100 hover:bg-rose-100 text-slate-600 hover:text-rose-700 text-[11px]"><svg class="w-3.5 h-3.5 inline text-zinc-400 hover:text-rose-600 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="7" class="py-6 text-center text-xs text-slate-500">No hay deudas financieras registradas. Agrega tarjetas de crédito, créditos comerciales, avances o leasing para controlar sus cuotas y evitar caer en mora o DICOM.</td></tr>`;

    container.innerHTML = `
      <div class="bg-white border border-slate-200 rounded-xl p-5 shadow space-y-4">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div class="flex items-center space-x-2.5">
            <span class="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
              <i data-lucide="shield-check" class="w-4 h-4"></i>
            </span>
            <div>
              <h3 class="font-heading font-bold text-sm text-slate-950">Control de Deudas Financieras & Escudo Anti-Mora / Anti-DICOM</h3>
              <p class="text-xs text-slate-600">Tarjetas de crédito, préstamos comerciales, avances en efectivo, líneas de sobregiro y leasing de cualquier entidad.</p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <div class="text-right text-xs">
              <span class="text-slate-600">Carga Mensual Cuotas:</span> <b class="text-amber-700">${formatCLP(sum.total_monthly_installment || 0)}</b>
              · <span class="text-slate-600">Saldo Deuda Total:</span> <b class="text-rose-700">${formatCLP(sum.total_debt || 0)}</b>
            </div>
            <button onclick="openNewDebtModal()" class="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow flex items-center gap-1.5">
              <i data-lucide="plus-circle" class="w-3.5 h-3.5"></i>
              <span>+ Registrar Obligación Financiera</span>
            </button>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead class="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-600 font-semibold tracking-wider">
              <tr>
                <th class="py-2.5 px-3">Entidad / Banco</th>
                <th class="py-2.5 px-3">Tipo & Descripción</th>
                <th class="py-2.5 px-3 text-right">Saldo Utilizado / Cupo Total</th>
                <th class="py-2.5 px-3 text-right">Cuota Mensual</th>
                <th class="py-2.5 px-3 text-center">Tasa %</th>
                <th class="py-2.5 px-3 text-center">Estado / Alerta DICOM</th>
                <th class="py-2.5 px-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    `;
    lucide.createIcons();
  } catch (e) {
    console.warn('Error cargando deudas financieras:', e);
  }
}

function openNewDebtModal() {
  pfModal('Registrar Deuda u Obligación Financiera (Prevención DICOM)', `
    <form onsubmit="saveFinancialDebt(event)" class="space-y-3 text-xs">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-slate-600 mb-1">Entidad Financiera / Banco *</label>
          <input id="debt-inst" required placeholder="Ej: Banco de Chile, Santander, CMR..." class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
        </div>
        <div>
          <label class="block text-slate-600 mb-1">Tipo de Deuda *</label>
          <select id="debt-type" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950 font-semibold">
            <option value="CREDITO_COMERCIAL">Crédito Comercial / FOGAPE</option>
            <option value="TARJETA_CREDITO">Tarjeta de Crédito Empresarial</option>
            <option value="AVANCE">Avance en Efectivo / Súper Avance</option>
            <option value="LINEA_CREDITO">Línea de Crédito / Sobregiro</option>
            <option value="LEASING_FACTORING">Leasing / Factoring</option>
          </select>
        </div>
      </div>
      <div>
        <label class="block text-slate-600 mb-1">Nombre / Glosa de la Obligación *</label>
        <input id="debt-title" required placeholder="Ej: Crédito Capital de Trabajo N° 4412" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div>
          <label class="block text-slate-600 mb-1">Cupo o Monto Original ($)</label>
          <input id="debt-total" type="number" required placeholder="15000000" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
        </div>
        <div>
          <label class="block text-slate-600 mb-1">Saldo Por Pagar ($)</label>
          <input id="debt-rem" type="number" required placeholder="12500000" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
        </div>
        <div>
          <label class="block text-slate-600 mb-1">Valor Cuota Mensual ($)</label>
          <input id="debt-monthly" type="number" required placeholder="680000" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-amber-700 font-bold">
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-slate-600 mb-1">Tasa Mensual (%)</label>
          <input id="debt-rate" type="number" step="0.01" value="1.2" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
        </div>
        <div>
          <label class="block text-slate-600 mb-1">Día Vencimiento Mes</label>
          <input id="debt-due-day" type="number" min="1" max="28" value="5" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-emerald-700 font-bold">
        </div>
      </div>
      <div class="flex justify-end gap-2 pt-3 border-t border-slate-200">
        <button type="button" onclick="closePfModal()" class="px-3.5 py-1.5 rounded-lg bg-slate-100 text-slate-700">Cancelar</button>
        <button type="submit" class="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold">Guardar Obligación</button>
      </div>
    </form>
  `);
}

async function saveFinancialDebt(e) {
  e.preventDefault();
  const payload = {
    entity_name: document.getElementById('debt-inst').value.trim(),
    debt_type: document.getElementById('debt-type').value,
    description: document.getElementById('debt-title').value.trim(),
    total_limit: parseFloat(document.getElementById('debt-total').value) || 0,
    used_amount: parseFloat(document.getElementById('debt-rem').value) || 0,
    monthly_installment: parseFloat(document.getElementById('debt-monthly').value) || 0,
    interest_rate_pct: parseFloat(document.getElementById('debt-rate').value) || 0,
    due_day: parseInt(document.getElementById('debt-due-day').value) || 5
  };
  try {
    const res = await fetch('/api/banking/debts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      closePfModal();
      showToast('Obligación financiera registrada con alertas preventivas');
      await renderBanking();
    }
  } catch (err) {
    showToast('Error guardando obligación financiera', 'error');
  }
}

async function payFinancialDebtMonth(debtId) {
  try {
    const res = await fetch(`/api/banking/debts/${debtId}/pay-month`, { method: 'PUT' });
    if (res.ok) {
      const d = await res.json();
      showToast(d.message || 'Cuota pagada');
      await renderBanking();
    }
  } catch (err) {
    showToast('Error registrando pago de cuota', 'error');
  }
}

async function deleteFinancialDebt(debtId) {
  if (!confirm('¿Eliminar este registro de deuda financiera?')) return;
  try {
    const res = await fetch(`/api/banking/debts/${debtId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Registro eliminado');
      await renderBanking();
    }
  } catch (err) {
    showToast('Error eliminando registro', 'error');
  }
}

async function applySmartReconcile(txId, dteId, folderId) {
  try {
    const res = await fetch('/api/banking/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transaction_id: txId,
        dte_id: dteId,
        folder_id: folderId
      })
    });
    if (res.ok) {
      showToast('Movimiento bancario y DTE conciliados con éxito');
      await renderBanking();
      await renderFolders();
    } else {
      showToast('Error al conciliar', 'error');
    }
  } catch (err) {
    showToast('Error de conexión', 'error');
  }
}

function renderAgingSection(aging) {
  const cxc = aging.cxc;
  const cxp = aging.cxp;

  document.getElementById('aging-cxc-total').textContent = formatCLP(cxc.total_monto);
  document.getElementById('aging-cxc-aldia').textContent = formatCLP(cxc.al_dia);
  document.getElementById('aging-cxc-7d').textContent = formatCLP(cxc.por_vencer_7d);
  document.getElementById('aging-cxc-30d').textContent = formatCLP(cxc.vencidas_1_30);
  document.getElementById('aging-cxc-60d').textContent = formatCLP(cxc.vencidas_31_60 + cxc.vencidas_mas_60);

  document.getElementById('aging-cxp-total').textContent = formatCLP(cxp.total_monto);
  document.getElementById('aging-cxp-aldia').textContent = formatCLP(cxp.al_dia);
  document.getElementById('aging-cxp-7d').textContent = formatCLP(cxp.por_vencer_7d);
  document.getElementById('aging-cxp-30d').textContent = formatCLP(cxp.vencidas_1_30);
  document.getElementById('aging-cxp-60d').textContent = formatCLP(cxp.vencidas_31_60 + cxp.vencidas_mas_60);
}

// ============================================================================
// 7. MÓDULO CONTROL DE INVENTARIO Y STOCK AUTOMATIZADO
// ============================================================================
async function renderInventory() {
  try {
    const res = await fetch('/api/inventory/summary');
    const data = await res.json();
    state.products = data.productos;

    document.getElementById('inv-total-articulos').textContent = data.total_articulos;
    document.getElementById('inv-unidades-fisicas').textContent = data.total_unidades_fisicas;
    document.getElementById('inv-unidades-reservadas').textContent = data.total_unidades_reservadas;
    document.getElementById('inv-unidades-libres').textContent = data.total_unidades_libres;

    const tbody = document.getElementById('inventory-table-tbody');
    tbody.innerHTML = '';

    data.productos.forEach(p => {
      const tr = document.createElement('tr');
      tr.className = `border-b border-slate-200 text-xs hover:bg-slate-50 ${p.is_critico ? 'bg-rose-50' : ''}`;
      tr.innerHTML = `
        <td class="py-2.5 px-3 font-mono font-bold text-blue-700">${p.sku}</td>
        <td class="py-2.5 px-3 font-medium text-slate-950">${p.name}</td>
        <td class="py-2.5 px-3 text-slate-600">${p.category}</td>
        <td class="py-2.5 px-3 text-right font-medium text-amber-700">${formatCLP(p.unit_cost)}</td>
        <td class="py-2.5 px-3 text-right font-bold text-slate-950">${formatCLP(p.unit_price)}</td>
        <td class="py-2.5 px-3 text-center font-bold text-slate-900">${p.stock_physical}</td>
        <td class="py-2.5 px-3 text-center text-amber-700 font-semibold">${p.stock_reserved}</td>
        <td class="py-2.5 px-3 text-center font-bold text-emerald-700">${p.stock_disponible}</td>
        <td class="py-2.5 px-3 text-center text-slate-500">${p.stock_min}</td>
        <td class="py-2.5 px-3 text-center">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${p.is_critico ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700'}">
            ${p.is_critico ? 'Stock Crítico' : 'Normal'}
          </span>
        </td>
      `;
      tbody.appendChild(tr);
    });
    lucide.createIcons();
  } catch (err) {
    console.error('Error renderizando inventario:', err);
  }
}

function openNewProductModal() {
  document.getElementById('new-product-form').reset();
  document.getElementById('new-product-modal').classList.remove('hidden');
}

function closeNewProductModal() {
  document.getElementById('new-product-modal').classList.add('hidden');
}

async function handleCreateProduct(e) {
  e.preventDefault();
  const form = document.getElementById('new-product-form');
  const payload = {
    name: form.name.value.trim(),
    description: form.description.value.trim(),
    category: form.category.value.trim() || 'General',
    unit: form.unit.value.trim() || 'UND',
    unit_cost: parseFloat(form.unit_cost.value) || 0,
    unit_price: parseFloat(form.unit_price.value) || 0,
    stock_physical: parseFloat(form.stock_physical.value) || 0,
    stock_reserved: 0,
    stock_min: parseFloat(form.stock_min.value) || 5,
    is_active: 1
  };

  try {
    const res = await fetch('/api/inventory/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const data = await res.json();
      showToast(`Producto creado exitosamente con SKU automático: ${data.sku}`);
      closeNewProductModal();
      await renderInventory();
    }
  } catch (err) {
    showToast('Error al crear producto', 'error');
  }
}

// ============================================================================
// SUB-PESTAÑAS DE INVENTARIO (6A: STOCK SKU + SII vs 6B: CREADOR DE CATÁLOGOS)
// ============================================================================
function switchInventorySubTab(sub) {
  const stockPanel = document.getElementById('inv-subpanel-stock');
  const catPanel = document.getElementById('inv-subpanel-catalog');
  const stockBtn = document.getElementById('inv-subtab-stock');
  const catBtn = document.getElementById('inv-subtab-catalog');
  if (!stockPanel || !catPanel) return;

  const activeCls = 'px-3.5 py-2 rounded-lg font-bold bg-blue-600 text-white flex items-center space-x-1.5 transition-all';
  const inactiveCls = 'px-3.5 py-2 rounded-lg font-semibold text-slate-600 hover:text-slate-900 flex items-center space-x-1.5 transition-all';

  if (sub === 'catalog') {
    stockPanel.classList.add('hidden');
    catPanel.classList.remove('hidden');
    if (catBtn) catBtn.className = activeCls;
    if (stockBtn) stockBtn.className = inactiveCls;
    if (typeof renderCatalog === 'function') renderCatalog();
  } else {
    catPanel.classList.add('hidden');
    stockPanel.classList.remove('hidden');
    if (stockBtn) stockBtn.className = activeCls;
    if (catBtn) catBtn.className = inactiveCls;
  }
  lucide.createIcons();
}

async function syncInventoryFromSii() {
  showToast('Sincronizando SKUs y stock desde facturas de compra SII e ítems de carpetas…', 'info');
  try {
    const res = await fetch('/api/inventory/sync-from-sii', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || 'Stock sincronizado con facturas SII');
      await renderInventory();
    } else {
      showToast(data.detail || 'Error al sincronizar stock', 'error');
    }
  } catch (err) {
    showToast('Error de conexión al sincronizar stock', 'error');
  }
}

// ============================================================================
// CARGAR CARPETA DE NEGOCIO EJEMPLO (D:\FINANZIA\documentos ejemplos - REX N° 311)
// ============================================================================
async function wsLoadSampleBundle() {
  showToast('Cargando y procesando los 6 documentos reales (REX N° 311, Anexos 4 y 5, Certificados, Solicitud de Compra)…', 'info');
  try {
    const res = await fetch('/api/workspace/load-sample-bundle', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.detail || 'Error al cargar carpeta ejemplo', 'error');
      return;
    }
    showToast(data.message || 'Carpeta ejemplo creada y en análisis con IA');
    await renderFolders();
    if (data.folder_id && typeof openWorkspace === 'function') {
      await openWorkspace(data.folder_id);
    }
  } catch (err) {
    showToast('Error cargando carpeta de ejemplo', 'error');
  }
}

// ============================================================================
// 8. CONFIGURACIÓN MULTI-EMPRESA (ORGANIZADA POR SUB-PESTAÑAS)
// ============================================================================
function switchCompaniesSubTab(sub) {
  const tabs = ['empresas', 'integraciones', 'boveda', 'ia'];
  const activeCls = 'px-3 py-1.5 rounded-lg font-bold bg-blue-600 text-white transition-all';
  const inactiveCls = 'px-3 py-1.5 rounded-lg font-semibold text-slate-600 hover:text-slate-900 transition-all';

  tabs.forEach(t => {
    const panel = document.getElementById(`comp-subpanel-${t}`);
    const btn = document.getElementById(`comp-subtab-${t}`);
    if (panel) panel.classList.toggle('hidden', t !== sub);
    if (btn) btn.className = t === sub ? activeCls : inactiveCls;
  });
  lucide.createIcons();
}

async function renderCompaniesConfig() {
  try {
    const res = await fetch('/api/companies/');
    state.companies = await res.json();
    const container = document.getElementById('companies-list-container');
    container.innerHTML = '';

    const activeId = (window.pf && pf.auth && pf.auth.companyId) || (state.currentCompany && state.currentCompany.id);

    state.companies.forEach(c => {
      const isAct = c.id === activeId || (!activeId && c.is_default === 1);
      const card = document.createElement('div');
      card.className = `bg-white border rounded-xl p-5 ${isAct ? 'border-blue-500 ring-1 ring-blue-500/20' : 'border-slate-200'} shadow-sm space-y-3`;
      card.innerHTML = `
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <span class="w-8 h-8 rounded-lg ${isAct ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700'} flex items-center justify-center font-bold">
              <i data-lucide="building-2" class="w-4 h-4"></i>
            </span>
            <div>
              <h3 class="font-bold text-base text-slate-950">${c.razon_social}</h3>
              <span class="text-[11px] font-mono text-slate-600">${c.rut}</span>
            </div>
          </div>
          ${isAct ? '<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">● Empresa en Operación</span>' : `<button onclick="setDefaultCompany(${c.id})" class="px-3 py-1 rounded-lg bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white text-xs font-bold border border-blue-200 transition-colors">⇄ Operar con esta empresa</button>`}
        </div>
        <div class="space-y-1 text-xs text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200">
          <div><span class="text-slate-500">Giro:</span> ${c.giro || 'Servicios y Comercialización'}</div>
          <div><span class="text-slate-500">Dirección:</span> ${c.direccion || '—'}, ${c.comuna || ''}</div>
          <div><span class="text-slate-500">Tasa PPM F29:</span> <span class="font-bold text-amber-700">${c.ppm_rate}% sobre venta neta</span></div>
        </div>
        <div class="flex flex-wrap gap-2 pt-1 text-xs">
          <button onclick="setDefaultCompany(${c.id}, 'integraciones')" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 font-semibold"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><rect width="10" height="9" x="7" y="8" rx="2"/></svg> SII & Banco</button>
          <button onclick="setDefaultCompany(${c.id}, 'boveda')" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 font-semibold"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Subir Docs a Bóveda</button>
          <button onclick="setDefaultCompany(${c.id}, 'ia')" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 font-semibold"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 2 4 4-12 12H6v-4L18 2z"/><path d="m14 6 4 4"/></svg> Firma & IA</button>
        </div>
      `;
      container.appendChild(card);
    });

    // Bóveda Central de Documentación Laboral y Legal Vigente
    await renderLegalVault();

    lucide.createIcons();
  } catch (err) {
    console.error('Error renderizando empresas:', err);
  }
}

async function setDefaultCompany(compId, subTabAfter) {
  try {
    await fetch(`/api/companies/${compId}/set-default`, { method: 'POST' });
    await fetch('/api/auth/select-company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: compId })
    });
    if (window.pf && pf.auth) pf.auth.companyId = compId;
    showToast('Empresa activa cambiada exitosamente');
    await loadCompanies();
    await renderCompaniesConfig();
    if (subTabAfter) switchCompaniesSubTab(subTabAfter);
  } catch (err) {
    showToast('Error actualizando empresa', 'error');
  }
}

// ----------------------------------------------------------------------------
// BÓVEDA CENTRAL DE DOCUMENTACIÓN LABORAL Y LEGAL VIGENTE
// ----------------------------------------------------------------------------
async function renderLegalVault() {
  const container = document.getElementById('legal-vault-container');
  if (!container) return;
  try {
    const res = await fetch('/api/companies/legal-vault');
    if (!res.ok) return;
    const docs = await res.json();

    const typeIcons = {
      F30: '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
      HABILIDAD: '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="22" x2="22" y2="22"/><line x1="12" y1="2" x2="2" y2="7"/><line x1="12" y1="2" x2="22" y2="7"/><line x1="6" y1="12" x2="6" y2="18"/><line x1="10" y1="12" x2="10" y2="18"/><line x1="14" y1="12" x2="14" y2="18"/><line x1="18" y1="12" x2="18" y2="18"/></svg>',
      VIGENCIA: '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>',
      ESTATUTOS: '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h18"/></svg>',
      PATENTE: '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="9" y1="22" x2="9" y2="22.01"/><line x1="15" y1="22" x2="15" y2="22.01"/><line x1="8" y1="6" x2="8" y2="6.01"/><line x1="16" y1="6" x2="16" y2="6.01"/><line x1="8" y1="10" x2="8" y2="10.01"/><line x1="16" y1="10" x2="16" y2="10.01"/><line x1="8" y1="14" x2="8" y2="14.01"/><line x1="16" y1="14" x2="16" y2="14.01"/></svg>',
      OTRO: '<svg class="w-3.5 h-3.5 inline text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>'
    };

    const typeLabels = {
      F30: 'Certificado F30 / F30-1 (Laboral y Previsional)',
      HABILIDAD: 'Certificado de Habilidad ChileCompra',
      VIGENCIA: 'Certificado de Vigencia de Poderes',
      ESTATUTOS: 'Estatutos Sociales / Constitución',
      PATENTE: 'Patente Municipal al Día',
      OTRO: 'Otro Antecedente Legal'
    };

    let rowsHtml = '';
    if (!docs || docs.length === 0) {
      rowsHtml = `<tr><td colspan="5" class="py-6 text-center text-xs text-slate-500">No hay documentos en la Bóveda Legal. Sube los certificados oficiales de la empresa para sincronizarlos automáticamente en todas tus licitaciones.</td></tr>`;
    } else {
      rowsHtml = docs.map(d => {
        let badge = '';
        if (d.status === 'PERMANENTE') badge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">Permanente</span>';
        else if (d.status === 'VIGENTE') badge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Vigente (${d.days_left} d)</span>`;
        else if (d.status === 'POR_VENCER') badge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Por vencer (${d.days_left} d)</span>`;
        else badge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">Vencido</span>`;

        return `
          <tr class="border-b border-slate-200 hover:bg-slate-200 text-xs">
            <td class="py-2.5 px-3">
              <span class="text-base mr-1.5">${typeIcons[d.doc_type] || '<svg class="w-3.5 h-3.5 inline text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>'}</span>
              <span class="font-bold text-slate-900">${typeLabels[d.doc_type] || d.doc_type}</span>
            </td>
            <td class="py-2.5 px-3 font-medium text-slate-700">${(d.title || d.original_filename || '').replace(/</g, '&lt;')}</td>
            <td class="py-2.5 px-3 text-slate-600">
              ${d.issue_date ? `Emisión: ${d.issue_date}` : ''}
              ${d.expiration_date ? `<br><span class="${d.days_left <= 15 ? 'text-amber-700 font-semibold' : ''}">Vence: ${d.expiration_date}</span>` : ''}
            </td>
            <td class="py-2.5 px-3 text-center">${badge}</td>
            <td class="py-2.5 px-3 text-right space-x-2">
              <a href="/api/companies/legal-vault/${d.id}/download" target="_blank" class="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-blue-700 hover:text-blue-700 font-semibold inline-flex items-center gap-1">
                <span>⬇️</span> Descargar
              </a>
              <button onclick="deleteLegalVaultDoc(${d.id})" class="px-2 py-1 rounded hover:bg-rose-100 text-slate-500 hover:text-rose-700">
                <svg class="w-3.5 h-3.5 inline text-zinc-400 hover:text-rose-600 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }

    container.innerHTML = `
      <div class="bg-white border border-slate-200 rounded-xl p-5 shadow-lg space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div class="flex items-center space-x-2">
            <span class="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center font-bold text-sm">
              <svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="22" x2="22" y2="22"/><line x1="12" y1="2" x2="2" y2="7"/><line x1="12" y1="2" x2="22" y2="7"/><line x1="6" y1="12" x2="6" y2="18"/><line x1="10" y1="12" x2="10" y2="18"/><line x1="14" y1="12" x2="14" y2="18"/><line x1="18" y1="12" x2="18" y2="18"/></svg>
            </span>
            <div>
              <h3 class="font-heading font-bold text-sm text-slate-950">Bóveda Central de Documentación Laboral y Legal Vigente</h3>
              <p class="text-xs text-slate-600 mt-0.5">
                Certificados y antecedentes de la empresa. Se sincronizan universalmente con el checklist de todas tus licitaciones activas.
              </p>
            </div>
          </div>
          <div>
            <button onclick="openUploadVaultModal()" class="px-3.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold flex items-center gap-1.5 shadow">
              <span>+</span> Subir Documento a Bóveda
            </button>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead class="text-[10px] uppercase text-slate-600 border-b border-slate-200 bg-slate-50">
              <tr>
                <th class="py-2 px-3">Tipo de Certificado</th>
                <th class="py-2 px-3">Título / Archivo</th>
                <th class="py-2 px-3">Fechas</th>
                <th class="py-2 px-3 text-center">Estado de Vigencia</th>
                <th class="py-2 px-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
    lucide.createIcons();
  } catch (err) {
    console.warn('Error renderizando boveda legal:', err);
  }
}

function openUploadVaultModal() {
  const html = `
    <form id="vault-upload-form" onsubmit="handleUploadVaultDoc(event)" class="space-y-4 text-xs">
      <div>
        <label class="block font-semibold text-slate-700 mb-1">Tipo de Documento / Certificado *</label>
        <select id="vault-type" required class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
          <option value="F30">Certificado F30 / F30-1 (Antecedentes Laborales y Previsionales)</option>
          <option value="HABILIDAD">Certificado de Habilidad para Contratar (ChileCompra)</option>
          <option value="VIGENCIA">Certificado de Vigencia de Poderes / Persona Jurídica</option>
          <option value="ESTATUTOS">Estatutos de la Sociedad / Escritura de Constitución</option>
          <option value="PATENTE">Patente Municipal al Día</option>
          <option value="OTRO">Otro Documento Legal de Respaldo</option>
        </select>
      </div>
      <div>
        <label class="block font-semibold text-slate-700 mb-1">Título Descriptivo *</label>
        <input id="vault-title" type="text" required placeholder="Ej: Certificado F30 Octubre 2026" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block font-semibold text-slate-700 mb-1">Fecha de Emisión</label>
          <input id="vault-issue-date" type="date" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
        </div>
        <div>
          <label class="block font-semibold text-slate-700 mb-1">Fecha de Vencimiento</label>
          <input id="vault-exp-date" type="date" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950">
        </div>
      </div>
      <div class="flex items-center space-x-2">
        <input type="checkbox" id="vault-permanent" onchange="document.getElementById('vault-exp-date').disabled = this.checked;" class="accent-teal-500">
        <label for="vault-permanent" class="text-slate-700 cursor-pointer">Documento permanente / sin vencimiento (ej. Estatutos de constitución)</label>
      </div>
      <div>
        <label class="block font-semibold text-slate-700 mb-1">Archivo de Respaldo (PDF) *</label>
        <input id="vault-file" type="file" required accept=".pdf" class="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-950 file:mr-2 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-xs file:bg-teal-600 file:text-white">
      </div>
      <div id="vault-err" class="text-rose-700 hidden"></div>
      <div class="flex justify-end gap-2 pt-2 border-t border-slate-200">
        <button type="button" onclick="closePfModal()" class="px-3.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900">Cancelar</button>
        <button type="submit" id="vault-submit-btn" class="px-4 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold">Guardar en Bóveda</button>
      </div>
    </form>
  `;
  pfModal('Subir Documento a Bóveda Legal Central', html, false);
}

async function handleUploadVaultDoc(e) {
  e.preventDefault();
  const btn = document.getElementById('vault-submit-btn');
  const err = document.getElementById('vault-err');
  err.classList.add('hidden');

  const fileInput = document.getElementById('vault-file');
  if (!fileInput.files.length) {
    err.textContent = 'Selecciona un archivo PDF';
    err.classList.remove('hidden');
    return;
  }

  const fd = new FormData();
  fd.append('doc_type', document.getElementById('vault-type').value);
  fd.append('title', document.getElementById('vault-title').value);
  fd.append('issue_date', document.getElementById('vault-issue-date').value || '');
  fd.append('expiration_date', document.getElementById('vault-exp-date').value || '');
  fd.append('is_permanent', document.getElementById('vault-permanent').checked ? 'true' : 'false');
  fd.append('file', fileInput.files[0]);

  btn.disabled = true;
  btn.textContent = 'Subiendo...';

  try {
    const res = await fetch('/api/companies/legal-vault', {
      method: 'POST',
      body: fd
    });
    if (!res.ok) {
      const j = await res.json();
      throw new Error(j.detail || 'Error al guardar en bóveda');
    }
    showToast('Documento guardado exitosamente en la Bóveda');
    closePfModal();
    await renderLegalVault();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Guardar en Bóveda';
  }
}

async function deleteLegalVaultDoc(id) {
  if (!confirm('¿Estás seguro de eliminar este documento de la Bóveda Legal?')) return;
  try {
    const res = await fetch('/api/companies/legal-vault/' + id, { method: 'DELETE' });
    if (res.ok) {
      showToast('Documento eliminado de la Bóveda');
      await renderLegalVault();
    } else {
      showToast('Error eliminando documento', 'error');
    }
  } catch (err) {
    showToast('Error de conexión', 'error');
  }
}

// ============================================================================
// CANVAS DE FIRMA DIGITAL Y RÚBRICA
// ============================================================================
const signatureCanvases = {};

function setupSignatureCanvas(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  // Ajustar dimensiones internas
  function resize() {
    canvas.width = canvas.parentElement.clientWidth || 400;
    canvas.height = 160;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }
  resize();

  let isDrawing = false;
  let lastX = 0;
  let lastY = 0;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function start(e) {
    isDrawing = true;
    const pos = getPos(e);
    lastX = pos.x;
    lastY = pos.y;
  }

  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastX = pos.x;
    lastY = pos.y;
  }

  function stop() {
    isDrawing = false;
  }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stop);
  canvas.addEventListener('mouseleave', stop);

  canvas.addEventListener('touchstart', start);
  canvas.addEventListener('touchmove', draw);
  canvas.addEventListener('touchend', stop);

  signatureCanvases[canvasId] = { canvas, ctx };
}

function clearSignatureCanvas(canvasId) {
  const c = signatureCanvases[canvasId];
  if (c) {
    c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
  }
}

function loadSignatureImage(canvasId, dataUrl) {
  const c = signatureCanvases[canvasId];
  if (c && dataUrl) {
    const img = new Image();
    img.onload = () => {
      c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
      c.ctx.drawImage(img, 0, 0, c.canvas.width, c.canvas.height);
    };
    img.src = dataUrl;
  }
}
