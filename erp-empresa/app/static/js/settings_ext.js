// ============================================================================
// AJUSTES BETA: usuarios, correo de salida (SMTP / Resend / SendGrid), prueba de IA
// y envío directo de cotizaciones / órdenes de compra. Se carga al final.
// ============================================================================
(function () {
  'use strict';
  var IN = PF_IN, BTN = PF_BTN;

  function api(url, opts) { return pfJson(url, opts); }
  function lbl(t) { return '<label class="block text-slate-600 mb-1">' + t + '</label>'; }
  function inp(id, v, o) {
    o = o || {};
    return '<div class="' + (o.span || '') + '">' + lbl(o.label || '') + '<input id="' + id + '" type="' + (o.type || 'text') + '" value="' + esc(v == null ? '' : v) +
      '" placeholder="' + esc(o.ph || '') + '" autocomplete="' + (o.ac || 'off') + '" class="' + IN + '"></div>';
  }
  function gv(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }

  // ================================================================ USUARIOS
  var ROLE_LABEL = { ADMIN: 'Administrador', USUARIO: 'Usuario' };
  window.renderUsers = async function () {
    var host = document.getElementById('view-users'); if (!host) return;
    var users;
    try { users = await api('/api/auth/users'); }
    catch (e) { host.innerHTML = '<div class="bg-white border border-slate-200 rounded-xl p-5 text-sm text-rose-700">' + esc(e.message) + '</div>'; return; }
    var me = (pf.auth && pf.auth.user) || {};
    host.innerHTML = '<div class="bg-white border border-slate-200 rounded-xl p-5 space-y-4">' +
      '<div class="flex flex-wrap items-center justify-between gap-2"><div><h3 class="font-heading font-bold text-sm text-slate-950"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Usuarios</h3>' +
      '<p class="text-xs text-slate-600">Crea y administra quién puede ingresar. Si no eliges empresas, el usuario accede a todas.</p></div>' +
      '<button onclick="userForm()" class="' + BTN + ' bg-blue-600 hover:bg-blue-700 text-white">+ Crear Nuevo Usuario</button></div>' +
      '<div class="overflow-x-auto"><table class="w-full text-xs text-left"><thead class="text-[10px] uppercase text-slate-500 border-b border-slate-200"><tr>' +
      ['Nombre', 'Correo / usuario', 'Rol', 'Empresas', 'Estado', ''].map(function (h) { return '<th class="py-2 px-2">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      users.map(function (u) {
        return '<tr class="border-b border-slate-200"><td class="py-2 px-2 text-slate-950 font-semibold">' + esc(u.full_name || '—') + '</td>' +
          '<td class="py-2 px-2 text-slate-700">' + esc(u.email || u.username) + (u.email ? '<div class="text-[10px] text-slate-500">usuario: ' + esc(u.username) + '</div>' : '') + '</td>' +
          '<td class="py-2 px-2">' + esc(ROLE_LABEL[u.role] || u.role) + '</td>' +
          '<td class="py-2 px-2 text-slate-600">' + (u.allowed_companies ? esc(u.allowed_companies) : 'Todas') + '</td>' +
          '<td class="py-2 px-2"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ' + (u.is_active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-700 border border-slate-200') + '">' + (u.is_active ? 'Activo' : 'Inactivo') + '</span></td>' +
          '<td class="py-2 px-2 whitespace-nowrap space-x-2"><button onclick="userForm(' + u.id + ')" class="text-blue-700 hover:underline">Editar</button>' +
          (u.id !== me.id ? '<button onclick="userToggle(' + u.id + ',' + (u.is_active ? 0 : 1) + ')" class="text-slate-600 hover:text-slate-950">' + (u.is_active ? 'Desactivar' : 'Activar') + '</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    window._users = users;
  };

  window.userForm = async function (id) {
    var u = id ? (window._users || []).filter(function (x) { return x.id === id; })[0] : null;
    var comps = [];
    try { comps = await api('/api/companies/'); } catch (e) { /* */ }
    var allowed = u && u.allowed_companies ? u.allowed_companies.split(',') : [];
    pfModal(u ? 'Editar usuario' : 'Crear Nuevo Usuario',
      '<form onsubmit="userSave(event,' + (id || 0) + ')" class="space-y-3 text-xs">' +
      inp('us-name', u && u.full_name, { label: 'Nombre completo' }) +
      inp('us-email', u && u.email, { label: 'Correo (será su usuario de acceso)', type: 'email', ac: 'off' }) +
      inp('us-pass', '', { label: u ? 'Nueva contraseña (vacío = no cambiar)' : 'Contraseña (mín. 8 caracteres)', type: 'password', ac: 'new-password' }) +
      '<div>' + lbl('Rol') + '<select id="us-role" class="' + IN + '"><option value="USUARIO" ' + (u && u.role === 'USUARIO' ? 'selected' : '') + '>Usuario</option><option value="ADMIN" ' + (u && u.role === 'ADMIN' ? 'selected' : '') + '>Administrador</option></select>' +
      '<p class="text-[10px] text-slate-500 mt-1">Solo los administradores gestionan usuarios. Por ahora el resto de módulos es igual para ambos roles.</p></div>' +
      '<div>' + lbl('Empresas permitidas (ninguna marcada = todas)') + '<div class="space-y-1">' + comps.map(function (c) {
        return '<label class="flex items-center gap-2 text-slate-900"><input type="checkbox" class="us-comp" value="' + c.id + '" ' + (allowed.indexOf(String(c.id)) >= 0 ? 'checked' : '') + '> ' + esc(c.razon_social) + '</label>';
      }).join('') + '</div></div>' +
      '<div id="us-err" class="text-rose-700"></div>' +
      '<div class="flex justify-end gap-2"><button type="button" onclick="closePfModal()" class="' + BTN + ' bg-slate-100 hover:bg-slate-200 text-slate-900 border border-slate-300">Cancelar</button><button class="' + BTN + ' bg-blue-600 hover:bg-blue-700 text-white">' + (u ? 'Guardar' : 'Crear usuario') + '</button></div></form>');
  };

  window.userSave = async function (e, id) {
    e.preventDefault();
    var comps = Array.prototype.map.call(document.querySelectorAll('.us-comp:checked'), function (x) { return x.value; }).join(',');
    var body = { full_name: gv('us-name'), email: gv('us-email'), role: gv('us-role'), allowed_companies: comps };
    var pass = document.getElementById('us-pass').value;
    try {
      if (id) { if (pass) body.password = pass; await api('/api/auth/users/' + id, pfJsonOpts('PUT', body)); }
      else {
        if (!body.email) throw new Error('El correo es obligatorio');
        body.password = pass; await api('/api/auth/users', pfJsonOpts('POST', body));
      }
      closePfModal(); showToast(id ? 'Usuario actualizado' : 'Usuario creado'); await renderUsers();
    } catch (err) { document.getElementById('us-err').textContent = err.message; }
  };
  window.userToggle = async function (id, active) {
    if (!active && !confirm('¿Desactivar este usuario? Se cerrarán sus sesiones.')) return;
    try { await api('/api/auth/users/' + id, pfJsonOpts('PUT', { is_active: active })); await renderUsers(); }
    catch (err) { showToast(err.message, 'error'); }
  };

  // ================================================================ CORREO DE SALIDA
  async function renderEmailSection() {
    var view = document.getElementById('view-companies'); if (!view) return;
    var host = document.getElementById('email-section');
    if (!host) { host = document.createElement('div'); host.id = 'email-section'; view.appendChild(host); }
    var c;
    try { c = await api('/api/email/config'); } catch (e) { host.innerHTML = '<p class="text-xs text-rose-700">' + esc(e.message) + '</p>'; return; }
    var smtp = c.provider === 'SMTP';
    host.innerHTML = '<div class="bg-white border border-slate-200 rounded-xl p-5 space-y-4">' +
      '<div class="flex items-center justify-between"><div><h3 class="font-heading font-bold text-sm text-slate-950"><svg class="w-3.5 h-3.5 inline text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>️ Correo de salida</h3>' +
      '<p class="text-xs text-slate-600">Envía cotizaciones y órdenes de compra con el PDF adjunto directamente desde la app (SMTP, Resend o SendGrid).</p></div>' +
      '<span class="px-2.5 py-1 rounded-full text-[11px] font-bold ' + (c.configured ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200') + '">' + (c.configured ? 'Configurado' : 'Sin configurar') + '</span></div>' +
      '<form onsubmit="mailSave(event)" class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">' +
      '<div>' + lbl('Proveedor') + '<select id="ml-prov" onchange="mailToggle()" class="' + IN + '"><option value="SMTP" ' + (smtp ? 'selected' : '') + '>SMTP (Gmail, Outlook, hosting…)</option><option value="RESEND" ' + (c.provider === 'RESEND' ? 'selected' : '') + '>Resend</option><option value="SENDGRID" ' + (c.provider === 'SENDGRID' ? 'selected' : '') + '>SendGrid</option></select></div>' +
      inp('ml-from', c.from_email, { label: 'Correo remitente', type: 'email', ph: 'ventas@tuempresa.cl' }) + inp('ml-name', c.from_name, { label: 'Nombre remitente', ph: 'Tu Empresa SpA' }) +
      '<div id="ml-smtp" class="md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-3 ' + (smtp ? '' : 'hidden') + '">' +
      inp('ml-host', c.host, { label: 'Servidor SMTP', ph: 'smtp.gmail.com' }) + inp('ml-port', c.port, { label: 'Puerto', type: 'number' }) +
      '<div>' + lbl('Seguridad') + '<select id="ml-sec" class="' + IN + '">' + ['STARTTLS', 'SSL', 'NONE'].map(function (s) { return '<option ' + (c.security === s ? 'selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>' +
      inp('ml-user', c.username, { label: 'Usuario', ph: 'ventas@tuempresa.cl' }) +
      inp('ml-pass', '', { label: 'Contraseña', type: 'password', ac: 'new-password', ph: c.has_password ? '•••••• (guardada)' : '' }) + '</div>' +
      '<div id="ml-keybox" class="md:col-span-3 ' + (smtp ? 'hidden' : '') + '">' + inp('ml-api', '', { label: 'API key (Resend / SendGrid)', type: 'password', ac: 'new-password', ph: c.has_api_key ? '•••••• (guardada)' : '' }) + '</div>' +
      inp('ml-reply', c.reply_to, { label: 'Responder a (opcional)', type: 'email' }) +
      '<div class="md:col-span-2 flex items-end justify-end gap-2"><button class="' + BTN + ' bg-blue-600 hover:bg-blue-700 text-white">Guardar configuración</button></div>' +
      '<p class="md:col-span-3 text-[11px] text-slate-500">Gmail/Outlook/Office365 requieren una <b>contraseña de aplicación</b> (no la clave normal). Puertos típicos: 587 = STARTTLS, 465 = SSL. Los secretos se guardan cifrados.</p></form>' +
      (c.configured ? '<div class="flex flex-wrap items-center gap-2 text-xs border-t border-slate-200 pt-3"><input id="ml-test-to" type="email" placeholder="correo para la prueba" class="' + IN + ' !w-64"><button onclick="mailTest()" class="' + BTN + ' bg-emerald-600 hover:bg-emerald-700 text-white">Enviar correo de prueba</button>' +
        '<span id="ml-test-res" class="text-slate-600">' + esc(c.last_status || '') + '</span></div>' : '') + '</div>';
  }
  window.mailToggle = function () {
    var s = gv('ml-prov') === 'SMTP';
    document.getElementById('ml-smtp').classList.toggle('hidden', !s);
    document.getElementById('ml-keybox').classList.toggle('hidden', s);
  };
  window.mailSave = async function (e) {
    e.preventDefault();
    var body = { provider: gv('ml-prov'), from_email: gv('ml-from'), from_name: gv('ml-name'), reply_to: gv('ml-reply'), host: gv('ml-host'), port: parseInt(gv('ml-port'), 10) || 587, security: gv('ml-sec') || 'STARTTLS', username: gv('ml-user') };
    var pw = document.getElementById('ml-pass').value, key = document.getElementById('ml-api').value.trim();
    if (pw) body.password = pw; if (key) body.api_key = key;
    try { var r = await api('/api/email/config', pfJsonOpts('POST', body)); showToast(r.message); await renderEmailSection(); }
    catch (err) { showToast(err.message, 'error'); }
  };
  window.mailTest = async function () {
    var out = document.getElementById('ml-test-res'); out.textContent = 'Enviando…'; out.className = 'text-blue-700';
    try { var r = await api('/api/email/test', pfJsonOpts('POST', { to: gv('ml-test-to') })); out.textContent = '<svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> ' + r.message; out.className = 'text-emerald-700'; }
    catch (err) { out.textContent = '<svg class="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> ' + err.message; out.className = 'text-rose-700'; }
  };

  // ---------------------------------------------------------------- composición / envío
  window.emailCompose = async function (o) {
    var cfg;
    try { cfg = await api('/api/email/config'); } catch (e) { showToast(e.message, 'error'); return false; }
    if (!cfg.configured) return false;
    var m = document.createElement('div'); m.id = 'em-modal'; m.className = 'fixed inset-0 z-[95] bg-slate-900/45 flex items-center justify-center p-4';
    m.innerHTML = '<div class="bg-white border border-slate-200 rounded-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto p-5 space-y-3 text-xs">' +
      '<div class="flex justify-between items-center"><h3 class="font-bold text-sm text-slate-950"><svg class="w-3.5 h-3.5 inline text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>️ Enviar por correo</h3><button onclick="emClose()" class="text-slate-600 hover:text-slate-950"><svg class="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>' +
      inp('em-to', o.to, { label: 'Para (separa varios con coma)' }) + inp('em-cc', '', { label: 'Copia (opcional)' }) + inp('em-subj', o.subject, { label: 'Asunto' }) +
      '<div>' + lbl('Mensaje') + '<textarea id="em-body" rows="9" class="' + IN + '">' + esc(o.body || '') + '</textarea></div>' +
      (o.attach_type ? '<div class="text-slate-600"><svg class="w-3.5 h-3.5 inline text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> Se adjuntará el PDF del documento. Remitente: <b class="text-slate-900">' + esc(cfg.from_email) + '</b></div>' : '') +
      '<div id="em-err" class="text-rose-700"></div><div class="flex justify-end gap-2"><button onclick="emClose()" class="' + BTN + ' bg-slate-100 hover:bg-slate-200 text-slate-900 border border-slate-300">Cancelar</button>' +
      '<button id="em-send" onclick="emSend()" class="' + BTN + ' bg-blue-600 hover:bg-blue-700 text-white">Enviar ahora</button></div></div>';
    document.body.appendChild(m);
    window._emOpts = o;
    return true;
  };
  window.emClose = function () { var m = document.getElementById('em-modal'); if (m) m.remove(); };
  window.emSend = async function () {
    var o = window._emOpts, b = document.getElementById('em-send'), er = document.getElementById('em-err');
    b.disabled = true; b.textContent = 'Enviando…'; er.textContent = '';
    try {
      var r = await api('/api/email/send', pfJsonOpts('POST', { to: gv('em-to'), cc: gv('em-cc'), subject: gv('em-subj'), body: document.getElementById('em-body').value, attach_type: o.attach_type || null, attach_id: o.attach_id || null }));
      emClose(); showToast(r.message); if (o.onSent) o.onSent();
    } catch (err) { er.textContent = err.message; b.disabled = false; b.textContent = 'Enviar ahora'; }
  };

  // Seguimiento de cotizaciones: envío directo si hay correo configurado; si no, el mailto original
  var _origPpMail = window.ppMail;
  window.ppMail = async function (id) {
    try {
      var q = await api('/api/pipeline/' + id), to = (document.getElementById('pp-mail') || {}).value || '';
      var url = location.origin + (await api('/api/pipeline/' + id + '/share', { method: 'POST' })).url;
      var body = 'Estimados ' + q.client_name + ',\n\nAdjuntamos nuestra cotización ' + q.folio + ' por ' + pfClp(q.total_amount) + ' (IVA incluido), válida hasta el ' + (q.expires_at || '') + '.\n\nTambién puede revisarla en línea: ' + url + '\n\nQuedamos atentos a sus comentarios.\nSaludos cordiales.';
      var opened = await emailCompose({ to: to.trim(), subject: 'Cotización ' + q.folio, body: body, attach_type: 'quotation', attach_id: id, onSent: function () { if (window.ppModalClose) ppModalClose(); } });
      if (!opened && _origPpMail) { showToast('Correo de salida sin configurar: se abrirá tu programa de correo.', 'info'); return _origPpMail(id); }
    } catch (e) { showToast(e.message, 'error'); }
  };

  // Órdenes de compra / cotizaciones comerciales
  window.cdEmail = async function (id) {
    try {
      var d = await api('/api/commercial-docs/' + id);
      var title = d.doc_type === 'OC' ? 'Orden de Compra' : 'Cotización';
      var opened = await emailCompose({ to: d.counterparty_email || '', subject: title + ' ' + d.folio,
        body: 'Estimados ' + d.counterparty_name + ',\n\nAdjuntamos la ' + title.toLowerCase() + ' ' + d.folio + ' por ' + pfClp(d.total_amount) + '.\n\nQuedamos atentos.\nSaludos cordiales.',
        attach_type: 'commdoc', attach_id: id, onSent: function () { if (window.renderCommDocs) renderCommDocs(); } });
      if (!opened) showToast('Configura primero el correo de salida en Multi-Empresa & Config.', 'error');
    } catch (e) { showToast(e.message, 'error'); }
  };

  // ================================================================ IA: probar clave
  function aiExtras() {
    var save = document.querySelector('button[onclick="saveAiSettings()"]');
    if (!save || document.getElementById('ai-test-btn')) return;
    var b = document.createElement('button'); b.id = 'ai-test-btn'; b.type = 'button';
    b.className = 'px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg font-bold ml-2'; b.textContent = 'Probar conexión con la IA';
    b.onclick = window.aiTest; save.parentNode.insertBefore(b, save.nextSibling);
    var r = document.createElement('div'); r.id = 'ai-test-res'; r.className = 'text-xs mt-2'; save.parentNode.appendChild(r);
  }
  window.aiTest = async function () {
    var r = document.getElementById('ai-test-res'); r.textContent = 'Probando…'; r.className = 'text-xs mt-2 text-blue-700';
    try {
      if (gv('ai-key')) await saveAiSettings();
      var x = await api('/api/workspace/ai-settings/test', { method: 'POST' });
      r.textContent = (x.ok ? '<svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> ' : '<svg class="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> ') + x.message; r.className = 'text-xs mt-2 ' + (x.ok ? 'text-emerald-700' : 'text-rose-700');
    } catch (e) { r.textContent = '<svg class="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> ' + e.message; r.className = 'text-xs mt-2 text-rose-700'; }
  };
  var _origLoadAi = window.loadAiSettings;
  if (_origLoadAi) {
    window.loadAiSettings = async function () {
      await _origLoadAi(); aiExtras();
      try {
        var s = await api('/api/workspace/ai-settings'), b = document.getElementById('ai-status-badge'), names = { gemini: 'Gemini', openai: 'OpenAI-compatible', anthropic: 'Claude (Anthropic)' };
        if (b && s.provider !== 'none') b.textContent = 'IA activa: ' + names[s.provider] + ' (' + s.model + ')' + (s.has_key ? '' : ' · falta API key');
      } catch (e) { /* */ }
    };
  }

  // ================================================================ enganches
  var _ri = window.renderIntegrations;
  if (_ri) {
    window.renderIntegrations = async function () {
      await _ri();
      await renderEmailSection();
      var box = document.getElementById('sii-progress');
      if (box && window._siiLast) box.innerHTML = '<div class="' + (window._siiLast.ok ? 'text-emerald-700' : 'text-rose-700') + ' font-semibold">' + esc(window._siiLast.msg) + '</div>';
    };
  }
  var _sw = window.switchTab;
  window.switchTab = async function (t) {
    await _sw.apply(this, arguments);
    if (t === 'users') await renderUsers();
  };
})();
