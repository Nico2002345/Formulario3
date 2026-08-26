const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'asistencia.sqlite');

let db = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function persist() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length ? rows[0] : null;
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  const lastId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
  persist();
  return lastId;
}

function runNoSave(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
}

async function init() {
  ensureDataDir();
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS departamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tema_evento TEXT NOT NULL,
      organizado_por TEXT,
      ciudad TEXT,
      lugar TEXT,
      fecha TEXT,
      hora_inicio TEXT,
      hora_final TEXT,
      observaciones TEXT,
      token TEXT,
      registro_abierto INTEGER DEFAULT 1,
      tipo_formulario TEXT DEFAULT 'direccionamiento',
      departamento_id INTEGER,
      eliminado_en TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS asistentes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evento_id INTEGER NOT NULL,
      nombres_apellidos TEXT NOT NULL,
      entidad_dependencia TEXT,
      celular TEXT,
      correo_electronico TEXT,
      sexo TEXT,
      grupo_etareo TEXT,
      grupo_valor TEXT,
      firma TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE
    );
  `);

  migrateSchema();
  persist();
}

function migrateSchema() {
  const cols = queryAll("PRAGMA table_info(eventos)").map(c => c.name);
  if (!cols.includes('token')) {
    db.run('ALTER TABLE eventos ADD COLUMN token TEXT');
  }
  if (!cols.includes('registro_abierto')) {
    db.run('ALTER TABLE eventos ADD COLUMN registro_abierto INTEGER DEFAULT 1');
  }
  if (!cols.includes('tipo_formulario')) {
    db.run("ALTER TABLE eventos ADD COLUMN tipo_formulario TEXT DEFAULT 'direccionamiento'");
  }
  if (!cols.includes('departamento_id')) {
    db.run('ALTER TABLE eventos ADD COLUMN departamento_id INTEGER');
  }
  if (!cols.includes('eliminado_en')) {
    db.run('ALTER TABLE eventos ADD COLUMN eliminado_en TEXT');
  }
  const sinToken = queryAll('SELECT id FROM eventos WHERE token IS NULL OR token = ?', ['']);
  sinToken.forEach(row => {
    runNoSave('UPDATE eventos SET token = ? WHERE id = ?', [crypto.randomBytes(8).toString('hex'), row.id]);
  });
}

// ---------- DEPARTAMENTOS ----------

function createDepartamento(nombre) {
  const token = crypto.randomBytes(12).toString('hex');
  return run('INSERT INTO departamentos (nombre, token) VALUES (?, ?)', [nombre, token]);
}

function getDepartamentos() {
  return queryAll(`
    SELECT d.*, (SELECT COUNT(*) FROM eventos e WHERE e.departamento_id = d.id AND e.eliminado_en IS NULL) AS total_eventos
    FROM departamentos d
    ORDER BY d.nombre ASC
  `);
}

function getDepartamentoById(id) {
  return queryOne('SELECT * FROM departamentos WHERE id = ?', [id]);
}

function getDepartamentoByToken(token) {
  return queryOne('SELECT * FROM departamentos WHERE token = ?', [token]);
}

function deleteDepartamento(id) {
  runNoSave('UPDATE eventos SET departamento_id = NULL WHERE departamento_id = ?', [id]);
  run('DELETE FROM departamentos WHERE id = ?', [id]);
}

// ---------- EVENTOS ----------

function createEvento(data) {
  const token = crypto.randomBytes(8).toString('hex');
  return run(
    `INSERT INTO eventos (tema_evento, organizado_por, ciudad, lugar, fecha, hora_inicio, hora_final, observaciones, token, registro_abierto, tipo_formulario, departamento_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      data.tema_evento || '',
      data.organizado_por || '',
      data.ciudad || '',
      data.lugar || '',
      data.fecha || '',
      data.hora_inicio || '',
      data.hora_final || '',
      data.observaciones || '',
      token,
      data.tipo_formulario || 'direccionamiento',
      data.departamento_id || null
    ]
  );
}

function updateRegistroAbierto(id, abierto) {
  run('UPDATE eventos SET registro_abierto = ?, updated_at=datetime(\'now\',\'localtime\') WHERE id = ?', [abierto ? 1 : 0, id]);
}

function getEventoByToken(token) {
  return queryOne('SELECT * FROM eventos WHERE token = ?', [token]);
}

function updateEvento(id, data) {
  run(
    `UPDATE eventos SET tema_evento=?, organizado_por=?, ciudad=?, lugar=?, fecha=?, hora_inicio=?, hora_final=?, observaciones=?, tipo_formulario=?, departamento_id=?, updated_at=datetime('now','localtime')
     WHERE id=?`,
    [
      data.tema_evento || '',
      data.organizado_por || '',
      data.ciudad || '',
      data.lugar || '',
      data.fecha || '',
      data.hora_inicio || '',
      data.hora_final || '',
      data.observaciones || '',
      data.tipo_formulario || 'direccionamiento',
      data.departamento_id || null,
      id
    ]
  );
}

function deleteEvento(id) {
  run("UPDATE eventos SET eliminado_en = datetime('now','localtime') WHERE id = ?", [id]);
}

function restaurarEvento(id) {
  run('UPDATE eventos SET eliminado_en = NULL WHERE id = ?', [id]);
}

function eliminarEventoDefinitivo(id) {
  runNoSave('DELETE FROM asistentes WHERE evento_id = ?', [id]);
  run('DELETE FROM eventos WHERE id = ?', [id]);
}

function getEventos(search, { departamentoId = null, papelera = false } = {}) {
  let sql = `
    SELECT e.*, (SELECT COUNT(*) FROM asistentes a WHERE a.evento_id = e.id) AS total_asistentes
    FROM eventos e
    WHERE e.eliminado_en IS ${papelera ? 'NOT' : ''} NULL
  `;
  const params = [];
  if (departamentoId) {
    sql += ' AND e.departamento_id = ?';
    params.push(departamentoId);
  }
  if (search && search.trim()) {
    sql += ` AND (e.tema_evento LIKE ? OR e.organizado_por LIKE ? OR e.ciudad LIKE ? OR e.lugar LIKE ? OR e.fecha LIKE ?)`;
    const like = `%${search.trim()}%`;
    params.push(like, like, like, like, like);
  }
  sql += ' ORDER BY e.id DESC';
  return queryAll(sql, params);
}

function getEventoById(id) {
  const evento = queryOne('SELECT * FROM eventos WHERE id = ?', [id]);
  if (!evento) return null;
  const asistentes = queryAll('SELECT * FROM asistentes WHERE evento_id = ? ORDER BY id ASC', [id]);
  evento.asistentes = asistentes.map(parseAsistente);
  return evento;
}

// ---------- ASISTENTES ----------

function parseAsistente(row) {
  return {
    ...row,
    grupo_valor: row.grupo_valor ? JSON.parse(row.grupo_valor) : []
  };
}

function createAsistente(eventoId, data) {
  return run(
    `INSERT INTO asistentes (evento_id, nombres_apellidos, entidad_dependencia, celular, correo_electronico, sexo, grupo_etareo, grupo_valor, firma)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventoId,
      data.nombres_apellidos || '',
      data.entidad_dependencia || '',
      data.celular || '',
      data.correo_electronico || '',
      data.sexo || '',
      data.grupo_etareo || '',
      JSON.stringify(data.grupo_valor || []),
      data.firma || null
    ]
  );
}

function updateAsistente(id, data) {
  run(
    `UPDATE asistentes SET nombres_apellidos=?, entidad_dependencia=?, celular=?, correo_electronico=?, sexo=?, grupo_etareo=?, grupo_valor=?, firma=?, updated_at=datetime('now','localtime')
     WHERE id=?`,
    [
      data.nombres_apellidos || '',
      data.entidad_dependencia || '',
      data.celular || '',
      data.correo_electronico || '',
      data.sexo || '',
      data.grupo_etareo || '',
      JSON.stringify(data.grupo_valor || []),
      data.firma || null,
      id
    ]
  );
}

function deleteAsistente(id) {
  run('DELETE FROM asistentes WHERE id = ?', [id]);
}

function getAsistenteById(id) {
  const row = queryOne('SELECT * FROM asistentes WHERE id = ?', [id]);
  return row ? parseAsistente(row) : null;
}

function getAllAsistentesForExport() {
  const rows = queryAll(`
    SELECT
      e.tema_evento, e.organizado_por, e.ciudad, e.lugar, e.fecha, e.hora_inicio, e.hora_final,
      a.id AS asistente_id, a.nombres_apellidos, a.entidad_dependencia, a.celular, a.correo_electronico,
      a.sexo, a.grupo_etareo, a.grupo_valor, a.firma
    FROM eventos e
    JOIN asistentes a ON a.evento_id = e.id
    ORDER BY e.id DESC, a.id ASC
  `);
  return rows.map(r => ({
    ...r,
    grupo_valor: r.grupo_valor ? JSON.parse(r.grupo_valor) : []
  }));
}

module.exports = {
  init,
  createDepartamento,
  getDepartamentos,
  getDepartamentoById,
  getDepartamentoByToken,
  deleteDepartamento,
  createEvento,
  updateEvento,
  deleteEvento,
  restaurarEvento,
  eliminarEventoDefinitivo,
  getEventos,
  getEventoById,
  getEventoByToken,
  updateRegistroAbierto,
  createAsistente,
  updateAsistente,
  deleteAsistente,
  getAsistenteById,
  getAllAsistentesForExport
};
