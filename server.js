const express = require('express');
const path = require('path');
const ExcelJS = require('exceljs');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- EVENTOS ----------

app.get('/api/eventos', (req, res) => {
  try {
    const eventos = db.getEventos(req.query.search || '');
    res.json(eventos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/eventos/:id', (req, res) => {
  try {
    const evento = db.getEventoById(Number(req.params.id));
    if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });
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
    const id = db.createEvento(req.body);
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
    db.updateEvento(Number(req.params.id), req.body);
    res.json(db.getEventoById(Number(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/eventos/:id', (req, res) => {
  try {
    db.deleteEvento(Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/eventos/:id/registro', (req, res) => {
  try {
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
    if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });
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
    db.updateAsistente(Number(req.params.id), req.body);
    res.json(db.getAsistenteById(Number(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/asistentes/:id', (req, res) => {
  try {
    db.deleteAsistente(Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- EXPORTAR A EXCEL ----------

app.get('/api/export/excel', async (req, res) => {
  try {
    const eventos = db.getEventos('');
    const asistentes = db.getAllAsistentesForExport();

    const workbook = new ExcelJS.Workbook();

    const eventosSheet = workbook.addWorksheet('Eventos');
    eventosSheet.columns = [
      { header: 'ID', key: 'id', width: 6 },
      { header: 'Tema o Evento', key: 'tema_evento', width: 30 },
      { header: 'Organizado por', key: 'organizado_por', width: 22 },
      { header: 'Ciudad', key: 'ciudad', width: 16 },
      { header: 'Lugar', key: 'lugar', width: 20 },
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Hora inicio', key: 'hora_inicio', width: 10 },
      { header: 'Hora final', key: 'hora_final', width: 10 },
      { header: 'Total asistentes', key: 'total_asistentes', width: 14 },
      { header: 'Observaciones', key: 'observaciones', width: 30 },
      { header: 'Creado', key: 'created_at', width: 18 }
    ];
    eventosSheet.getRow(1).font = { bold: true };
    eventos.forEach((e, idx) => eventosSheet.addRow({ ...e, id: idx + 1 }));

    const asistentesSheet = workbook.addWorksheet('Asistentes');
    asistentesSheet.columns = [
      { header: 'Tema o Evento', key: 'tema_evento', width: 26 },
      { header: 'Organizado por', key: 'organizado_por', width: 20 },
      { header: 'Ciudad', key: 'ciudad', width: 14 },
      { header: 'Lugar', key: 'lugar', width: 18 },
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Hora inicio', key: 'hora_inicio', width: 10 },
      { header: 'Hora final', key: 'hora_final', width: 10 },
      { header: 'Nombres y Apellidos', key: 'nombres_apellidos', width: 26 },
      { header: 'Entidad, Dependencia, Organización o Grupo Social', key: 'entidad_dependencia', width: 30 },
      { header: 'Celular', key: 'celular', width: 14 },
      { header: 'Correo Electrónico', key: 'correo_electronico', width: 24 },
      { header: 'Sexo', key: 'sexo', width: 6 },
      { header: 'Grupo Etáreo', key: 'grupo_etareo', width: 22 },
      { header: 'Grupo de Valor', key: 'grupo_valor', width: 34 },
      { header: 'Firma', key: 'firma', width: 12 }
    ];
    asistentesSheet.getRow(1).font = { bold: true };
    asistentes.forEach(a => asistentesSheet.addRow({
      ...a,
      grupo_valor: (a.grupo_valor || []).join(', '),
      firma: a.firma ? 'Firmado' : 'Sin firmar'
    }));

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
