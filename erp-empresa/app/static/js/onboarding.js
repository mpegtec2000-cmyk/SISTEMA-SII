// ============================================================================
// ONBOARDING BETA: primer acceso (crear SuperAdmin) + wizard de configuración de empresa
// Se carga después de platform.js / integrations.js y extiende su flujo de acceso.
// ============================================================================
(function () {
  'use strict';

  // ---------------------------------------------------------------- utilidades
  function shell(inner, wide) {
    let o = document.getElementById('auth-overlay');
    if (!o) { o = document.createElement('div'); o.id = 'auth-overlay'; o.className = 'fixed inset-0 z-[100] bg-slate-50 flex items-center justify-center p-4 overflow-y-auto'; document.body.appendChild(o); }
    o.innerHTML = '<div class="w-full ' + (wide ? 'max-w-2xl' : 'max-w-md') + '">' + inner + '</div>';
    if (window.lucide) lucide.createIcons();
  }
  function field(label, name, value, opts) {
    opts = opts || {};
    const fe = wz.errors && wz.errors[name];
    return '<div class="' + (opts.span || '') + '"><label class="block text-xs font-semibold text-slate-600 mb-1">' + label + (opts.req ? ' *' : '') + '</label>' +
      '<input id="wz-' + name + '" type="' + (opts.type === 'email' ? 'text' : (opts.type || 'text')) + '"' + (opts.type === 'email' ? ' inputmode="email"' : '') + ' value="' + esc(value || '') + '" placeholder="' + esc(opts.ph || '') + '" autocomplete="' + (opts.ac || 'off') + '" class="' + PF_IN + ' !py-2 !text-sm' + (fe ? ' !border-rose-500 !bg-rose-50' : '') + '">' +
      (fe ? '<p class="text-[11px] text-rose-700 mt-1">' + esc(fe) + '</p>' : '') + '</div>';
  }
  function fileField(label, name, accept, hint) {
    return '<div><label class="block text-xs font-semibold text-slate-600 mb-1">' + label + '</label>' +
      '<input id="wz-' + name + '" type="file" accept="' + accept + '" class="block w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-slate-800 file:border file:border-slate-300">' +
      (hint ? '<p class="text-[10px] text-slate-500 mt-1">' + hint + '</p>' : '') + '</div>';
  }
  function val(name) { const e = document.getElementById('wz-' + name); return e ? e.value.trim() : ''; }
  function fileOf(name) { const e = document.getElementById('wz-' + name); return e && e.files && e.files[0] ? e.files[0] : null; }
  function toDataUrl(file) {
    return new Promise(function (res, rej) {
      const r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(new Error('No se pudo leer el archivo')); };
      r.readAsDataURL(file);
    });
  }

  // Llamadas del asistente: NO pasan por el interceptor de platform.js, que espera (await __authReady) a que
  // exista una empresa activa; antes de crearla eso dejaba el botón "Guardar y continuar" colgado para siempre.
  async function wzJson(url, opts) {
    const ctl = new AbortController();
    const t = setTimeout(function () { ctl.abort(); }, 30000);
    let res;
    try { res = await _origFetch(url, Object.assign({}, opts || {}, { signal: ctl.signal, credentials: 'same-origin' })); }
    catch (e) { throw new Error(e.name === 'AbortError' ? 'El servidor no respondió en 30 s (' + url + ')' : 'No se pudo contactar al servidor (' + url + '): ' + e.message); }
    finally { clearTimeout(t); }
    let body = null;
    try { body = await res.json(); } catch (e) { /* sin cuerpo */ }
    if (!res.ok) {
      const d = body && (body.detail || body.message);
      console.error('[asistente] ' + url + ' -> HTTP ' + res.status, body);
      throw new Error((typeof d === 'string' ? d : (d ? JSON.stringify(d) : 'Error del servidor')) + ' (HTTP ' + res.status + ')');
    }
    return body;
  }

  // ---------------------------------------------------------------- primer acceso
  const _origLogin = window.showLoginForm;
  function showSetupForm(err) {
    shell('<div class="text-center mb-6"><div class="inline-flex w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-700 items-center justify-center mb-3"><i data-lucide="user-cog" class="w-7 h-7"></i></div>' +
      '<h1 class="text-2xl font-heading font-extrabold text-slate-950">Bienvenido: crea el SuperAdmin</h1>' +
      '<p class="text-xs text-slate-600 mt-1">Instalación limpia (Beta). Define las credenciales reales de acceso; no existen usuarios preconfigurados.</p></div>' +
      '<form onsubmit="doSetupAdmin(event)" class="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-2xl">' +
      field('Nombre completo', 'sa-name', '', { ac: 'name' }) +
      field('Usuario', 'sa-user', '', { req: true, ac: 'username', ph: 'ej: jperez' }) +
      field('Contraseña (mín. 8 caracteres)', 'sa-pass', '', { req: true, type: 'password', ac: 'new-password' }) +
      field('Repite la contraseña', 'sa-pass2', '', { req: true, type: 'password', ac: 'new-password' }) +
      (err ? '<div class="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">' + esc(err) + '</div>' : '') +
      '<button class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg py-2.5 text-sm">Crear administrador y continuar</button></form>');
  }
  window.doSetupAdmin = async function (e) {
    e.preventDefault();
    if (val('sa-pass') !== val('sa-pass2')) return showSetupForm('Las contraseñas no coinciden');
    try {
      const r = await wzJson('/api/auth/setup', pfJsonOpts('POST', { username: val('sa-user'), full_name: val('sa-name'), password: val('sa-pass') }));
      pf.auth.user = r.user;
      startWizard();
    } catch (err) { showSetupForm(err.message); }
  };
  window.showLoginForm = async function (err) {
    let st = null;
    try { st = await wzJson('/api/auth/setup-status'); } catch (e) { /* servidor sin endpoint: login normal */ }
    if (st && st.needs_setup) return showSetupForm(err);
    return _origLogin(err);
  };

  // empresa(s): si el usuario no tiene ninguna -> wizard
  const _origSelector = window.showCompanySelector;
  window.showCompanySelector = async function (companies) {
    if (!companies) {
      try { const me = await wzJson('/api/auth/me'); companies = me.companies; pf.auth.user = me.user; }
      catch (e) { return window.showLoginForm(); }
    }
    if (!companies.length) return startWizard();
    return _origSelector(companies);
  };

  // ---------------------------------------------------------------- wizard de empresa
  const STEPS = ['Empresa', 'Representante', 'SII', 'Banco', 'IA y correo', 'Listo'];
  const wz = { errors: {}, step: 0, companyId: null, company: {}, mode: 'first', done: {} };

  function header() {
    return '<div class="text-center mb-5"><h1 class="text-xl font-heading font-extrabold text-slate-950">Configuración de la empresa</h1><div class="text-[10px] text-slate-600">asistente v3 · sin bloqueo</div>' +
      '<div class="flex items-center justify-center gap-1.5 mt-3 flex-wrap">' + STEPS.map(function (s, i) {
        return '<button type="button" onclick="wzJump(' + i + ')" class="cursor-pointer hover:opacity-80 text-[11px] px-2.5 py-1 rounded-full ' + (i === wz.step ? 'bg-blue-600 text-white font-bold' : (i < wz.step ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600')) + '">' + (i + 1) + '. ' + s + '</button>';
      }).join('') + '</div></div>';
  }
  function errBox(err) { return err ? '<div class="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">' + esc(err) + '</div>' : ''; }
  function nav(canSkip, nextLabel) {
    return '<div class="flex items-center justify-between pt-2">' +
      (wz.step > 0 && wz.step < 5 ? '<button type="button" onclick="wzGo(-1)" class="text-xs text-slate-600 hover:text-slate-900">← Atrás</button>' : '<span></span>') +
      '<div class="flex gap-2">' + (canSkip ? '<button type="button" onclick="wzSkip()" class="px-4 py-2 rounded-lg text-xs text-slate-700 bg-slate-100 hover:bg-slate-200">Omitir y continuar</button>' : '') +
      '<button class="px-5 py-2 rounded-lg text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white">' + (nextLabel || 'Guardar y continuar') + '</button></div></div>';
  }
  function card(inner) { return '<form novalidate onsubmit="wzSubmit(event)" class="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-2xl">' + inner + '</form>'; }

  window.startWizard = async function (mode) {
    wz.mode = mode || 'first';
    wz.step = 0; wz.done = {};
    wz.companyId = null; wz.company = {};
    if (wz.mode === 'edit' && window.pf && pf.auth.companyId) {
      wz.companyId = pf.auth.companyId;
      try { wz.company = await wzJson('/api/companies/' + wz.companyId); } catch (e) { /* */ }
    }
    _authShowing = true;
    renderStep();
  };

  function renderStep(err) {
    const c = wz.company || {};
    let body = '';
    if (wz.step === 0) {
      body = card('<p class="text-xs text-slate-600">Datos que aparecerán en el membrete de cotizaciones, órdenes de compra y catálogos.</p>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">' +
        field('Razón social', 'razon', c.razon_social, { req: true, span: 'md:col-span-2' }) +
        field('RUT de la empresa', 'rut', c.rut, { req: true, ph: '76.123.456-7' }) +
        field('Giro comercial', 'giro', c.giro) +
        field('Dirección', 'dir', c.direccion, { span: 'md:col-span-2' }) +
        field('Comuna', 'comuna', c.comuna) + field('Ciudad', 'ciudad', c.ciudad) +
        field('Teléfono', 'tel', c.telefono) + field('Correo institucional', 'mail', c.email, { type: 'email' }) +
        '</div>' + fileField('Logotipo oficial (PNG / JPG / WEBP, máx. 5 MB)', 'logo', 'image/png,image/jpeg,image/webp', c.logo_url ? 'Ya hay un logo cargado; sube otro solo para reemplazarlo.' : '') +
        errBox(err) + nav(true));
    } else if (wz.step === 1) {
      body = card('<p class="text-xs text-slate-600">Representante legal y firma/timbre digitalizados. Se estampan en anexos y bases de Mercado Público.</p>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">' + field('Nombre del representante legal', 'rep', wz.rep && wz.rep.name) + field('RUT del representante', 'reprut', wz.rep && wz.rep.rut) +
        fileField('Imagen de la firma (PNG con fondo transparente recomendado)', 'sig', 'image/png,image/jpeg,image/webp') +
        fileField('Imagen del timbre / sello', 'stamp', 'image/png,image/jpeg,image/webp') + '</div>' + errBox(err) + nav(true));
    } else if (wz.step === 2) {
      body = card('<p class="text-xs text-slate-600">La <b>Clave Tributaria</b> permite leer el Registro de Compras y Ventas (RCV) en vivo. El <b>certificado digital</b> es opcional y solo se usará para emitir DTE. Todo se guarda cifrado.</p>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">' + field('RUT (empresa)', 'sirut', (wz.sii && wz.sii.rut) || c.rut, { req: true }) +
        '<div><label class="block text-xs font-semibold text-slate-600 mb-1">Ambiente</label><select id="wz-siamb" class="' + PF_IN + ' !py-2 !text-sm"><option value="PRODUCCION">Producción (real)</option><option value="CERTIFICACION">Certificación (pruebas)</option></select></div>' +
        field('Clave Tributaria (Clave SII)', 'siclave', '', { type: 'password', ac: 'new-password', span: 'md:col-span-2' }) +
        fileField('Certificado digital .pfx / .p12 (opcional)', 'sicert', '.pfx,.p12') + field('Contraseña del certificado', 'sipass', '', { type: 'password', ac: 'new-password' }) + '</div>' +
        (wz.done.sii ? '<div class="text-xs text-emerald-700"><svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> ' + esc(wz.done.sii) + '</div>' : '') +
        errBox(err) + '<div class="flex items-center justify-between pt-2"><button type="button" onclick="wzGo(-1)" class="text-xs text-slate-600 hover:text-slate-900">← Atrás</button><div class="flex gap-2">' +
        '<button type="button" onclick="wzSkip()" class="px-4 py-2 rounded-lg text-xs text-slate-700 bg-slate-100 hover:bg-slate-200">Omitir y continuar</button>' +
        '<button type="button" onclick="wzSiiTest()" class="px-4 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700">Guardar y probar conexión</button>' +
        '<button class="px-5 py-2 rounded-lg text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white">Guardar y continuar</button></div></div>');
    } else if (wz.step === 3) {
      body = card('<p class="text-xs text-slate-600">Conexión bancaria de solo lectura con <b>Fintoc</b>. Ingresa las claves <b>LIVE</b> (cuenta real) y/o <b>TEST</b> (pruebas) de dashboard.fintoc.com. También pueden venir del archivo <code>.env</code> (FINTOC_API_KEY / FINTOC_SECRET_KEY y variantes _TEST). Se guardan cifradas.</p>' +
        '<div class="flex gap-5 text-xs text-slate-700"><label><input type="radio" name="wz-fmode" value="LIVE" ' + (wz.fmode !== 'TEST' ? 'checked' : '') + '> Modo activo: LIVE</label><label><input type="radio" name="wz-fmode" value="TEST" ' + (wz.fmode === 'TEST' ? 'checked' : '') + '> Modo activo: TEST (no guarda datos)</label></div>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">' + field('LIVE · Secret key (sk_live_…)', 'fsec', '', { type: 'password', ac: 'new-password' }) + field('LIVE · API key pública (pk_live_…)', 'fpub', '') +
        field('TEST · Secret key (sk_test_…)', 'fsect', '', { type: 'password', ac: 'new-password' }) + field('TEST · API key pública (pk_test_…)', 'fpubt', '') + '</div>' +
        (wz.done.bank ? '<div class="text-xs text-emerald-700"><svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> ' + esc(wz.done.bank) + '</div>' : '') +
        errBox(err) + '<div class="flex items-center justify-between pt-2"><button type="button" onclick="wzGo(-1)" class="text-xs text-slate-600 hover:text-slate-900">← Atrás</button><div class="flex gap-2">' +
        '<button type="button" onclick="wzSkip()" class="px-4 py-2 rounded-lg text-xs text-slate-700 bg-slate-100 hover:bg-slate-200">Omitir y continuar</button>' +
        '<button type="button" onclick="wzBankWidget()" class="px-4 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700">Guardar y conectar banco (widget)</button>' +
        '<button class="px-5 py-2 rounded-lg text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white">Guardar y continuar</button></div></div>');
    } else if (wz.step === 4) {
      body = card('<p class="text-xs text-slate-600"><b>Motor de IA</b> para leer bases/PDFs de licitaciones y desglosar productos. Sin clave se usa el análisis local por reglas.</p>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-3"><div><label class="block text-xs font-semibold text-slate-600 mb-1">Proveedor</label><select id="wz-aiprov" class="' + PF_IN + ' !py-2 !text-sm"><option value="gemini">Google Gemini (recomendado, lee escaneados)</option><option value="anthropic">Anthropic Claude</option><option value="openai">OpenAI / compatible</option></select></div>' +
        field('Modelo (opcional)', 'aimodel', '') + field('API Key de IA', 'aikey', '', { type: 'password', ac: 'new-password', span: 'md:col-span-2' }) + '</div>' +
        (wz.done.ai ? '<div class="text-xs text-emerald-700"><svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> ' + esc(wz.done.ai) + '</div>' : '') +
        '<div class="border-t border-slate-200 pt-3 text-xs text-slate-600"><b>Correo de salida</b> para enviar cotizaciones y órdenes de compra desde la app.</div>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-3"><div><label class="block text-xs font-semibold text-slate-600 mb-1">Proveedor de correo</label><select id="wz-mprov" onchange="wzMailToggle()" class="' + PF_IN + ' !py-2 !text-sm"><option value="SMTP">SMTP (Gmail, Outlook, hosting)</option><option value="RESEND">Resend</option><option value="SENDGRID">SendGrid</option></select></div>' +
        field('Correo remitente', 'mfrom', '', { type: 'email' }) +
        '<div id="wz-smtp" class="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">' + field('Servidor SMTP', 'mhost', '', { ph: 'smtp.gmail.com' }) + field('Puerto', 'mport', '587') +
        '<div><label class="block text-xs font-semibold text-slate-600 mb-1">Seguridad</label><select id="wz-msec" class="' + PF_IN + ' !py-2 !text-sm"><option>STARTTLS</option><option>SSL</option><option>NONE</option></select></div>' +
        field('Usuario', 'muser', '') + field('Contraseña (de aplicación)', 'mpass', '', { type: 'password', ac: 'new-password', span: 'md:col-span-2' }) + '</div>' +
        '<div id="wz-mkey" class="md:col-span-2 hidden">' + field('API key (Resend / SendGrid)', 'mapi', '', { type: 'password', ac: 'new-password' }) + '</div></div>' +
        (wz.done.mail ? '<div class="text-xs text-emerald-700"><svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> ' + esc(wz.done.mail) + '</div>' : '') +
        errBox(err) + '<div class="flex items-center justify-between pt-2"><button type="button" onclick="wzGo(-1)" class="text-xs text-slate-600 hover:text-slate-900">← Atrás</button><div class="flex gap-2">' +
        '<button type="button" onclick="wzSkip()" class="px-4 py-2 rounded-lg text-xs text-slate-700 bg-slate-100 hover:bg-slate-200">Omitir y continuar</button>' +
        '<button type="button" onclick="wzAiTest()" class="px-4 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700">Guardar y probar IA</button>' +
        '<button class="px-5 py-2 rounded-lg text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white">Guardar y continuar</button></div></div>');
    } else {
      const li = function (ok, t) { return '<li class="flex items-center gap-2 text-sm ' + (ok ? 'text-emerald-700' : 'text-slate-600') + '">' + (ok ? '<svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' : '○') + ' ' + t + '</li>'; };
      body = '<div class="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-2xl"><p class="text-sm text-slate-700">Resumen de la configuración de <b>' + esc(c.razon_social || '') + '</b>:</p><ul class="space-y-1.5">' +
        li(!!wz.done.company, 'Datos básicos y membrete') + li(!!wz.done.logo, 'Logotipo') + li(!!wz.done.rep, 'Representante legal') + li(!!wz.done.sig, 'Firma digitalizada') + li(!!wz.done.stamp, 'Timbre') +
        li(!!wz.done.sii, 'Integración SII') + li(!!wz.done.bank, 'Integración bancaria') + li(!!wz.done.ai, 'Motor de IA') + li(!!wz.done.mail, 'Correo de salida') + '</ul>' +
        '<p class="text-[11px] text-slate-500">Lo omitido se puede completar luego en <b>Multi-Empresa &amp; Config</b> (botón «Asistente de configuración»).</p>' +
        '<button onclick="wzFinish()" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg py-3 text-sm">Abrir el Dashboard</button></div>';
    }
    shell(header() + body, true);
  }

  window.wzGo = function (d) { wz.step = Math.max(0, Math.min(5, wz.step + d)); renderStep(); };
  window.wzSkip = function () { wz.errors = {}; wz.step = Math.min(5, wz.step + 1); renderStep(); };
  window.wzJump = function (i) { wz.errors = {}; wz.step = Math.max(0, Math.min(5, i)); renderStep(); };

async function saveCompany() {
    const c = wz.company = Object.assign({}, wz.company, { rut: val('rut'), razon_social: val('razon'), giro: val('giro'), direccion: val('dir'),
      comuna: val('comuna'), ciudad: val('ciudad'), telefono: val('tel'), email: val('mail') });
    const errs = {};
    if (!c.razon_social) errs.razon = 'Ingresa la razón social';
    const clean = String(c.rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
    if (!/^\d{7,8}[0-9K]$/.test(clean)) errs.rut = 'Formato de RUT no válido (ej: 76.123.456-7)';
    if (c.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) errs.mail = 'Ingresa un correo válido';
    if (Object.keys(errs).length) { wz.errors = errs; throw new Error('Revisa los campos marcados en rojo'); }
    const payload = {
      rut: clean.slice(0, -1) + '-' + clean.slice(-1), razon_social: c.razon_social, giro: c.giro, direccion: c.direccion, comuna: c.comuna, ciudad: c.ciudad,
      telefono: c.telefono, email: c.email, logo_url: c.logo_url || '', ppm_rate: c.ppm_rate || 1.5, is_default: 1
    };
    if (wz.companyId) {
      await wzJson('/api/companies/' + wz.companyId, pfJsonOpts('PUT', payload));
    } else {
      const r = await wzJson('/api/companies/', pfJsonOpts('POST', payload));
      wz.companyId = r.id;
    }
    await wzJson('/api/auth/select-company', pfJsonOpts('POST', { company_id: wz.companyId }));
    pf.auth.companyId = wz.companyId;
    try { _authResolve(); } catch (e) { /* ya resuelto */ }
    const lf = fileOf('logo');
    wz.company = await wzJson('/api/companies/' + wz.companyId);
    wz.done.company = true;
    if (lf) {
      try {
        const fd = new FormData(); fd.append('file', lf);
        const res = await _origFetch('/api/companies/' + wz.companyId + '/logo', { method: 'POST', body: fd });
        const b = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(b.detail || 'No se pudo subir el logo');
        wz.company.logo_url = b.logo_url; wz.done.logo = true;
      } catch (le) { showToast('Empresa guardada, pero el logo no se pudo subir (' + le.message + '). Puedes subirlo después.', 'error'); }
    } else if (wz.company.logo_url) { wz.done.logo = true; }
  }

    async function saveSigner() {
    const name = val('rep');
    const sigF = fileOf('sig'), stF = fileOf('stamp');
    if (!name && !sigF && !stF) return;
    if (!name) throw new Error('Indica el nombre del representante legal');
    const body = { name: name, rut: val('reprut'), role: 'Representante Legal' };
    if (sigF) body.signature_data_url = await toDataUrl(sigF);
    if (stF) body.stamp_data_url = await toDataUrl(stF);
    await wzJson('/api/workspace/signer-profile', pfJsonOpts('PUT', body));
    wz.rep = { name: name, rut: val('reprut') };
    wz.done.rep = true; if (sigF) wz.done.sig = true; if (stF) wz.done.stamp = true;
  }

  async function saveSii() {
    const rut = val('sirut'), clave = val('siclave'), cert = fileOf('sicert');
    if (!clave && !cert) return false;
    const fd = new FormData();
    fd.append('rut', rut); fd.append('ambiente', val('siamb') || document.getElementById('wz-siamb').value);
    fd.append('clave', clave); fd.append('password', val('sipass'));
    if (cert) fd.append('file', cert);
    const res = await _origFetch('/api/integrations/sii/config', { method: 'POST', body: fd });
    const b = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(b.detail || 'No se pudo guardar la configuración SII');
    wz.sii = { rut: rut }; wz.done.sii = 'Credenciales SII guardadas (cifradas)';
    return true;
  }

  async function saveBank() {
    const o = {};
    const sec = val('fsec'), pub = val('fpub'), sect = val('fsect'), pubt = val('fpubt');
    const mEl = document.querySelector('input[name="wz-fmode"]:checked');
    o.mode = mEl ? mEl.value : 'LIVE'; wz.fmode = o.mode;
    if (!sec && !pub && !sect && !pubt) return false;
    if (sec) o.secret_key = sec; if (pub) o.public_key = pub; if (sect) o.secret_key_test = sect; if (pubt) o.public_key_test = pubt;
    const r = await wzJson('/api/integrations/bank/config', pfJsonOpts('POST', o));
    wz.done.bank = r.message; return true;
  }

  async function saveAiMail() {
    const key = val('aikey');
    if (key) {
      await wzJson('/api/workspace/ai-settings', pfJsonOpts('PUT', { provider: document.getElementById('wz-aiprov').value, model: val('aimodel'), api_key: key }));
      wz.done.ai = 'Clave de IA guardada';
    }
    const from = val('mfrom'), prov = document.getElementById('wz-mprov').value;
    if (from && (val('mhost') || val('mapi'))) {
      const b = { provider: prov, from_email: from, host: val('mhost'), port: parseInt(val('mport'), 10) || 587, security: document.getElementById('wz-msec').value, username: val('muser') };
      if (val('mpass')) b.password = val('mpass');
      if (val('mapi')) b.api_key = val('mapi');
      const r = await wzJson('/api/email/config', pfJsonOpts('POST', b));
      wz.done.mail = r.message;
    }
  }

  window.wzMailToggle = function () {
    const s = document.getElementById('wz-mprov').value === 'SMTP';
    document.getElementById('wz-smtp').classList.toggle('hidden', !s);
    document.getElementById('wz-mkey').classList.toggle('hidden', s);
  };
  window.wzAiTest = async function () {
    try {
      await saveAiMail();
      const r = await wzJson('/api/workspace/ai-settings/test', { method: 'POST' });
      if (!r.ok) throw new Error(r.message);
      wz.done.ai = r.message; renderStep();
    } catch (err) { renderStep(err.message); }
  };

  window.wzSubmit = async function (e) {
    e.preventDefault();
    wz.errors = {};
    const sb = e.target && e.target.querySelector('button:not([type])');
    if (sb) { sb.disabled = true; sb.textContent = 'Guardando…'; }
    try {
      if (wz.step >= 1 && wz.step <= 4 && !wz.companyId) throw new Error('Primero guarda los datos de la Empresa (paso 1), o usa «Omitir y continuar».');
      if (wz.step === 0) await saveCompany();
      else if (wz.step === 1) await saveSigner();
      else if (wz.step === 2) await saveSii();
      else if (wz.step === 3) await saveBank();
      else if (wz.step === 4) await saveAiMail();
      wz.step++; renderStep();
    } catch (err) { console.error('[asistente] paso ' + (wz.step + 1), err); renderStep(err.message); }
  };

  window.wzSiiTest = async function () {
    try {
      if (!(await saveSii()) && !wz.done.sii) throw new Error('Ingresa la Clave Tributaria para probar la conexión');
      const r = await wzJson('/api/integrations/sii/test', { method: 'POST' });
      wz.done.sii = r.message; renderStep();
    } catch (err) { renderStep(err.message); }
  };

  window.wzBankWidget = async function () {
    try {
      await saveBank();
      const cfg = await wzJson('/api/integrations/bank/config');
      if (!cfg.has_secret || !cfg.public_key) throw new Error('Ingresa la clave secreta y la API key pública de Fintoc del modo activo');
      await bankWidget();
      const c2 = await wzJson('/api/integrations/bank/config');
      if (c2.has_link) wz.done.bank = 'Banco conectado' + (c2.institution ? ': ' + c2.institution : '');
      renderStep();
    } catch (err) { renderStep(err.message); }
  };

  window.wzFinish = function () {
    if (!wz.companyId && wz.mode !== 'edit') { wz.step = 0; renderStep('Para abrir el Dashboard guarda al menos la Razón social y el RUT de la empresa.'); return; }
    location.reload();
  };

  // al iniciar sesión / elegir empresa sin wizard, mantener URL actual
  const _origSelect = window.selectCompany;
  window.selectCompany = async function (id) {
    try { if (location.pathname === '/login') history.replaceState(null, '', '/'); } catch (e) { /* */ }
    return _origSelect(id);
  };

  // botón para reabrir el asistente desde Multi-Empresa & Config
  const _origSwitch = window.switchTab;
  if (typeof _origSwitch === 'function') {
    window.switchTab = function (tab) {
      const r = _origSwitch.apply(this, arguments);
      if (tab === 'companies') {
        setTimeout(function () {
          const v = document.getElementById('view-companies');
          if (v && !document.getElementById('wz-reopen')) {
            const b = document.createElement('button');
            b.id = 'wz-reopen'; b.className = PF_BTN + ' bg-emerald-600 hover:bg-emerald-700 text-white mb-3';
            b.textContent = '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg> Asistente de configuración (datos, logo, firma, timbre, SII, banco)';
            b.onclick = function () { startWizard('edit'); };
            v.insertBefore(b, v.firstChild);
          }
        }, 50);
      }
      return r;
    };
  }
})();
