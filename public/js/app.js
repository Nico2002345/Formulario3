(() => {
  'use strict';

  const state = {
    eventoActualId: null,
    asistentesCache: [],
    eventosCache: []
  };

  // ---------- Helpers ----------

  const $ = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);

  async function api(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    if (!res.ok) {
      let msg = 'Ocurrió un error';
      try { msg = (await res.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function toast(msg) {
    $('#appToastBody').textContent = msg;
    new bootstrap.Toast($('#appToast'), { delay: 2500 }).show();
  }

  function debounce(fn, delay) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function linkRegistro(token) {
    return `${window.location.origin}/r/${token}`;
  }

  // ---------- Vistas ----------

  function mostrarVistaEventos() {
    $('#view-eventos').classList.remove('d-none');
    $('#view-detalle').classList.add('d-none');
    state.eventoActualId = null;
    cargarEventos();
  }

  function mostrarVistaDetalle(id) {
    $('#view-eventos').classList.add('d-none');
    $('#view-detalle').classList.remove('d-none');
    state.eventoActualId = id;
    cargarDetalle(id);
  }

  // ---------- Eventos ----------

  async function cargarEventos() {
    const search = $('#buscarEvento').value;
    const eventos = await api(`/api/eventos?search=${encodeURIComponent(search)}`);
    state.eventosCache = eventos;
    const cont = $('#eventosContainer');
    cont.innerHTML = '';
    $('#eventosVacio').classList.toggle('d-none', eventos.length > 0);

    eventos.forEach(ev => {
      const col = document.createElement('div');
      col.className = 'col-12 col-md-6 col-xl-4';
      col.innerHTML = `
        <div class="card evento-card">
          <div class="card-body d-flex flex-column">
            <div class="d-flex justify-content-between align-items-start">
              <h3 class="card-title h6 mb-2">${escapeHtml(ev.tema_evento)}</h3>
              <span class="badge text-bg-primary badge-count">${ev.total_asistentes} asist.</span>
            </div>
            <div class="text-muted small mb-2">
              <div><i class="bi bi-calendar3"></i> ${escapeHtml(ev.fecha) || 'Sin fecha'} ${ev.hora_inicio ? '· ' + escapeHtml(ev.hora_inicio) : ''}</div>
              <div><i class="bi bi-geo-alt"></i> ${escapeHtml(ev.lugar) || 'Sin lugar'} ${ev.ciudad ? '· ' + escapeHtml(ev.ciudad) : ''}</div>
              <div><i class="bi bi-person-badge"></i> ${escapeHtml(ev.organizado_por) || 'Sin organizador'}</div>
            </div>
            <div class="mb-2 d-flex flex-wrap gap-1">
              <span class="badge ${ev.registro_abierto ? 'text-bg-success' : 'text-bg-secondary'}">
                <i class="bi bi-qr-code"></i> Registro ${ev.registro_abierto ? 'abierto' : 'cerrado'}
              </span>
              <span class="badge text-bg-light border" title="${escapeHtml(formularioLabel(ev.tipo_formulario))}">
                <i class="bi bi-file-earmark-text"></i> ${escapeHtml(formularioShortLabel(ev.tipo_formulario))}
              </span>
            </div>
            <div class="mt-auto d-flex gap-2">
              <button class="btn btn-sm btn-primary flex-fill" data-ver="${ev.id}"><i class="bi bi-people"></i> Asistentes</button>
              <button class="btn btn-sm btn-outline-primary" data-compartir="${ev.id}" title="Compartir link de registro"><i class="bi bi-share"></i></button>
              <button class="btn btn-sm btn-outline-secondary" data-editar="${ev.id}"><i class="bi bi-pencil"></i></button>
              <button class="btn btn-sm btn-outline-danger" data-eliminar="${ev.id}"><i class="bi bi-trash"></i></button>
            </div>
          </div>
        </div>
      `;
      cont.appendChild(col);
    });

    cont.querySelectorAll('[data-ver]').forEach(b => b.addEventListener('click', () => mostrarVistaDetalle(Number(b.dataset.ver))));
    cont.querySelectorAll('[data-compartir]').forEach(b => b.addEventListener('click', () => abrirModalCompartir(Number(b.dataset.compartir))));
    cont.querySelectorAll('[data-editar]').forEach(b => b.addEventListener('click', () => abrirModalEvento(Number(b.dataset.editar))));
    cont.querySelectorAll('[data-eliminar]').forEach(b => b.addEventListener('click', () => eliminarEvento(Number(b.dataset.eliminar))));
  }

  async function abrirModalEvento(id) {
    const form = $('#formEvento');
    form.reset();
    $('#eventoId').value = '';
    $('#modalEventoTitulo').textContent = 'Nuevo evento';
    $('#tipo_formulario').value = FORMULARIOS[0].value;

    if (id) {
      const ev = await api(`/api/eventos/${id}`);
      $('#modalEventoTitulo').textContent = 'Editar evento';
      $('#eventoId').value = ev.id;
      $('#tema_evento').value = ev.tema_evento || '';
      $('#organizado_por').value = ev.organizado_por || '';
      $('#ciudad').value = ev.ciudad || '';
      $('#lugar').value = ev.lugar || '';
      $('#fecha').value = ev.fecha || '';
      $('#hora_inicio').value = ev.hora_inicio || '';
      $('#hora_final').value = ev.hora_final || '';
      $('#observaciones').value = ev.observaciones || '';
      $('#tipo_formulario').value = ev.tipo_formulario || FORMULARIOS[0].value;
    }

    new bootstrap.Modal($('#modalEvento')).show();
  }

  async function guardarEvento(e) {
    e.preventDefault();
    const id = $('#eventoId').value;
    const data = {
      tema_evento: $('#tema_evento').value.trim(),
      organizado_por: $('#organizado_por').value.trim(),
      ciudad: $('#ciudad').value.trim(),
      lugar: $('#lugar').value.trim(),
      fecha: $('#fecha').value,
      hora_inicio: $('#hora_inicio').value,
      hora_final: $('#hora_final').value,
      observaciones: $('#observaciones').value.trim(),
      tipo_formulario: $('#tipo_formulario').value
    };

    try {
      if (id) {
        await api(`/api/eventos/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        toast('Evento actualizado');
        if (state.eventoActualId === Number(id)) cargarDetalle(Number(id));
      } else {
        await api('/api/eventos', { method: 'POST', body: JSON.stringify(data) });
        toast('Evento creado');
      }
      bootstrap.Modal.getInstance($('#modalEvento')).hide();
      if ($('#view-eventos').classList.contains('d-none') === false) cargarEventos();
    } catch (err) {
      toast(err.message);
    }
  }

  async function eliminarEvento(id) {
    if (!confirm('¿Eliminar este evento y todos sus asistentes registrados? Esta acción no se puede deshacer.')) return;
    try {
      await api(`/api/eventos/${id}`, { method: 'DELETE' });
      toast('Evento eliminado');
      mostrarVistaEventos();
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------- Compartir / registro público ----------

  let eventoCompartirId = null;

  async function abrirModalCompartir(id) {
    eventoCompartirId = id;
    const ev = state.eventosCache.find(x => x.id === id) || await api(`/api/eventos/${id}`);
    $('#compartirTema').textContent = ev.tema_evento;
    const url = linkRegistro(ev.token);
    $('#compartirLink').value = url;
    $('#switchRegistroAbierto').checked = !!ev.registro_abierto;
    $('#switchRegistroAbiertoLabel').textContent = ev.registro_abierto ? 'Registro abierto' : 'Registro cerrado';

    const qrCont = $('#compartirQr');
    qrCont.innerHTML = '';
    if (window.QRCode) {
      new QRCode(qrCont, { text: url, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
    }

    new bootstrap.Modal($('#modalCompartir')).show();
  }

  async function toggleRegistroAbierto(e) {
    if (!eventoCompartirId) return;
    const abierto = e.target.checked;
    try {
      await api(`/api/eventos/${eventoCompartirId}/registro`, {
        method: 'PUT',
        body: JSON.stringify({ registro_abierto: abierto })
      });
      $('#switchRegistroAbiertoLabel').textContent = abierto ? 'Registro abierto' : 'Registro cerrado';
      cargarEventos();
      if (state.eventoActualId === eventoCompartirId) cargarDetalle(eventoCompartirId);
    } catch (err) {
      toast(err.message);
      e.target.checked = !abierto;
    }
  }

  async function copiarLinkRegistro() {
    const input = $('#compartirLink');
    try {
      await navigator.clipboard.writeText(input.value);
      toast('Link copiado');
    } catch (_) {
      input.select();
      document.execCommand('copy');
      toast('Link copiado');
    }
  }

  // ---------- Detalle / Asistentes ----------

  async function cargarDetalle(id) {
    const ev = await api(`/api/eventos/${id}`);
    $('#detalleTema').textContent = ev.tema_evento;
    const metaParts = [];
    if (ev.fecha) metaParts.push(`📅 ${ev.fecha}`);
    if (ev.hora_inicio || ev.hora_final) metaParts.push(`🕐 ${ev.hora_inicio || '?'} - ${ev.hora_final || '?'}`);
    if (ev.lugar) metaParts.push(`📍 ${ev.lugar}`);
    if (ev.ciudad) metaParts.push(ev.ciudad);
    if (ev.organizado_por) metaParts.push(`Organiza: ${ev.organizado_por}`);
    $('#detalleMeta').textContent = metaParts.join('  ·  ') || 'Sin información adicional';
    $('#detalleObs').textContent = ev.observaciones ? `Observaciones: ${ev.observaciones}` : '';

    state.asistentesCache = ev.asistentes || [];
    renderAsistentes(state.asistentesCache);
  }

  function renderAsistentes(lista) {
    const body = $('#asistentesBody');
    body.innerHTML = '';
    $('#totalAsistentes').textContent = lista.length;
    $('#asistentesVacio').classList.toggle('d-none', lista.length > 0);

    lista.forEach((a, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${escapeHtml(a.nombres_apellidos)}</td>
        <td>${escapeHtml(a.entidad_dependencia)}</td>
        <td>${escapeHtml(a.celular)}</td>
        <td>${escapeHtml(a.correo_electronico)}</td>
        <td>${escapeHtml(a.sexo)}</td>
        <td>${escapeHtml(a.grupo_etareo)}</td>
        <td>${(a.grupo_valor || []).map(g => `<span class="badge text-bg-light border me-1 mb-1 grupo-valor-check">${escapeHtml(g)}</span>`).join('')}</td>
        <td>${a.firma ? `<img class="firma-thumb" src="${a.firma}" alt="firma">` : '<span class="text-muted small">Sin firmar</span>'}</td>
        <td class="text-nowrap">
          <button class="btn btn-sm btn-outline-secondary" data-editar-asistente="${a.id}"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-outline-danger" data-eliminar-asistente="${a.id}"><i class="bi bi-trash"></i></button>
        </td>
      `;
      body.appendChild(tr);
    });

    body.querySelectorAll('[data-editar-asistente]').forEach(b =>
      b.addEventListener('click', () => abrirModalAsistente(Number(b.dataset.editarAsistente))));
    body.querySelectorAll('[data-eliminar-asistente]').forEach(b =>
      b.addEventListener('click', () => eliminarAsistente(Number(b.dataset.eliminarAsistente))));
  }

  function filtrarAsistentes() {
    const term = $('#buscarAsistente').value.trim().toLowerCase();
    if (!term) return renderAsistentes(state.asistentesCache);
    renderAsistentes(state.asistentesCache.filter(a =>
      (a.nombres_apellidos || '').toLowerCase().includes(term)
    ));
  }

  function renderGrupoValorCheckboxes(seleccionados = []) {
    const cont = $('#grupoValorContainer');
    cont.innerHTML = '';
    GRUPOS_VALOR.forEach((g, i) => {
      const id = `gv_${i}`;
      const col = document.createElement('div');
      col.className = 'col-6 col-md-4';
      col.innerHTML = `
        <div class="form-check">
          <input class="form-check-input" type="checkbox" value="${escapeHtml(g)}" id="${id}" ${seleccionados.includes(g) ? 'checked' : ''}>
          <label class="form-check-label grupo-valor-check" for="${id}">${escapeHtml(g)}</label>
        </div>
      `;
      cont.appendChild(col);
    });
  }

  function getGrupoValorSeleccionados() {
    return Array.from($$('#grupoValorContainer input[type=checkbox]:checked')).map(c => c.value);
  }

  function renderGrupoEtareoOptions() {
    const sel = $('#grupo_etareo');
    GRUPOS_ETAREOS.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.value;
      opt.textContent = g.label;
      sel.appendChild(opt);
    });
  }

  function renderFormularioOptions() {
    const sel = $('#tipo_formulario');
    FORMULARIOS.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.value;
      opt.textContent = f.label;
      sel.appendChild(opt);
    });
  }

  function formularioLabel(value) {
    const f = FORMULARIOS.find(x => x.value === value);
    return f ? f.label : FORMULARIOS[0].label;
  }

  function formularioShortLabel(value) {
    const f = FORMULARIOS.find(x => x.value === value);
    return f ? f.shortLabel : FORMULARIOS[0].shortLabel;
  }

  async function abrirModalAsistente(id) {
    const form = $('#formAsistente');
    form.reset();
    $('#asistenteId').value = '';
    $('#modalAsistenteTitulo').textContent = 'Nuevo asistente';
    renderGrupoValorCheckboxes([]);
    firmaPad.clear();

    if (id) {
      const a = state.asistentesCache.find(x => x.id === id);
      $('#modalAsistenteTitulo').textContent = 'Editar asistente';
      $('#asistenteId').value = a.id;
      $('#nombres_apellidos').value = a.nombres_apellidos || '';
      $('#entidad_dependencia').value = a.entidad_dependencia || '';
      $('#celular').value = a.celular || '';
      $('#correo_electronico').value = a.correo_electronico || '';
      if (a.sexo === 'H') $('#sexoH').checked = true;
      if (a.sexo === 'M') $('#sexoM').checked = true;
      $('#grupo_etareo').value = a.grupo_etareo || '';
      renderGrupoValorCheckboxes(a.grupo_valor || []);
      if (a.firma) firmaPad.loadDataUrl(a.firma);
    }

    new bootstrap.Modal($('#modalAsistente')).show();
  }

  async function guardarAsistente(e) {
    e.preventDefault();
    const id = $('#asistenteId').value;
    const sexo = document.querySelector('input[name=sexo]:checked');
    const data = {
      nombres_apellidos: $('#nombres_apellidos').value.trim(),
      entidad_dependencia: $('#entidad_dependencia').value.trim(),
      celular: $('#celular').value.trim(),
      correo_electronico: $('#correo_electronico').value.trim(),
      sexo: sexo ? sexo.value : '',
      grupo_etareo: $('#grupo_etareo').value,
      grupo_valor: getGrupoValorSeleccionados(),
      firma: firmaPad.hasContent() ? firmaPad.toDataUrl() : null
    };

    try {
      if (id) {
        await api(`/api/asistentes/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        toast('Asistente actualizado');
      } else {
        await api(`/api/eventos/${state.eventoActualId}/asistentes`, { method: 'POST', body: JSON.stringify(data) });
        toast('Asistente agregado');
      }
      bootstrap.Modal.getInstance($('#modalAsistente')).hide();
      cargarDetalle(state.eventoActualId);
    } catch (err) {
      toast(err.message);
    }
  }

  async function eliminarAsistente(id) {
    if (!confirm('¿Eliminar este asistente?')) return;
    try {
      await api(`/api/asistentes/${id}`, { method: 'DELETE' });
      toast('Asistente eliminado');
      cargarDetalle(state.eventoActualId);
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------- Exportar ----------

  async function abrirModalExportar() {
    const eventos = state.eventosCache.length ? state.eventosCache : await api('/api/eventos');
    const cont = $('#exportarEventosContainer');
    cont.innerHTML = '';
    $('#exportarVacio').classList.toggle('d-none', eventos.length > 0);
    $('#exportarSeleccionarTodos').checked = true;
    $('#exportarSeleccionarTodos').disabled = eventos.length === 0;

    eventos.forEach(ev => {
      const div = document.createElement('div');
      div.className = 'form-check';
      div.innerHTML = `
        <input class="form-check-input exportar-evento-check" type="checkbox" value="${ev.id}" id="exportar_ev_${ev.id}" checked>
        <label class="form-check-label" for="exportar_ev_${ev.id}">
          ${escapeHtml(ev.tema_evento)}
          <span class="text-muted small">${ev.fecha ? '· ' + escapeHtml(ev.fecha) : ''}</span>
        </label>
      `;
      cont.appendChild(div);
    });

    cont.querySelectorAll('.exportar-evento-check').forEach(chk => {
      chk.addEventListener('change', () => {
        const todos = cont.querySelectorAll('.exportar-evento-check');
        const marcados = cont.querySelectorAll('.exportar-evento-check:checked');
        $('#exportarSeleccionarTodos').checked = todos.length === marcados.length;
      });
    });

    new bootstrap.Modal($('#modalExportar')).show();
  }

  function toggleSeleccionarTodosExportar(e) {
    $$('.exportar-evento-check').forEach(chk => { chk.checked = e.target.checked; });
  }

  function confirmarExportar() {
    const ids = Array.from($$('.exportar-evento-check:checked')).map(c => c.value);
    if (ids.length === 0) {
      toast('Selecciona al menos un evento');
      return;
    }
    window.location.href = `/api/export/excel?ids=${ids.join(',')}`;
    bootstrap.Modal.getInstance($('#modalExportar')).hide();
  }

  // ---------- Init ----------

  let firmaPad;

  function init() {
    firmaPad = createSignaturePad($('#firmaCanvas'));
    $('#btnLimpiarFirma').addEventListener('click', () => firmaPad.clear());
    renderGrupoEtareoOptions();
    renderFormularioOptions();

    $('#btnNuevoEvento').addEventListener('click', () => abrirModalEvento(null));
    $('#formEvento').addEventListener('submit', guardarEvento);
    $('#buscarEvento').addEventListener('input', debounce(cargarEventos, 300));
    $('#btnExportExcel').addEventListener('click', abrirModalExportar);
    $('#exportarSeleccionarTodos').addEventListener('change', toggleSeleccionarTodosExportar);
    $('#btnConfirmarExportar').addEventListener('click', confirmarExportar);

    $('#btnVolver').addEventListener('click', mostrarVistaEventos);
    $('#btnEditarEvento').addEventListener('click', () => abrirModalEvento(state.eventoActualId));
    $('#btnEliminarEvento').addEventListener('click', () => eliminarEvento(state.eventoActualId));
    $('#btnNuevoAsistente').addEventListener('click', () => abrirModalAsistente(null));
    $('#formAsistente').addEventListener('submit', guardarAsistente);
    $('#buscarAsistente').addEventListener('input', debounce(filtrarAsistentes, 200));

    $('#btnCopiarLink').addEventListener('click', copiarLinkRegistro);
    $('#switchRegistroAbierto').addEventListener('change', toggleRegistroAbierto);
    $('#btnCompartirDesdeDetalle').addEventListener('click', () => abrirModalCompartir(state.eventoActualId));

    mostrarVistaEventos();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
