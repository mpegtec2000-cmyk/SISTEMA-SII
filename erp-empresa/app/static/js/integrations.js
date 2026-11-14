// ============================================================================
// INTEGRACIONES EN VIVO: SII (RCV con Clave Tributaria; certificado sólo para emitir DTE) y banco (Fintoc)
// Se renderizan dentro de "Multi-Empresa & Config" para la empresa activa.
// ============================================================================

const _origRenderCompaniesConfig = renderCompaniesConfig;
renderCompaniesConfig = async function () { await _origRenderCompaniesConfig(); await renderIntegrations(); };

let _bankAutoTimer = null;

async function renderIntegrations() {
  const view = document.getElementById('view-companies');
  if (!view) return;
  let host = document.getElementById('integrations-section');
  if (!host) { host = document.createElement('div'); host.id = 'integrations-section'; host.className = 'space-y-6'; view.appendChild(host); }
  let sii = {}, bank = {}, sum = {};
  try { [sii, bank, sum] = await Promise.all([pfJson('/api/integrations/sii/config'), pfJson('/api/integrations/bank/config'), pfJson('/api/integrations/bank/summary')]); }
  catch (e) { host.innerHTML = `<p class="text-xs text-rose-700">${esc(e.message)}</p>`; return; }
  const comp = state.currentCompany || {};
  const bankOk = bank.status === 'CONECTADO';
  const expSoon = sii.cert_expires && (new Date(sii.cert_expires) - new Date()) / 86400000 < 30;
  host.innerHTML = `
  <div class="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
    <div class="flex items-center justify-between"><div><h3 class="font-heading font-bold text-sm text-slate-950"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="22" x2="22" y2="22"/><line x1="12" y1="2" x2="2" y2="7"/><line x1="12" y1="2" x2="22" y2="7"/><line x1="6" y1="12" x2="6" y2="18"/><line x1="10" y1="12" x2="10" y2="18"/><line x1="14" y1="12" x2="14" y2="18"/><line x1="18" y1="12" x2="18" y2="18"/></svg> Conexión real con el SII · ${esc(comp.razon_social || '')}</h3>
      <p class="text-xs text-slate-600">Sincroniza el Registro de Compras y Ventas (RCV) con <b>RUT y Clave Tributaria</b> y vincula las facturas a las carpetas de negocio. No requiere certificado digital.</p></div>
      <span class="px-2.5 py-1 rounded-full text-[11px] font-bold ${sii.has_clave ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">${sii.has_clave ? 'Clave Tributaria guardada' : 'Sin Clave Tributaria'}</span></div>
    <form onsubmit="siiSave(event)" class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
      <div><label class="block text-slate-600 mb-1">RUT de la empresa</label><input name="rut" required value="${esc(sii.rut || comp.rut || '')}" class="${PF_IN}"></div>
      <div><label class="block text-slate-600 mb-1">Ambiente</label><select name="ambiente" class="${PF_IN}"><option value="PRODUCCION" ${sii.ambiente !== 'CERTIFICACION' ? 'selected' : ''}>Producción (real)</option><option value="CERTIFICACION" ${sii.ambiente === 'CERTIFICACION' ? 'selected' : ''}>Certificación (pruebas)</option></select></div>
      <div><label class="block text-slate-600 mb-1">Clave Tributaria (Clave SII)</label><input name="clave" type="password" autocomplete="new-password" placeholder="${sii.has_clave ? '•••••• (guardada)' : 'Clave SII de la empresa'}" class="${PF_IN}"></div>
      <div class="md:col-span-3 flex flex-wrap items-center justify-between gap-2"><span class="text-[11px] text-slate-500"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> La clave se guarda <b>cifrada</b> (AES) en este equipo y nunca vuelve al navegador.</span>
        <button class="${PF_BTN} bg-blue-600 hover:bg-blue-700 text-white">Guardar RUT y Clave Tributaria</button></div></form>
    ${sii.has_clave ? `<div class="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs">
      <span class="text-slate-500">Última sincronización</span><div class="text-slate-950">${esc(sii.last_sync || 'nunca')}</div><div class="text-slate-600">${esc(sii.last_status || '')}</div></div>
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <button onclick="siiTest()" class="${PF_BTN} bg-slate-100 hover:bg-slate-200 text-slate-950">Probar conexión</button>
      <select id="sii-months" class="${PF_IN} !w-40"><option value="1">Mes actual</option><option value="2" selected>Últimos 2 meses</option><option value="3">Últimos 3 meses</option><option value="6">Últimos 6 meses</option><option value="12">Últimos 12 meses</option></select>
      <button onclick="siiSync()" class="${PF_BTN} bg-emerald-600 hover:bg-emerald-700 text-white">⟳ Sincronizar RCV ahora</button>
      <button onclick="siiRemoveClave()" class="text-slate-500 hover:text-rose-700 ml-auto">Eliminar clave</button></div>
    <div id="sii-progress" class="text-xs"></div>` : ''}
    <div class="border-t border-slate-200 pt-4 space-y-3">
      <div class="flex items-center justify-between"><div><h4 class="font-bold text-xs text-slate-950"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M16 8h-6"/><path d="M16 12h-6"/><path d="M14 16h-4"/></svg> Facturación electrónica (emitir DTE) — Certificado digital</h4>
        <p class="text-[11px] text-slate-600">Sólo necesario para <b>emitir / timbrar</b> documentos. No se usa para consultar el RCV.</p></div>
        <span class="px-2.5 py-1 rounded-full text-[11px] font-bold ${sii.has_cert ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-700 border border-slate-300'}">${sii.has_cert ? 'Certificado cargado' : 'Sin certificado'}</span></div>
      <form onsubmit="siiSave(event)" class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <input type="hidden" name="rut" value="${esc(sii.rut || comp.rut || '')}"><input type="hidden" name="ambiente" value="${esc(sii.ambiente || 'PRODUCCION')}">
        <div><label class="block text-slate-600 mb-1">Certificado digital (.pfx / .p12)</label><input name="file" type="file" accept=".pfx,.p12" class="${PF_IN}"></div>
        <div><label class="block text-slate-600 mb-1">Contraseña del certificado</label><input name="password" type="password" autocomplete="new-password" placeholder="${sii.has_cert ? '•••••• (guardada)' : ''}" class="${PF_IN}"></div>
        <div class="flex items-end gap-2"><button class="${PF_BTN} bg-blue-600 hover:bg-blue-700 text-white">Guardar certificado</button>${sii.has_cert ? `<button type="button" onclick="siiRemove()" class="text-slate-500 hover:text-rose-700">Eliminar</button>` : ''}</div>
        ${sii.has_cert ? `<div class="md:col-span-3 text-slate-600">Titular: <b class="text-slate-950">${esc(sii.cert_subject || '—')}</b> ${esc(sii.cert_rut || '')} · Vence: <b class="${expSoon ? 'text-amber-700' : 'text-slate-950'}">${esc(sii.cert_expires || '—')}${expSoon ? ' <svg class="w-3.5 h-3.5 inline text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> por vencer' : ''}</b></div>` : ''}
      </form></div>
  </div>

  <div class="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
    <div class="flex items-center justify-between"><div><h3 class="font-heading font-bold text-sm text-slate-950"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="21" x2="21" y2="21"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="5 6 12 3 19 6"/><line x1="4" y1="10" x2="4" y2="21"/><line x1="20" y1="10" x2="20" y2="21"/></svg> Banco en línea (Fintoc) · ${esc(comp.razon_social || '')}</h3>
      <p class="text-xs text-slate-600">Lee abonos y cargos reales y los cruza con las facturas emitidas y recibidas.</p></div>
      <span class="px-2.5 py-1 rounded-full text-[11px] font-bold ${bankOk ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">${bankOk ? 'Conectado' + (bank.institution ? ' · ' + esc(bank.institution) : '') : esc((bank.status || 'SIN_CONECTAR').replace('_', ' '))}</span></div>
    <form onsubmit="bankSave(event)" class="space-y-3 text-xs">
      <div class="flex flex-wrap items-center gap-4 text-slate-700"><span class="text-slate-600">Modo activo:</span>
        <label class="flex items-center gap-1.5"><input type="radio" name="mode" value="LIVE" ${bank.mode !== 'TEST' ? 'checked' : ''}> LIVE (cuenta real)</label>
        <label class="flex items-center gap-1.5"><input type="radio" name="mode" value="TEST" ${bank.mode === 'TEST' ? 'checked' : ''}> TEST (pruebas: lee pero no guarda datos)</label></div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="border border-slate-200 rounded-lg p-3 space-y-2"><div class="font-bold text-slate-900">LIVE ${bank.live && bank.live.has_secret ? '<span class="text-emerald-700 font-normal">· clave guardada' + (bank.live.from_env ? ' (.env)' : '') + '</span>' : ''}</div>
          <div><label class="block text-slate-600 mb-1">Secret key (sk_live_…)</label><input name="secret_key" type="password" autocomplete="new-password" placeholder="${bank.live && bank.live.has_secret ? '•••••• (guardada)' : 'sk_live_…'}" class="${PF_IN}"></div>
          <div><label class="block text-slate-600 mb-1">API key pública (pk_live_…)</label><input name="public_key" value="${esc(bank.live ? bank.live.public_key : '')}" placeholder="pk_live_…" class="${PF_IN}"></div>
          <div><label class="block text-slate-600 mb-1">link_token (opcional)</label><input name="link_token" type="password" autocomplete="new-password" placeholder="${bank.live && bank.live.has_link ? '•••••• (vinculado)' : 'link_…_token_…'}" class="${PF_IN}"></div></div>
        <div class="border border-slate-200 rounded-lg p-3 space-y-2"><div class="font-bold text-slate-900">TEST ${bank.test && bank.test.has_secret ? '<span class="text-emerald-700 font-normal">· clave guardada' + (bank.test.from_env ? ' (.env)' : '') + '</span>' : ''}</div>
          <div><label class="block text-slate-600 mb-1">Secret key (sk_test_…)</label><input name="secret_key_test" type="password" autocomplete="new-password" placeholder="${bank.test && bank.test.has_secret ? '•••••• (guardada)' : 'sk_test_…'}" class="${PF_IN}"></div>
          <div><label class="block text-slate-600 mb-1">API key pública (pk_test_…)</label><input name="public_key_test" value="${esc(bank.test ? bank.test.public_key : '')}" placeholder="pk_test_…" class="${PF_IN}"></div>
          <div><label class="block text-slate-600 mb-1">link_token (opcional)</label><input name="link_token_test" type="password" autocomplete="new-password" placeholder="${bank.test && bank.test.has_link ? '•••••• (vinculado)' : 'link_…_token_…'}" class="${PF_IN}"></div></div></div>
      <div class="flex flex-wrap items-center justify-between gap-2"><span class="text-[11px] text-slate-500">Claves en <b>dashboard.fintoc.com</b>. También pueden definirse en <code>.env</code> (FINTOC_API_KEY / FINTOC_SECRET_KEY y las variantes _TEST). Se guardan cifradas. Fintoc es sólo lectura.</span>
        <div class="flex gap-2"><button type="button" onclick="bankWidget()" class="${PF_BTN} bg-indigo-600 hover:bg-indigo-700 text-white"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Conectar banco (widget Fintoc)</button><button class="${PF_BTN} bg-blue-600 hover:bg-blue-700 text-white">Guardar credenciales</button></div></div></form>
    ${bankOk ? `<div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
      <div class="rounded-lg bg-slate-50 border border-slate-200 p-3"><div class="text-slate-500">Por cobrar (facturas sin pago)</div><div class="text-lg font-bold text-emerald-700">${pfClp(sum.cxc_total)}</div><div class="text-slate-500">${sum.cxc_count} documento(s)</div></div>
      <div class="rounded-lg bg-slate-50 border border-slate-200 p-3"><div class="text-slate-500">Por pagar (facturas sin pago)</div><div class="text-lg font-bold text-amber-700">${pfClp(sum.cxp_total)}</div><div class="text-slate-500">${sum.cxp_count} documento(s)</div></div>
      <div class="rounded-lg bg-slate-50 border border-slate-200 p-3"><div class="text-slate-500">Movimientos sin conciliar</div><div class="text-lg font-bold text-slate-950">${sum.unreconciled_tx}</div></div>
      <div class="rounded-lg bg-slate-50 border border-slate-200 p-3"><div class="text-slate-500">Cruces sugeridos</div><div class="text-lg font-bold text-blue-700">${sum.suggestions}</div></div></div>
    ${(bank.accounts || []).length ? `<div class="text-xs space-y-1">${bank.accounts.map(a => `<div class="flex justify-between bg-slate-50 rounded-lg px-3 py-2"><span class="text-slate-900">${esc(a.bank_name)} · ${esc(a.account_type)} <span class="font-mono text-slate-500">${esc(a.account_number)}</span></span><b class="text-slate-950">${pfClp(a.balance)}</b></div>`).join('')}</div>` : ''}
    <div class="flex flex-wrap items-center gap-2 text-xs"><button onclick="bankSync()" class="${PF_BTN} bg-emerald-600 hover:bg-emerald-700 text-white">⟳ Sincronizar movimientos ahora</button>
      <button onclick="bankReconcile()" class="${PF_BTN} bg-slate-100 hover:bg-slate-200 text-slate-950">Conciliar automáticamente</button>
      <label class="flex items-center gap-1.5 text-slate-700"><input type="checkbox" ${localStorage.getItem('bankAuto') === '1' ? 'checked' : ''} onchange="bankToggleAuto(this.checked)"> Actualizar cada 5 min mientras la app esté abierta</label>
      <button onclick="bankDisconnect()" class="text-slate-500 hover:text-rose-700 ml-auto">Desconectar</button></div>
    <div class="text-[11px] text-slate-500">Última sincronización: ${esc(bank.last_sync || 'nunca')} · ${esc(bank.last_message || '')}</div>` : ''}
  </div>`;
  lucide.createIcons();
}

// ----------------------------------------------------------------- SII
async function siiSave(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (!fd.get('file') || !fd.get('file').name) fd.delete('file');
  if (fd.has('clave') && !fd.get('clave')) fd.delete('clave');
  if (fd.has('password') && !fd.get('password')) fd.delete('password');
  try { const r = await pfJson('/api/integrations/sii/config', { method: 'POST', body: fd }); showToast(r.message); await renderIntegrations(); }
  catch (err) { showToast(err.message, 'error'); }
}
async function siiTest() {
  showToast('Conectando con el SII…', 'info');
  try { const r = await pfJson('/api/integrations/sii/test', { method: 'POST' }); showToast(r.message); window._siiLast = { ok: true, msg: r.message }; }
  catch (err) { showToast(err.message, 'error'); window._siiLast = { ok: false, msg: 'Respuesta del SII: ' + err.message }; }
  await renderIntegrations();
}
async function siiRemoveClave() { if (!confirm('¿Eliminar la Clave Tributaria guardada?')) return; await pfJson('/api/integrations/sii/clave', { method: 'DELETE' }); await renderIntegrations(); }
async function siiRemove() { if (!confirm('¿Eliminar el certificado guardado?')) return; await pfJson('/api/integrations/sii/config', { method: 'DELETE' }); await renderIntegrations(); }
async function siiSync() {
  const months = parseInt(document.getElementById('sii-months').value, 10);
  const box = document.getElementById('sii-progress');
  try {
    const r = await pfJson('/api/integrations/sii/sync', pfJsonOpts('POST', { months }));
    for (let i = 0; i < 600; i++) {
      await new Promise(res => setTimeout(res, 1500));
      const j = await pfJson(`/api/integrations/job/${r.job_id}`);
      box.innerHTML = `<div class="${j.status === 'ERROR' ? 'text-rose-700' : 'text-blue-700'} font-semibold">${esc(j.message)} ${j.total ? `(${j.done}/${j.total})` : ''}</div>` +
        (j.errors.length ? `<details class="text-amber-700 mt-1"><summary>${j.errors.length} aviso(s)</summary><div class="text-[11px] text-slate-600">${j.errors.map(esc).join('<br>')}</div></details>` : '');
      if (j.status === 'LISTO') { showToast(j.message); if (typeof renderSII === 'function') { try { await renderSII(); } catch (x) { /* vista no activa */ } } return; }
      if (j.status === 'ERROR') { showToast(j.message, 'error'); return; }
    }
  } catch (err) { showToast(err.message, 'error'); }
}

// ----------------------------------------------------------------- Banco
function bankPayload(f) {
  const m = f.querySelector('input[name="mode"]:checked');
  const o = { mode: m ? m.value : 'LIVE', public_key: f.public_key.value, public_key_test: f.public_key_test.value };
  ['secret_key', 'link_token', 'secret_key_test', 'link_token_test'].forEach(k => { if (f[k].value) o[k] = f[k].value; });
  return o;
}
async function bankSave(e) {
  e.preventDefault(); const f = e.target;
  try { const r = await pfJson('/api/integrations/bank/config', pfJsonOpts('POST', bankPayload(f))); showToast(r.message); await renderIntegrations(); }
  catch (err) { showToast(err.message, 'error'); }
}
function loadFintocScript() {
  return new Promise((resolve, reject) => {
    if (window.Fintoc) return resolve();
    const s = document.createElement('script'); s.src = 'https://js.fintoc.com/v1/'; s.onload = resolve; s.onerror = () => reject(new Error('No se pudo cargar el widget de Fintoc (revisa tu conexión).')); document.head.appendChild(s);
  });
}
async function bankWidget() {
  const cfg = await pfJson('/api/integrations/bank/config');
  if (!cfg.has_secret || !cfg.public_key) { showToast('Guarda primero la clave secreta y la clave pública de Fintoc.', 'error'); return; }
  try {
    await loadFintocScript();
    const widget = window.Fintoc.create({
      publicKey: cfg.public_key, holderType: 'business', product: 'movements',
      onSuccess: async (data) => {
        const token = data && (data.exchangeToken || data.exchange_token);
        try { const r = await pfJson('/api/integrations/bank/exchange', pfJsonOpts('POST', { exchange_token: token })); showToast(r.message); await renderIntegrations(); await bankSync(); }
        catch (err) { showToast(err.message, 'error'); }
      },
      onExit: () => { /* cerrado por el usuario */ }
    });
    widget.open();
  } catch (err) { showToast(err.message, 'error'); }
}
async function bankSync(silent) {
  if (!silent) showToast('Sincronizando movimientos…', 'info');
  try { const r = await pfJson('/api/integrations/bank/sync', pfJsonOpts('POST', { days: 90 })); if (!silent || r.new_transactions) showToast(r.message); if (state.activeTab === 'companies') await renderIntegrations(); if (state.activeTab === 'banking') await renderBanking(); }
  catch (err) { if (!silent) showToast(err.message, 'error'); }
}
async function bankReconcile() {
  try { const r = await pfJson('/api/integrations/bank/auto-reconcile', { method: 'POST' }); showToast(r.message); await renderIntegrations(); } catch (err) { showToast(err.message, 'error'); }
}
async function bankDisconnect() { if (!confirm('¿Desconectar el banco de esta empresa?')) return; await pfJson('/api/integrations/bank/config', { method: 'DELETE' }); await renderIntegrations(); }
function bankToggleAuto(on) {
  localStorage.setItem('bankAuto', on ? '1' : '0');
  startBankAuto();
}
function startBankAuto() {
  if (_bankAutoTimer) { clearInterval(_bankAutoTimer); _bankAutoTimer = null; }
  if (localStorage.getItem('bankAuto') === '1') _bankAutoTimer = setInterval(() => bankSync(true), 5 * 60 * 1000);
}
startBankAuto();
