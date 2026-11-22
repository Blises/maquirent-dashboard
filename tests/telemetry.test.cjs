const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../assets/telemetry.js');
const packet = (temp = 27, fuel = 70, extra = {}) => ({ equipo_id: T.EQUIPO, temp_motor: temp, nivel_diesel_pct: fuel, gps: { estado: 'BUSCANDO', latitud: null, longitud: null }, ...extra });

test('Los tres estados respetan los límites inclusivos del prototipo', () => {
  for (const [temp, fuel, label] of [[29.99, 25.01, 'Normal'], [30, 70, 'Advertencia'], [20, 25, 'Advertencia'], [35, 15, 'Advertencia'], [35.01, 40, 'Crítico'], [20, 14.99, 'Crítico'], [20, 0, 'Crítico'], [20, 30, 'Normal']]) {
    assert.equal(T.parse(packet(temp, fuel)).label, label);
  }
});
test('Una bandera falsa no oculta una lectura crítica y una verdadera conserva la alerta', () => {
  assert.equal(T.parse(packet(38, 70, { alerta_temp: false })).level, 'danger');
  assert.equal(T.parse(packet(20, 10, { alerta_combustible: false })).level, 'danger');
  assert.equal(T.parse(packet(20, 70, { alerta_temp: true })).level, 'danger');
});
test('Lecturas ausentes o inválidas no se convierten en cero ni en estado normal', () => {
  for (const value of [null, undefined, NaN, Infinity, '27', -56, 126]) assert.equal(T.parse(packet(27, 70, { temp_motor: value })).temp, null);
  for (const value of [null, -1, 101, '70']) assert.equal(T.parse(packet(27, value)).label, 'Lectura incompleta');
  assert.equal(T.parse(packet(null, 10)).label, 'Crítico');
});
test('El estado operativo de la Pico se integra sin ocultar lecturas ni sensores ausentes', () => {
  assert.equal(T.parse(packet(27, 70, { estado_operativo: 'ADVERTENCIA' })).label, 'Advertencia');
  const critical = T.parse(packet(27, 70, { estado_operativo: 'CRITICO' }));
  assert.equal(critical.label, 'Crítico');
  assert.match(critical.action, /condición crítica/);
  assert.equal(T.parse(packet(38, 70, { estado_operativo: 'NORMAL' })).label, 'Crítico');
  assert.equal(T.parse(packet(null, 70, { estado_operativo: 'NORMAL' })).label, 'Lectura incompleta');
  assert.equal(T.parse(packet(27, 70, { estado_operativo: 'LECTURA_INCOMPLETA' })).label, 'Lectura incompleta');
  assert.equal(T.parse(packet(27, 20, { estado_operativo: 'desconocido' })).label, 'Advertencia');
});
test('GPS valida hemisferios, minutos, límites y admite cero con fijación válida', () => {
  assert.ok(Math.abs(T.coordinate('2039.4020 N', true) - 20.6567) < 0.000001);
  assert.ok(Math.abs(T.coordinate('10319.5240 W', false) + 103.3254) < 0.000001);
  assert.equal(T.coordinate('0000.0000 N', true), 0);
  assert.equal(T.coordinate('9000 N', true), 90);
  for (const value of ['9160 N', '9060 N', '1234 E', '2060 N', '2039foo N']) assert.equal(T.coordinate(value, true), null);
  assert.equal(T.coordinate(181, false), null);
  assert.equal(T.parse(packet(27, 70, { gps: { estado: 'BUSCANDO', latitud: 20, longitud: -103 } })).fixed, false);
});
test('Se ignoran mensajes ajenos o que no incluyen el esquema de sensores', () => {
  for (const data of [null, [], {}, { equipo_id: T.EQUIPO }, packet(27, 70, { equipo_id: 'otro' })]) assert.equal(T.parse(data), null);
});
test('Configuración segura y tópico exacto sin comodines', () => {
  assert.equal(T.validConfig({ broker: 'wss://broker.emqx.io:8084/mqtt', topic: 'equipo7/telemetria' }), true);
  for (const broker of ['tcp://host:1883', 'ws://host:8083', 'https://host', 'wss://u:p@host']) assert.equal(T.validConfig({ broker, topic: 'x' }), false);
  for (const topic of ['', 'x/#', 'x/+', 'a\u0000b']) assert.equal(T.validConfig({ broker: 'wss://host/mqtt', topic }), false);
});
