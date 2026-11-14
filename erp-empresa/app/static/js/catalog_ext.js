/* Catálogo: galería de imágenes por producto (agregar / ordenar / eliminar) y portada personalizable del catálogo. */
(function () {
  var _origEdit = catEditOpen;
  catEditOpen = function (id) {
    _origEdit(id);
    setTimeout(function () { galleryMount(id); }, 0);
  };

  function galleryMount(id) {
    var modal = document.getElementById('pf-modal'); if (!modal) return;
    var form = modal.querySelector('form'); if (!form) return;
    var col = form.querySelector('.md\\:col-span-2'); if (!col) return;
    var keep = form.querySelector('input[name="image_url"]');
    var oldUrl = keep ? keep.value : '';
    col.innerHTML = '<input type="hidden" name="image_url" value="' + esc(oldUrl) + '">' +
      '<div class="flex items-center justify-between"><span class="text-slate-700 font-bold"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg> Galería de imágenes</span><span class="text-[10px] text-slate-500">La 1.ª es la principal</span></div>' +
      '<div id="cat-gallery" class="grid grid-cols-2 gap-2"></div>' +
      '<label class="block text-slate-600">Agregar fotos (una o varias)<input type="file" accept="image/*" multiple onchange="catGalleryUpload(' + id + ', this.files); this.value=\'\'" class="' + PF_IN + ' mt-1"></label>' +
      '<div class="flex gap-1"><input id="cat-gal-url" placeholder="o pega la URL de una imagen" class="' + PF_IN + '"><button type="button" onclick="catGalleryUrl(' + id + ')" class="' + PF_BTN + ' bg-slate-100 hover:bg-slate-200 text-slate-950 border border-slate-300 whitespace-nowrap">Agregar</button></div>';
    galleryLoad(id);
  }

  async function galleryLoad(id) {
    var host = document.getElementById('cat-gallery'); if (!host) return;
    try {
      var imgs = await pfJson('/api/catalog/products/' + id + '/images');
      galleryDraw(id, imgs);
    } catch (e) { host.innerHTML = '<span class="text-rose-700 col-span-2">' + esc(e.message) + '</span>'; }
  }

  function galleryDraw(id, imgs) {
    var host = document.getElementById('cat-gallery'); if (!host) return;
    window._catGal = { id: id, imgs: imgs };
    if (!imgs.length) { host.innerHTML = '<div class="col-span-2 h-24 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-center text-slate-600">Sin imágenes</div>'; return; }
    host.innerHTML = imgs.map(function (im, i) {
      return '<div class="relative bg-slate-50 border ' + (i === 0 ? 'border-blue-500' : 'border-slate-200') + ' rounded-lg overflow-hidden h-28 flex items-center justify-center">' +
        '<img src="' + im.url + '" class="max-h-full max-w-full object-contain">' +
        (i === 0 ? '<span class="absolute top-1 left-1 text-[9px] font-bold bg-blue-600 text-white rounded px-1">Principal</span>' : '') +
        '<div class="absolute bottom-0 inset-x-0 flex justify-between bg-slate-900/85 text-white text-[11px]">' +
        '<button type="button" ' + (i === 0 ? 'disabled style="opacity:.3"' : '') + ' onclick="catGalleryMove(' + i + ',-1)" class="px-2 py-1" title="Mover antes">◀</button>' +
        '<button type="button" onclick="catGalleryDelete(' + im.id + ')" class="px-2 py-1 hover:text-rose-700" title="Eliminar"><svg class="w-3.5 h-3.5 inline text-zinc-400 hover:text-rose-600 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
        '<button type="button" ' + (i === imgs.length - 1 ? 'disabled style="opacity:.3"' : '') + ' onclick="catGalleryMove(' + i + ',1)" class="px-2 py-1" title="Mover después">▶</button></div></div>';
    }).join('');
  }

  window.catGalleryUpload = async function (id, files) {
    if (!files || !files.length) return;
    var fd = new FormData(); Array.prototype.forEach.call(files, function (f) { fd.append('files', f); });
    try { var r = await pfJson('/api/catalog/products/' + id + '/images', { method: 'POST', body: fd }); galleryDraw(id, r.images); showToast(r.message); renderCatalog(); }
    catch (e) { showToast(e.message, 'error'); }
  };
  window.catGalleryUrl = async function (id) {
    var u = document.getElementById('cat-gal-url').value.trim(); if (!u) return;
    var fd = new FormData(); fd.append('url', u);
    try { var r = await pfJson('/api/catalog/products/' + id + '/images', { method: 'POST', body: fd }); galleryDraw(id, r.images); document.getElementById('cat-gal-url').value = ''; renderCatalog(); }
    catch (e) { showToast(e.message, 'error'); }
  };
  window.catGalleryDelete = async function (imgId) {
    if (!confirm('¿Eliminar esta imagen?')) return;
    try { var r = await pfJson('/api/catalog/images/' + imgId, { method: 'DELETE' }); galleryDraw(_catGal.id, r.images); renderCatalog(); }
    catch (e) { showToast(e.message, 'error'); }
  };
  window.catGalleryMove = async function (i, d) {
    var g = _catGal, j = i + d; if (!g || j < 0 || j >= g.imgs.length) return;
    var ids = g.imgs.map(function (x) { return x.id; }); var t = ids[i]; ids[i] = ids[j]; ids[j] = t;
    try { var r = await pfJson('/api/catalog/products/' + g.id + '/images/order', pfJsonOpts('PUT', { ids: ids })); galleryDraw(g.id, r.images); renderCatalog(); }
    catch (e) { showToast(e.message, 'error'); }
  };

  // ------------------------------------------------------------ portada del catálogo
  catPdfOpen = async function () {
    var n = pf.cat.selected.size, cv = { title: 'Catálogo de Productos', subtitle: '', has_cover: false, has_logo: false };
    try { cv = await pfJson('/api/catalog/cover'); } catch (e) { /* valores por defecto */ }
    var t = Date.now();
    pfModal('Generar catálogo comercial (PDF)', '<form onsubmit="catPdfRun(event)" class="space-y-3 text-xs">' +
      '<p class="text-slate-600">' + (n ? 'Se incluirán los <b>' + n + '</b> producto(s) seleccionados.' : 'No hay selección: se incluirán todos los productos marcados "Incluir en el catálogo".') + '</p>' +
      '<div class="rounded-lg border border-slate-200 p-3 space-y-3"><div class="font-bold text-slate-900"><svg class="w-3.5 h-3.5 inline text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2Z"/></svg> Portada del catálogo</div>' +
      '<div><label class="block text-slate-600 mb-1">Título principal</label><input name="title" value="' + esc(cv.title) + '" class="' + PF_IN + '"></div>' +
      '<div><label class="block text-slate-600 mb-1">Subtítulo</label><input name="subtitle" value="' + esc(cv.subtitle) + '" placeholder="Ej.: Línea EPP 2026" class="' + PF_IN + '"></div>' +
      '<div class="grid grid-cols-2 gap-3">' +
      '<div class="space-y-1"><label class="block text-slate-600">Imagen de portada</label>' +
      '<div class="h-28 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-center overflow-hidden">' + (cv.has_cover ? '<img src="/api/catalog/cover/cover/file?t=' + t + '" class="max-h-full max-w-full object-contain">' : '<span class="text-slate-600">Sin imagen</span>') + '</div>' +
      '<input type="file" accept="image/*" onchange="catCoverUpload(\'cover\', this.files[0])" class="' + PF_IN + '">' + (cv.has_cover ? '<button type="button" onclick="catCoverRemove(\'cover\')" class="text-slate-500 hover:text-rose-700">Quitar imagen</button>' : '') + '</div>' +
      '<div class="space-y-1"><label class="block text-slate-600">Logo</label>' +
      '<div class="h-28 bg-slate-100 border border-slate-200 rounded-lg flex items-center justify-center overflow-hidden">' + (cv.has_logo ? '<img src="/api/catalog/cover/logo/file?t=' + t + '" class="max-h-full max-w-full object-contain">' : '<span class="text-slate-500">Sin logo</span>') + '</div>' +
      '<input type="file" accept="image/*" onchange="catCoverUpload(\'logo\', this.files[0])" class="' + PF_IN + '">' + (cv.has_logo ? '<button type="button" onclick="catCoverRemove(\'logo\')" class="text-slate-500 hover:text-rose-700">Quitar logo</button>' : '') + '</div></div></div>' +
      '<div><label class="block text-slate-600 mb-1">Productos por página</label><select name="per_page" class="' + PF_IN + '"><option value="1">1</option><option value="2" selected>2</option><option value="3">3</option></select></div>' +
      '<label class="flex items-center gap-2 text-slate-700"><input type="checkbox" name="show_prices"> Mostrar precios netos</label>' +
      '<label class="flex items-center gap-2 text-slate-700"><input type="checkbox" name="norms_matrix" checked> Incluir matriz de cumplimiento normativo</label>' +
      '<div class="flex justify-end"><button class="' + PF_BTN + ' bg-emerald-600 hover:bg-emerald-700 text-white">Generar PDF</button></div></form>');
  };

  window.catCoverUpload = async function (kind, file) {
    if (!file) return;
    var f = document.querySelector('#pf-modal form'), title = f ? f.title.value : '', sub = f ? f.subtitle.value : '';
    var fd = new FormData(); fd.append('file', file);
    try {
      await pfJson('/api/catalog/cover/' + kind, { method: 'POST', body: fd });
      await pfJson('/api/catalog/cover', pfJsonOpts('PUT', { title: title, subtitle: sub }));
      showToast(kind === 'logo' ? 'Logo actualizado' : 'Portada actualizada'); catPdfOpen();
    } catch (e) { showToast(e.message, 'error'); }
  };
  window.catCoverRemove = async function (kind) {
    var f = document.querySelector('#pf-modal form'), title = f ? f.title.value : '', sub = f ? f.subtitle.value : '';
    try { await pfJson('/api/catalog/cover/' + kind, { method: 'DELETE' }); await pfJson('/api/catalog/cover', pfJsonOpts('PUT', { title: title, subtitle: sub })); catPdfOpen(); }
    catch (e) { showToast(e.message, 'error'); }
  };

  catPdfRun = async function (e) {
    e.preventDefault(); var f = e.target;
    var body = { product_ids: Array.from(pf.cat.selected), title: f.title.value, subtitle: f.subtitle.value, per_page: parseInt(f.per_page.value, 10), show_prices: f.show_prices.checked, norms_matrix: f.norms_matrix.checked, use_cover: true };
    try {
      await pfJson('/api/catalog/cover', pfJsonOpts('PUT', { title: f.title.value, subtitle: f.subtitle.value }));
      showToast('Generando catálogo…', 'info');
      await pfDownload('/api/catalog/generate-pdf', pfJsonOpts('POST', body), 'Catalogo_Productos.pdf'); closePfModal();
    } catch (err) { showToast(err.message, 'error'); }
  };
})();
