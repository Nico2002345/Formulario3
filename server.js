const express = require('express');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- ACCESO POR DEPARTAMENTO ----------

const DEPT_COOKIE = 'dept_token';
const DEPT_COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', maxAge: 365 * 24 * 60 * 60 * 1000 };

const ADMIN_COOKIE = 'admin_token';
const ADMIN_COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', maxAge: 365 * 24 * 60 * 60 * 1000 };

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function getAdminSessionToken() {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update('admin-session').digest('hex');
}

function tieneSesionAdminValida(req) {
  const expected = getAdminSessionToken();
  if (!expected) return false; // sin ADMIN_PASSWORD configurado no existe "sesión admin" real
  const cookie = getCookie(req, ADMIN_COOKIE);
  if (!cookie || cookie.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(expected));
}

function esAdminValido(req) {
  if (!process.env.ADMIN_PASSWORD) return true; // sin ADMIN_PASSWORD configurado, no se exige login (comportamiento anterior)
  return tieneSesionAdminValida(req);
}

function resolveContexto(req) {
  // Una sesión de admin ya autenticada con contraseña siempre gana, aunque el
  // navegador tenga guardada una cookie vieja de algún link de departamento.
  if (tieneSesionAdminValida(req)) return { modo: 'maestro' };

  const token = getCookie(req, DEPT_COOKIE);
  if (token) {
    const depto = db.getDepartamentoByToken(token);
    return depto ? { modo: 'departamento', depto } : { modo: 'invalido' };
  }
  return esAdminValido(req) ? { modo: 'maestro' } : { modo: 'sin_autenticar' };
}

function requireContexto(req, res, next) {
  const ctx = resolveContexto(req);
  if (ctx.modo === 'invalido') {
    return res.status(403).json({ error: 'Link no válido, contacta al administrador' });
  }
  if (ctx.modo === 'sin_autenticar') {
    return res.status(401).json({ error: 'Debes iniciar sesión como administrador' });
  }
  req.ctx = ctx;
  next();
}

function puedeAccederEvento(ctx, evento) {
  if (!evento) return false;
  if (ctx.modo === 'departamento') return evento.departamento_id === ctx.depto.id;
  return true;
}

app.use(['/api/eventos', '/api/asistentes', '/api/departamentos', '/api/export'], requireContexto);

app.get('/api/sesion', (req, res) => {
  const ctx = resolveContexto(req);
  if (ctx.modo === 'departamento') {
    return res.json({ modo: 'departamento', departamento: { id: ctx.depto.id, nombre: ctx.depto.nombre } });
  }
  res.json({ modo: ctx.modo });
});

app.post('/api/admin-login', (req, res) => {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return res.status(400).json({ error: 'No hay contraseña de administrador configurada en el servidor' });
  if (req.body.password !== secret) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  res.cookie(ADMIN_COOKIE, getAdminSessionToken(), ADMIN_COOKIE_OPTS);
  res.json({ ok: true });
});

app.get('/admin-logout', (req, res) => {
  res.clearCookie(ADMIN_COOKIE);
  res.redirect('/admin-login');
});

app.get('/admin-login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

app.get('/admin/salir', (req, res) => {
  res.clearCookie(DEPT_COOKIE);
  res.redirect('/');
});

app.get('/admin/:token', (req, res) => {
  const depto = db.getDepartamentoByToken(req.params.token);
  if (!depto) return res.status(404).send('Link no válido. Contacta al administrador para obtener un nuevo link.');
  res.cookie(DEPT_COOKIE, req.params.token, DEPT_COOKIE_OPTS);
  res.redirect('/');
});

// ---------- DEPARTAMENTOS ----------

app.get('/api/departamentos', (req, res) => {
  try {
    if (req.ctx.modo !== 'maestro') return res.status(403).json({ error: 'No autorizado' });
    res.json(db.getDepartamentos());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/departamentos', (req, res) => {
  try {
    if (req.ctx.modo !== 'maestro') return res.status(403).json({ error: 'No autorizado' });
    const nombre = (req.body.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const id = db.createDepartamento(nombre);
    res.status(201).json(db.getDepartamentos().find(d => d.id === id));
  } catch (err) {
    if (String(err.message).toUpperCase().includes('UNIQUE')) {
      return res.status(400).json({ error: 'Ya existe un departamento con ese nombre' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/departamentos/:id', (req, res) => {
  try {
    if (req.ctx.modo !== 'maestro') return res.status(403).json({ error: 'No autorizado' });
    db.deleteDepartamento(Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- EVENTOS ----------

app.get('/api/eventos', (req, res) => {
  try {
    const departamentoId = req.ctx.modo === 'departamento' ? req.ctx.depto.id : null;
    const papelera = req.query.papelera === '1';
    const eventos = db.getEventos(req.query.search || '', { departamentoId, papelera });
    res.json(eventos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/eventos/:id', (req, res) => {
  try {
    const evento = db.getEventoById(Number(req.params.id));
    if (!puedeAccederEvento(req.ctx, evento)) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json(evento);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/eventos', (req, res) => {
  try {
    if (!req.body.tema_evento || !req.body.tema_evento.trim()) {
      return res.status(400).json({ error: 'El tema o evento es obligatorio' });
    }
    const data = { ...req.body };
    data.departamento_id = req.ctx.modo === 'departamento'
      ? req.ctx.depto.id
      : (req.body.departamento_id ? Number(req.body.departamento_id) : null);
    const id = db.createEvento(data);
    res.status(201).json(db.getEventoById(id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/eventos/:id', (req, res) => {
  try {
    if (!req.body.tema_evento || !req.body.tema_evento.trim()) {
      return res.status(400).json({ error: 'El tema o evento es obligatorio' });
    }
    const evento = db.getEventoById(Number(req.params.id));
    if (!puedeAccederEvento(req.ctx, evento)) return res.status(404).json({ error: 'Evento no encontrado' });
    const data = { ...req.body };
    data.departamento_id = req.ctx.modo === 'departamento'
      ? req.ctx.depto.id
      : (req.body.departamento_id ? Number(req.body.departamento_id) : evento.departamento_id);
    db.updateEvento(Number(req.params.id), data);
    res.json(db.getEventoById(Number(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/eventos/:id', (req, res) => {
  try {
    const evento = db.getEventoById(Number(req.params.id));
    if (!puedeAccederEvento(req.ctx, evento)) return res.status(404).json({ error: 'Evento no encontrado' });
    db.deleteEvento(Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/eventos/:id/restaurar', (req, res) => {
  try {
    const evento = db.getEventoById(Number(req.params.id));
    if (!puedeAccederEvento(req.ctx, evento)) return res.status(404).json({ error: 'Evento no encontrado' });
    db.restaurarEvento(Number(req.params.id));
    res.json(db.getEventoById(Number(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/eventos/:id/definitivo', (req, res) => {
  try {
    const evento = db.getEventoById(Number(req.params.id));
    if (!puedeAccederEvento(req.ctx, evento)) return res.status(404).json({ error: 'Evento no encontrado' });
    db.eliminarEventoDefinitivo(Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/eventos/:id/registro', (req, res) => {
  try {
    const evento = db.getEventoById(Number(req.params.id));
    if (!puedeAccederEvento(req.ctx, evento)) return res.status(404).json({ error: 'Evento no encontrado' });
    db.updateRegistroAbierto(Number(req.params.id), !!req.body.registro_abierto);
    res.json(db.getEventoById(Number(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- REGISTRO PÚBLICO (por token, sin acceso a datos de otros asistentes) ----------

app.get('/api/registro/:token', (req, res) => {
  try {
    const evento = db.getEventoByToken(req.params.token);
    if (!evento) return res.status(404).json({ error: 'Link de registro no válido' });
    res.json({
      tema_evento: evento.tema_evento,
      organizado_por: evento.organizado_por,
      ciudad: evento.ciudad,
      lugar: evento.lugar,
      fecha: evento.fecha,
      hora_inicio: evento.hora_inicio,
      hora_final: evento.hora_final,
      registro_abierto: !!evento.registro_abierto
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/registro/:token/asistentes', (req, res) => {
  try {
    if (!req.body.nombres_apellidos || !req.body.nombres_apellidos.trim()) {
      return res.status(400).json({ error: 'Nombres y apellidos es obligatorio' });
    }
    const evento = db.getEventoByToken(req.params.token);
    if (!evento) return res.status(404).json({ error: 'Link de registro no válido' });
    if (!evento.registro_abierto) return res.status(403).json({ error: 'El registro para este evento está cerrado' });
    db.createAsistente(evento.id, req.body);
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/r/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'registro.html'));
});

// ---------- ASISTENTES ----------

app.post('/api/eventos/:id/asistentes', (req, res) => {
  try {
    if (!req.body.nombres_apellidos || !req.body.nombres_apellidos.trim()) {
      return res.status(400).json({ error: 'Nombres y apellidos es obligatorio' });
    }
    const eventoId = Number(req.params.id);
    const evento = db.getEventoById(eventoId);
    if (!puedeAccederEvento(req.ctx, evento)) return res.status(404).json({ error: 'Evento no encontrado' });
    const id = db.createAsistente(eventoId, req.body);
    res.status(201).json(db.getAsistenteById(id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/asistentes/:id', (req, res) => {
  try {
    if (!req.body.nombres_apellidos || !req.body.nombres_apellidos.trim()) {
      return res.status(400).json({ error: 'Nombres y apellidos es obligatorio' });
    }
    const asistente = db.getAsistenteById(Number(req.params.id));
    if (!asistente) return res.status(404).json({ error: 'Asistente no encontrado' });
    const evento = db.getEventoById(asistente.evento_id);
    if (!puedeAccederEvento(req.ctx, evento)) return res.status(404).json({ error: 'Asistente no encontrado' });
    db.updateAsistente(Number(req.params.id), req.body);
    res.json(db.getAsistenteById(Number(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/asistentes/:id', (req, res) => {
  try {
    const asistente = db.getAsistenteById(Number(req.params.id));
    if (!asistente) return res.status(404).json({ error: 'Asistente no encontrado' });
    const evento = db.getEventoById(asistente.evento_id);
    if (!puedeAccederEvento(req.ctx, evento)) return res.status(404).json({ error: 'Asistente no encontrado' });
    db.deleteAsistente(Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- EXPORTAR A EXCEL (formato oficial MI-AT-FO002-1-2 v2) ----------

const GRUPOS_ETAREOS = [
  'Primera infancia 0-5 años',
  'Infancia 6-13 años',
  'Jóvenes 14-28 años',
  'Adulto 29-59 años',
  'Adulto mayor 60 años'
];

const GRUPOS_VALOR = [
  'Indígena',
  'Afrodescendiente',
  'Persona con discapacidad',
  'LGBTI o población diversa',
  'Víctima del conflicto armado interno',
  'Minorías religiosas',
  'Persona en proceso de reincorporación',
  'Líder o lideresa social',
  'Autoridad indígena tradicional',
  'No aplica'
];

const FORMULARIOS = {
  direccionamiento: {
    label: 'Direccionamiento Estratégico y Articulación Regional',
    proceso: 'Direccionamiento Estratégico y Articulación Regional',
    formato: 'Lista de asistencia ',
    codigo: 'ES-DE-PR002-16-4.2',
    version: 3
  },
  asistencia_territorial: {
    label: 'Asistencia territorial y desarrollo institucional',
    proceso: 'Asistencia territorial y desarrollo institucional',
    formato: 'Lista de asistencia ',
    codigo: 'MI-AT-FO002-1-2',
    version: 2
  }
};

app.get('/api/formularios', (req, res) => {
  res.json(Object.entries(FORMULARIOS).map(([value, f]) => ({ value, label: f.label })));
});

function formatFecha(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

const ETAREO_COLS = ['H', 'I', 'J', 'K', 'L'];
const VALOR_COLS = ['M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V'];
const THIN_BORDER = { style: 'thin' };
const ALL_BORDERS = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER };
const LEGAL_TEXT = 'Mediante el registro de sus datos personales en el presente formato usted autoriza al área responsable del manejo del mismo, para la recolección, almacenamiento y uso de la información con el fin de generar informes y para que obre como evidencia de realización de la presente acta. En cumplimiento a la ley 1581 de 2012, se le informa que como titular de la información tiene derecho a conocer, actualizar y ratificar sus datos personales solicitar pruebas de la autorización otorgada para su tratamiento, ser informado sobre el uso que se le ha dado de los mismos, presentar quejas ante la SIC por infracción a la ley, revocar la autorización y/o Solicitar la  supervisión de sus datos en los casos en que sea procedente y acceder en forma gratuita a los mismos.';

function construirHojaEvento(workbook, colombiaImageId, vaupesImageId, evento) {
  const nombreHoja = `Evento ${evento.id}`.slice(0, 31);
  const ws = workbook.addWorksheet(nombreHoja, {
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.24, right: 0, top: 0.75, bottom: 0.75, header: 0, footer: 0 }
    }
  });

  const anchos = {
    A: 3.44, B: 31.33, C: 27.55, D: 17.44, E: 24.55, F: 3.55, G: 4.11,
    H: 3.33, I: 2.66, J: 14.44, K: 14.44, L: 4.0, M: 2.66, N: 14.44,
    O: 14.44, P: 14.44, Q: 14.44, R: 14.44, S: 14.44, T: 14.44, U: 14.44,
    V: 3.89, W: 15.11
  };
  Object.entries(anchos).forEach(([col, w]) => { ws.getColumn(col).width = w; });

  ws.getRow(1).height = 18;
  ws.getRow(2).height = 16.5;
  ws.getRow(3).height = 18;
  ws.getRow(4).height = 14.25;
  ws.getRow(5).height = 13.5;
  ws.getRow(6).height = 14.25;
  ws.getRow(7).height = 13.5;
  ws.getRow(8).height = 154.5;

  ws.mergeCells('A1:B3');
  ws.mergeCells('C1:O1');
  ws.mergeCells('P1:W3');
  ws.getCell('C1').value = 'DEPARTAMENTO DE VAUPÉS';
  ws.getCell('C1').font = { name: 'Arial', size: 10, bold: true };
  ws.getCell('C1').alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  ws.addImage(colombiaImageId, { tl: { col: 19.2, row: 0.05 }, ext: { width: 65, height: 62 } });
  ws.addImage(vaupesImageId, { tl: { col: 1.4, row: 0.05 }, ext: { width: 55, height: 66 } });

  const formulario = FORMULARIOS[evento.tipo_formulario] || FORMULARIOS.direccionamiento;

  ws.mergeCells('D2:G2'); ws.mergeCells('H2:L2'); ws.mergeCells('M2:O2');
  ws.getCell('C2').value = 'Proceso:';
  ws.getCell('D2').value = formulario.proceso;
  ws.getCell('H2').value = 'Código';
  ws.getCell('M2').value = 'Versión';

  ws.mergeCells('D3:G3'); ws.mergeCells('H3:L3'); ws.mergeCells('M3:O3');
  ws.getCell('C3').value = 'Formato:';
  ws.getCell('D3').value = formulario.formato;
  ws.getCell('H3').value = formulario.codigo;
  ws.getCell('M3').value = formulario.version;

  [
    ['C2', 10, true], ['D2', 10, false], ['H2', 10, true], ['M2', 10, true],
    ['C3', 10, true], ['D3', 10, false], ['H3', 8, false], ['M3', 8, false]
  ].forEach(([coord, size, bold]) => {
    ws.getCell(coord).font = { name: 'Arial', size, bold };
    ws.getCell(coord).alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  });

  ws.mergeCells('A4:D4'); ws.mergeCells('E4:W4');
  ws.getCell('A4').value = `TEMA O EVENTO: ${evento.tema_evento || ''}`;
  ws.getCell('E4').value = `ORGANIZADO POR: ${evento.organizado_por || ''}`;

  ws.mergeCells('A5:D5'); ws.mergeCells('E5:W5');
  ws.getCell('A5').value = `CIUDAD: ${evento.ciudad || ''}`;
  ws.getCell('E5').value = `LUGAR: ${evento.lugar || ''}`;

  ws.mergeCells('A6:C6'); ws.mergeCells('D6:E6'); ws.mergeCells('F6:W6');
  ws.getCell('A6').value = `FECHA: ${formatFecha(evento.fecha)}`;
  ws.getCell('D6').value = `HORA INICIO: ${evento.hora_inicio || ''}`;
  ws.getCell('F6').value = `HORA FINAL: ${evento.hora_final || ''}`;

  ['A4', 'E4', 'A5', 'E5', 'A6', 'D6', 'F6'].forEach(coord => {
    ws.getCell(coord).font = { name: 'Arial', size: 8, bold: true };
    ws.getCell(coord).alignment = { horizontal: 'left', vertical: 'center' };
  });

  ws.mergeCells('A7:E7'); ws.mergeCells('F7:G7'); ws.mergeCells('H7:L7');
  ws.mergeCells('M7:V7'); ws.mergeCells('W7:W8');
  ws.getCell('A7').value = 'DATOS DE IDENTIFICACION';
  ws.getCell('F7').value = 'SEXO';
  ws.getCell('H7').value = 'ETAREOS';
  ws.getCell('M7').value = 'GRUPO DE VALOR';
  ws.getCell('W7').value = 'Firma';
  ['A7', 'F7', 'H7', 'M7', 'W7'].forEach(coord => {
    ws.getCell(coord).font = { name: 'Arial', size: 8, bold: coord !== 'W7' };
    ws.getCell(coord).alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  });

  const row8 = {
    A: 'N°', B: 'NOMBRES Y APELLIDOS', C: 'ENTIDAD, DEPENDENCIA, ORGANIZACIÓN O GRUPO SOCIAL',
    D: 'CELULAR', E: 'CORREO ELECTRONICO', F: 'H', G: 'M'
  };
  Object.entries(row8).forEach(([col, val]) => {
    const cell = ws.getCell(`${col}8`);
    cell.value = val;
    cell.font = { name: 'Arial', size: 8 };
    cell.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  });
  ETAREO_COLS.forEach((col, i) => {
    const cell = ws.getCell(`${col}8`);
    cell.value = GRUPOS_ETAREOS[i];
    cell.font = { name: 'Arial', size: 8 };
    cell.alignment = { horizontal: 'center', vertical: 'center', textRotation: 90 };
  });
  VALOR_COLS.forEach((col, i) => {
    const cell = ws.getCell(`${col}8`);
    cell.value = GRUPOS_VALOR[i];
    cell.font = { name: 'Arial', size: 8 };
    cell.alignment = { horizontal: 'center', vertical: 'center', textRotation: 90 };
  });

  const asistentes = evento.asistentes || [];
  const totalFilas = Math.max(16, asistentes.length);
  for (let i = 0; i < totalFilas; i++) {
    const fila = 9 + i;
    ws.getRow(fila).height = 21;
    const a = asistentes[i];

    ws.getCell(`A${fila}`).value = i + 1;
    if (a) {
      ws.getCell(`B${fila}`).value = a.nombres_apellidos || '';
      ws.getCell(`C${fila}`).value = a.entidad_dependencia || '';
      ws.getCell(`D${fila}`).value = a.celular || '';
      ws.getCell(`E${fila}`).value = a.correo_electronico || '';
      if (a.sexo === 'H') ws.getCell(`F${fila}`).value = 'X';
      if (a.sexo === 'M') ws.getCell(`G${fila}`).value = 'X';
      const idxEtareo = GRUPOS_ETAREOS.indexOf(a.grupo_etareo);
      if (idxEtareo >= 0) ws.getCell(`${ETAREO_COLS[idxEtareo]}${fila}`).value = 'X';
      (a.grupo_valor || []).forEach(gv => {
        const idxValor = GRUPOS_VALOR.indexOf(gv);
        if (idxValor >= 0) ws.getCell(`${VALOR_COLS[idxValor]}${fila}`).value = 'X';
      });
      if (a.firma) {
        try {
          const base64 = a.firma.split(',')[1];
          const firmaImageId = workbook.addImage({ base64, extension: 'png' });
          ws.addImage(firmaImageId, { tl: { col: 22.1, row: fila - 1 + 0.1 }, ext: { width: 95, height: 18 } });
        } catch (e) { /* firma corrupta, se omite */ }
      }
    }

    for (let c = 1; c <= 23; c++) {
      const cell = ws.getRow(fila).getCell(c);
      cell.border = ALL_BORDERS;
      cell.font = { name: 'Arial', size: 8 };
      cell.alignment = { horizontal: 'center', vertical: 'center' };
    }
    ws.getCell(`B${fila}`).alignment = { horizontal: 'left', vertical: 'center' };
    ws.getCell(`C${fila}`).alignment = { horizontal: 'left', vertical: 'center', wrapText: true };
  }

  const filaObs = 9 + totalFilas;
  ws.mergeCells(`A${filaObs}:B${filaObs}`);
  ws.mergeCells(`C${filaObs}:W${filaObs}`);
  ws.getCell(`A${filaObs}`).value = 'OBSERVACIONES:';
  ws.getCell(`A${filaObs}`).font = { name: 'Calibri', size: 8, bold: true };
  ws.getCell(`A${filaObs}`).alignment = { horizontal: 'center', vertical: 'center' };
  ws.getCell(`C${filaObs}`).value = evento.observaciones || '';
  ws.getCell(`C${filaObs}`).font = { name: 'Calibri', size: 8 };
  ws.getCell(`C${filaObs}`).alignment = { horizontal: 'left', vertical: 'center', wrapText: true };

  const filaLegal = filaObs + 1;
  ws.mergeCells(`A${filaLegal}:W${filaLegal + 1}`);
  ws.getRow(filaLegal + 1).height = 29.25;
  ws.getCell(`A${filaLegal}`).value = LEGAL_TEXT;
  ws.getCell(`A${filaLegal}`).font = { name: 'Calibri', size: 8 };
  ws.getCell(`A${filaLegal}`).alignment = { horizontal: 'left', vertical: 'top', wrapText: true };

  const ultimaFila = filaLegal + 1;
  for (let r = 1; r <= ultimaFila; r++) {
    for (let c = 1; c <= 23; c++) {
      ws.getRow(r).getCell(c).border = ALL_BORDERS;
    }
  }

  return ws;
}

app.get('/api/export/excel', async (req, res) => {
  try {
    const departamentoId = req.ctx.modo === 'departamento' ? req.ctx.depto.id : null;
    let eventos = db.getEventos('', { departamentoId });
    if (req.query.ids) {
      const idsSeleccionados = new Set(
        String(req.query.ids).split(',').map(id => Number(id)).filter(id => !Number.isNaN(id))
      );
      eventos = eventos.filter(ev => idsSeleccionados.has(ev.id));
    }
    const workbook = new ExcelJS.Workbook();
    const colombiaImageId = workbook.addImage({
      filename: path.join(__dirname, 'public', 'assets', 'excel', 'colombia.png'),
      extension: 'png'
    });
    const vaupesImageId = workbook.addImage({
      filename: path.join(__dirname, 'public', 'assets', 'excel', 'vaupes.png'),
      extension: 'png'
    });

    eventos.forEach(eventoResumen => {
      const evento = db.getEventoById(eventoResumen.id);
      construirHojaEvento(workbook, colombiaImageId, vaupesImageId, evento);
    });

    if (eventos.length === 0) {
      workbook.addWorksheet('Sin eventos').getCell('A1').value = 'No hay eventos registrados';
    }

    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename=lista_asistencia_${fecha}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor corriendo en http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Error al inicializar la base de datos:', err);
    process.exit(1);
  });
