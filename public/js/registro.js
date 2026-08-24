(() => {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);

  function formatFecha(iso) {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
  }

  const token = window.location.pathname.split('/').filter(Boolean).pop();
  let firmaPad;

  function mostrarEstado(id) {
    ['estadoCargando', 'estadoError', 'estadoCerrado', 'estadoExito', 'estadoFormulario'].forEach(s => {
      $(`#${s}`).classList.toggle('d-none', s !== id);
    });
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

  function renderGrupoValorCheckboxes() {
    const cont = $('#grupoValorContainer');
    cont.innerHTML = '';
    GRUPOS_VALOR.forEach((g, i) => {
      const id = `gv_${i}`;
      const col = document.createElement('div');
      col.className = 'col-6';
      col.innerHTML = `
        <div class="form-check">
          <input class="form-check-input" type="checkbox" value="${g}" id="${id}">
          <label class="form-check-label grupo-valor-check" for="${id}">${g}</label>
        </div>
      `;
      cont.appendChild(col);
    });
  }

  function getGrupoValorSeleccionados() {
    return Array.from($$('#grupoValorContainer input[type=checkbox]:checked')).map(c => c.value);
  }

  function resetFormulario() {
    $('#formRegistro').reset();
    renderGrupoValorCheckboxes();
    firmaPad.clear();
    $('#errorFormulario').classList.add('d-none');
  }

  async function cargarEvento() {
    if (!token) {
      mostrarEstado('estadoError');
      return;
    }
    try {
      const res = await fetch(`/api/registro/${token}`);
      if (!res.ok) {
        mostrarEstado('estadoError');
        return;
      }
      const evento = await res.json();

      if (!evento.registro_abierto) {
        $('#cerradoTema').textContent = evento.tema_evento;
        mostrarEstado('estadoCerrado');
        return;
      }

      $('#eventoTema').textContent = evento.tema_evento;
      const metaParts = [];
      if (evento.fecha) metaParts.push(`📅 ${formatFecha(evento.fecha)}`);
      if (evento.hora_inicio || evento.hora_final) metaParts.push(`🕐 ${evento.hora_inicio || '?'} - ${evento.hora_final || '?'}`);
      if (evento.lugar) metaParts.push(`📍 ${evento.lugar}`);
      if (evento.ciudad) metaParts.push(evento.ciudad);
      $('#eventoMeta').textContent = metaParts.join('  ·  ');

      renderGrupoEtareoOptions();
      renderGrupoValorCheckboxes();
      mostrarEstado('estadoFormulario');
    } catch (err) {
      mostrarEstado('estadoError');
    }
  }

  async function enviarRegistro(e) {
    e.preventDefault();
    const errorBox = $('#errorFormulario');
    errorBox.classList.add('d-none');

    const nombres = $('#nombres_apellidos').value.trim();
    if (!nombres) return;

    const sexo = document.querySelector('input[name=sexo]:checked');
    const data = {
      nombres_apellidos: nombres,
      entidad_dependencia: $('#entidad_dependencia').value.trim(),
      celular: $('#celular').value.trim(),
      correo_electronico: $('#correo_electronico').value.trim(),
      sexo: sexo ? sexo.value : '',
      grupo_etareo: $('#grupo_etareo').value,
      grupo_valor: getGrupoValorSeleccionados(),
      firma: firmaPad.hasContent() ? firmaPad.toDataUrl() : null
    };

    const btn = $('#btnEnviarRegistro');
    btn.disabled = true;
    try {
      const res = await fetch(`/api/registro/${token}/asistentes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo completar el registro');
      }
      mostrarEstado('estadoExito');
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.remove('d-none');
    } finally {
      btn.disabled = false;
    }
  }

  function init() {
    firmaPad = createSignaturePad($('#firmaCanvas'));
    $('#btnLimpiarFirma').addEventListener('click', () => firmaPad.clear());
    $('#formRegistro').addEventListener('submit', enviarRegistro);
    $('#btnOtroRegistro').addEventListener('click', () => {
      resetFormulario();
      mostrarEstado('estadoFormulario');
    });
    cargarEvento();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
