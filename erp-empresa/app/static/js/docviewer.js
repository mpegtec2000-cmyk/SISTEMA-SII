/* Visor interactivo de documentos (pdf.js) con capa de edición: textos, firma guardada / rúbrica y PDF final. */
(function () {
  var dv = { docId: null, pdf: null, anns: [], scale: 1.3, sel: null, pad: null, mode: null, saved: null, dirty: false, name: '' };
  window.dv = dv;

  function el(id) { return document.getElementById(id); }
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t); else alert(m); }

  function ensureModal() {
    if (el('dv-modal')) return;
    var d = document.createElement('div');
    d.id = 'dv-modal';
    d.className = 'hidden fixed inset-0 z-[70] bg-slate-900/45 flex flex-col';
    d.innerHTML =
      '<div class="bg-white border-b border-slate-200 px-4 py-2 flex flex-wrap items-center gap-2 text-xs">' +
      '<div id="dv-title" class="font-bold text-slate-950 text-sm mr-3 truncate max-w-xs"></div>' +
      '<button onclick="dvAddText()" class="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold"><svg class="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Campo de texto</button>' +
      '<button onclick="dvStampSaved()" class="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 2 4 4-12 12H6v-4L18 2z"/><path d="m14 6 4 4"/></svg> Estampar firma guardada</button>' +
      '<button onclick="dvStampTimbre()" class="px-3 py-1.5 rounded bg-fuchsia-700 hover:bg-fuchsia-600 text-white font-bold"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg> Estampar timbre</button>' +
      '<button onclick="dvOpenPad()" class="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 2 4 4-12 12H6v-4L18 2z"/></svg> Dibujar rúbrica</button>' +
      '<span class="text-slate-500">|</span>' +
      '<button onclick="dvZoom(-0.2)" class="px-2 py-1.5 rounded bg-slate-100 text-slate-800 font-bold">−</button>' +
      '<button onclick="dvZoom(0.2)" class="px-2 py-1.5 rounded bg-slate-100 text-slate-800 font-bold">＋</button>' +
      '<span id="dv-status" class="text-slate-600 ml-2"></span>' +
      '<div class="ml-auto space-x-2">' +
      '<button onclick="dvSave()" class="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Guardar cambios</button>' +
      '<button onclick="dvDownload()" class="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold">⬇️ Generar y descargar PDF final</button>' +
      '<button onclick="dvClose()" class="px-3 py-1.5 rounded bg-slate-100 text-slate-800 font-bold">Cerrar <svg class="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div></div>' +
      '<div id="dv-pages" class="flex-1 overflow-auto bg-slate-200 p-4 space-y-4 text-center"></div>' +
      '<div id="dv-pad" class="hidden absolute inset-0 bg-slate-900/45 flex items-center justify-center"><div class="bg-white border border-slate-200 rounded-xl p-4 space-y-3 shadow-xl">' +
      '<div class="text-sm font-bold text-slate-950">Dibuja tu rúbrica</div>' +
      '<canvas id="dv-pad-canvas" width="420" height="160" class="bg-white border border-slate-300 rounded cursor-crosshair touch-none"></canvas>' +
      '<div class="flex gap-2 justify-end text-xs"><button onclick="dvPadClear()" class="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300">Limpiar</button>' +
      '<button onclick="dvPadCancel()" class="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300">Cancelar</button>' +
      '<button onclick="dvPadUse()" class="px-3 py-1.5 rounded bg-indigo-600 text-white font-bold">Usar rúbrica</button></div></div></div>';
    document.body.appendChild(d);
    var c = el('dv-pad-canvas'), ctx = c.getContext('2d'), drawing = false;
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#111827';
    function pos(e) { var r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height }; }
    c.addEventListener('pointerdown', function (e) { drawing = true; var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', function (e) { if (!drawing) return; var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
    c.addEventListener('pointerup', function () { drawing = false; });
  }

  function setStatus(t) { var s = el('dv-status'); if (s) s.textContent = t || ''; }

  window.openDocViewer = async function (docId) {
    ensureModal();
    if (typeof pdfjsLib === 'undefined') { toast('No se cargó el visor PDF (pdf.js).', 'error'); return; }
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/static/vendor/pdf.worker.min.js';
    dv.docId = docId; dv.anns = []; dv.dirty = false;
    el('dv-modal').classList.remove('hidden');
    el('dv-pages').innerHTML = '<div class="text-slate-700 text-sm py-10">Cargando documento…</div>';
    try {
      var meta = await wsApi('/api/workspace/documents/' + docId + '/annotations');
      dv.anns = meta.annotations || []; dv.name = meta.name || 'Documento';
      el('dv-title').textContent = '<svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> ' + dv.name;
      var resp = await fetch('/api/workspace/documents/' + docId + '/view-pdf', { credentials: 'same-origin' });
      if (!resp.ok) { var j = {}; try { j = await resp.json(); } catch (e) { } throw new Error(j.detail || ('Error ' + resp.status)); }
      var buf = await resp.arrayBuffer();
      dv.pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      await renderAll();
    } catch (e) {
      el('dv-pages').innerHTML = '<div class="text-red-700 text-sm py-10">No se pudo abrir el documento: ' + esc(e.message || String(e)) + '</div>';
    }
  };

  async function renderAll() {
    var host = el('dv-pages'); host.innerHTML = '';
    for (var n = 1; n <= dv.pdf.numPages; n++) {
      var page = await dv.pdf.getPage(n);
      var vp = page.getViewport({ scale: dv.scale });
      var wrap = document.createElement('div');
      wrap.className = 'relative inline-block bg-white shadow-xl mx-auto';
      wrap.style.width = vp.width + 'px'; wrap.style.height = vp.height + 'px';
      wrap.dataset.page = n;
      var cv = document.createElement('canvas');
      cv.width = vp.width; cv.height = vp.height; cv.style.display = 'block';
      var ov = document.createElement('div');
      ov.className = 'absolute inset-0'; ov.dataset.overlay = n;
      ov.style.cursor = 'default';
      wrap.appendChild(cv); wrap.appendChild(ov);
      var lab = document.createElement('div');
      lab.className = 'text-slate-600 text-xs'; lab.textContent = 'Página ' + n + ' de ' + dv.pdf.numPages;
      host.appendChild(wrap); host.appendChild(lab);
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      wrap._pt = { w: vp.width / dv.scale, h: vp.height / dv.scale };
    }
    drawAnns();
  }

  function pageWrap(n) { return document.querySelector('#dv-pages [data-page="' + n + '"]'); }
  function visiblePage() {
    var host = el('dv-pages'), best = 1, bd = 1e9, mid = host.scrollTop + host.clientHeight / 2;
    host.querySelectorAll('[data-page]').forEach(function (w) {
      var c = w.offsetTop + w.offsetHeight / 2, d = Math.abs(c - mid);
      if (d < bd) { bd = d; best = parseInt(w.dataset.page, 10); }
    });
    return best;
  }

  function drawAnns() {
    document.querySelectorAll('#dv-pages [data-overlay]').forEach(function (o) { o.innerHTML = ''; });
    dv.anns.forEach(function (a, i) {
      var w = pageWrap(a.page); if (!w) return;
      var ov = w.querySelector('[data-overlay]');
      var W = w.offsetWidth, H = w.offsetHeight;
      var box = document.createElement('div');
      box.style.position = 'absolute'; box.style.left = (a.x * W) + 'px'; box.style.top = (a.y * H) + 'px';
      box.className = 'group border border-dashed border-blue-400/70 bg-blue-100/20';
      var bar = '<div class="hidden group-hover:flex absolute -top-6 left-0 bg-white text-slate-950 text-[10px] rounded overflow-hidden whitespace-nowrap z-10">' +
        '<span class="px-1.5 py-1 cursor-move" data-drag="' + i + '">↔ mover</span>' +
        '<button class="px-1.5 py-1 hover:bg-slate-200" onclick="dvSize(' + i + ',1)">＋</button>' +
        '<button class="px-1.5 py-1 hover:bg-slate-200" onclick="dvSize(' + i + ',-1)">−</button>' +
        '<button class="px-1.5 py-1 hover:bg-red-600" onclick="dvDel(' + i + ')"><svg class="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
      if (a.type === 'image') {
        box.style.width = (a.w * W) + 'px'; box.style.height = (a.h * H) + 'px';
        var footerHtml = '';
        if (a.footer && (a.footer.name || a.footer.rut || a.footer.company)) {
          footerHtml = '<div class="absolute top-full left-0 w-full pt-1 border-t border-slate-200 text-left pointer-events-none bg-white/95 px-1.5 py-1 shadow-sm rounded-b" style="min-width:140px;">' +
            '<div style="font-size:9.5px;font-weight:bold;color:#0f172a;line-height:1.2;">' + esc(a.footer.name || '') + '</div>' +
            '<div style="font-size:8.5px;color:#334155;line-height:1.1;">RUT: ' + esc(a.footer.rut || '') + '</div>' +
            '<div style="font-size:8.5px;font-weight:600;color:#1e3a8a;line-height:1.1;">' + esc(a.footer.company || '') + '</div>' +
          '</div>';
        }
        box.innerHTML = bar + '<img src="' + a.data_url + '" style="width:100%;height:100%;object-fit:contain;pointer-events:none">' + footerHtml;
      } else {
        var px = (a.size || 11) * dv.scale;
        box.innerHTML = bar + '<textarea rows="1" data-ta="' + i + '" placeholder="Escriba aquí…" style="font-family:Helvetica,Arial,sans-serif;font-size:' + px + 'px;line-height:1.2;color:#0d0d59;background:transparent;border:0;outline:0;resize:none;overflow:hidden;min-width:' + (px * 8) + 'px;padding:0 2px"></textarea>';
        var ta = box.querySelector('textarea'); ta.value = a.text || '';
        var fit = function () { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; ta.style.width = Math.max(px * 8, ta.scrollWidth) + 'px'; };
        ta.addEventListener('input', function () { a.text = ta.value; dv.dirty = true; fit(); });
        setTimeout(fit, 0);
      }
      ov.appendChild(box);
      var h = box.querySelector('[data-drag]');
      if (h) h.addEventListener('pointerdown', function (e) { startDrag(e, a, box, w); });
    });
  }

  function startDrag(e, a, box, w) {
    e.preventDefault();
    var sx = e.clientX, sy = e.clientY, ox = a.x, oy = a.y, W = w.offsetWidth, H = w.offsetHeight;
    function mv(ev) {
      a.x = Math.min(0.98, Math.max(0, ox + (ev.clientX - sx) / W));
      a.y = Math.min(0.98, Math.max(0, oy + (ev.clientY - sy) / H));
      box.style.left = (a.x * W) + 'px'; box.style.top = (a.y * H) + 'px'; dv.dirty = true;
    }
    function up() { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); }
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
  }

  window.dvAddText = function () {
    var n = visiblePage();
    dv.anns.push({ type: 'text', page: n, x: 0.1, y: 0.1 + (dv.anns.length % 8) * 0.05, size: 11, text: '' });
    dv.dirty = true; drawAnns();
    setTimeout(function () { var t = document.querySelector('[data-ta="' + (dv.anns.length - 1) + '"]'); if (t) t.focus(); }, 30);
  };

  function addImage(dataUrl, footerInfo) {
    var n = visiblePage(), w = pageWrap(n), img = new Image();
    img.onload = function () {
      var wf = 0.28, ratio = img.height / img.width;
      var hf = wf * ratio * (w.offsetWidth / w.offsetHeight);
      var annObj = { 
        type: 'image', 
        page: n, 
        x: 0.55, 
        y: Math.max(0.05, 0.72 - Math.min(hf, 0.25)), 
        w: wf, 
        h: hf, 
        data_url: dataUrl 
      };
      if (footerInfo && (footerInfo.name || footerInfo.rut || footerInfo.company)) {
        annObj.footer = footerInfo;
      }
      dv.anns.push(annObj);
      dv.dirty = true; drawAnns();
      toast('Firma estampada con pie de datos del representante.');
    };
    img.src = dataUrl;
  }

  window.dvStampSaved = async function () {
    try {
      var p = await wsApi('/api/workspace/signer-profile');
      if (!p || !p.signature_data_url) { toast('No hay firma guardada. Guárdala en Multi-Empresa & Config o dibuja una rúbrica.', 'error'); return; }
      var comp = p.company_name || (typeof state !== 'undefined' && state.currentCompany ? state.currentCompany.razon_social : '') || '';
      var footer = {
        name: p.name || 'Representante Legal',
        rut: p.rut || '',
        company: comp
      };
      addImage(p.signature_data_url, footer);
    } catch (e) { toast(e.message, 'error'); }
  };
  window.dvStampTimbre = async function () {
    try {
      var p = await wsApi('/api/workspace/signer-profile');
      if (!p || !p.stamp_data_url) { toast('No hay timbre guardado. Cárgalo en el Asistente de configuración (Multi-Empresa & Config).', 'error'); return; }
      addImage(p.stamp_data_url, null);
    } catch (e) { toast(e.message, 'error'); }
  };
  window.dvOpenPad = function () { dvPadClear(); el('dv-pad').classList.remove('hidden'); };
  window.dvPadClear = function () { var c = el('dv-pad-canvas'); c.getContext('2d').clearRect(0, 0, c.width, c.height); };
  window.dvPadCancel = function () { el('dv-pad').classList.add('hidden'); };
  window.dvPadUse = async function () { 
    var dataUrl = el('dv-pad-canvas').toDataURL('image/png'); 
    el('dv-pad').classList.add('hidden'); 
    var p = {};
    try { p = await wsApi('/api/workspace/signer-profile'); } catch(e){}
    var comp = p.company_name || (typeof state !== 'undefined' && state.currentCompany ? state.currentCompany.razon_social : '') || '';
    var footer = {
      name: p.name || 'Representante Legal',
      rut: p.rut || '',
      company: comp
    };
    addImage(dataUrl, footer); 
  };

  window.dvSize = function (i, d) {
    var a = dv.anns[i]; if (!a) return;
    if (a.type === 'image') { var f = d > 0 ? 1.15 : 0.87; a.w *= f; a.h *= f; }
    else a.size = Math.max(6, Math.min(40, (a.size || 11) + d));
    dv.dirty = true; drawAnns();
  };
  window.dvDel = function (i) { dv.anns.splice(i, 1); dv.dirty = true; drawAnns(); };
  window.dvZoom = async function (d) { dv.scale = Math.min(2.5, Math.max(0.7, dv.scale + d)); await renderAll(); };

  window.dvSave = async function (quiet) {
    try {
      var clean = dv.anns.filter(function (a) { return a.type === 'image' || (a.text || '').trim(); });
      await wsApi('/api/workspace/documents/' + dv.docId + '/annotations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ annotations: clean }) });
      dv.dirty = false; setStatus('Guardado <svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>');
      if (!quiet) toast('Cambios guardados');
      return true;
    } catch (e) { toast(e.message, 'error'); return false; }
  };

  window.dvDownload = async function () {
    if (!(await dvSave(true))) return;
    setStatus('Generando PDF…');
    try {
      var r = await fetch('/api/workspace/documents/' + dv.docId + '/annotated-pdf', { credentials: 'same-origin' });
      if (!r.ok) { var j = {}; try { j = await r.json(); } catch (e) { } throw new Error(j.detail || ('Error ' + r.status)); }
      var blob = await r.blob();
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = (dv.name || 'documento').replace(/[^\w\-. ()áéíóúñÁÉÍÓÚÑ]+/g, '_') + '_final.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      setStatus('PDF descargado <svg class="w-3.5 h-3.5 inline text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'); toast('PDF final generado y descargado');
      if (typeof loadWorkspace === 'function') loadWorkspace();
    } catch (e) { setStatus(''); toast('No se pudo generar el PDF: ' + e.message, 'error'); }
  };

  window.dvClose = async function () {
    if (dv.dirty && confirm('Hay cambios sin guardar. ¿Guardarlos antes de cerrar?')) await dvSave(true);
    el('dv-modal').classList.add('hidden'); dv.pdf = null;
    if (typeof loadWorkspace === 'function' && typeof ws !== 'undefined' && ws.id) loadWorkspace();
  };

  // descarga robusta (PDF original o final) sin depender de enlaces/popup
  window.dvDownloadFile = async function (url, filename) {
    try {
      var r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) { var j = {}; try { j = await r.json(); } catch (e) { } throw new Error(j.detail || ('Error ' + r.status)); }
      var blob = await r.blob(), u = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = u; a.download = filename || 'documento.pdf'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 5000);
    } catch (e) { toast('No se pudo descargar: ' + e.message, 'error'); }
  };
})();
