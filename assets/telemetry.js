/* Reglas compartidas por el dashboard y las pruebas de datos. */
(function (root) {
  'use strict';
  const EQUIPO = 'EXCAVADORA-CAT-01';
  const LIMITS = Object.freeze({ tempWarning: 30, tempCritical: 35, fuelWarning: 25, fuelCritical: 15 });
  function classify(temp, fuel) {
    if ((temp !== null && temp > LIMITS.tempCritical) || (fuel !== null && fuel < LIMITS.fuelCritical)) return 'CRITICO';
    if (temp === null || fuel === null) return 'LECTURA_INCOMPLETA';
    if (temp >= LIMITS.tempWarning || fuel <= LIMITS.fuelWarning) return 'ADVERTENCIA';
    return 'NORMAL';
  }
  function number(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
  }
  function coordinate(value, latitude) {
    const limit = latitude ? 90 : 180;
    if (typeof value === 'number') return number(value, -limit, limit);
    if (typeof value !== 'string') return null;
    const match = value.trim().match(/^(\d{4,5}(?:\.\d+)?)\s+([NSEW])$/i);
    if (!match || !(latitude ? /^[NS]$/i : /^[EW]$/i).test(match[2])) return null;
    const raw = Number(match[1]), degrees = Math.floor(raw / 100), minutes = raw - degrees * 100;
    if (minutes >= 60 || degrees > limit || (degrees === limit && minutes !== 0)) return null;
    return (degrees + minutes / 60) * (/[SW]/i.test(match[2]) ? -1 : 1);
  }
  function parse(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.equipo_id !== EQUIPO) return null;
    // Un mensaje ajeno con solo el identificador no cuenta como una lectura.
    if (!('temp_motor' in data) || !('nivel_diesel_pct' in data) || !data.gps || typeof data.gps !== 'object') return null;
    const temp = number(data.temp_motor, -55, 125), fuel = number(data.nivel_diesel_pct, 0, 100);
    const tempAlert = data.alerta_temp === true || (temp !== null && temp > LIMITS.tempCritical);
    const fuelAlert = data.alerta_combustible === true || (fuel !== null && fuel < LIMITS.fuelCritical);
    const lat = coordinate(data.gps.latitud, true), lon = coordinate(data.gps.longitud, false);
    const fixed = data.gps.estado === 'FIJADO' && lat !== null && lon !== null;
    const reportedState = ['NORMAL', 'ADVERTENCIA', 'CRITICO', 'LECTURA_INCOMPLETA'].includes(data.estado_operativo) ? data.estado_operativo : null;
    const measuredState = classify(temp, fuel);
    // El estado enviado por la Pico puede elevar la condición, nunca ocultar una lectura crítica.
    const state = tempAlert || fuelAlert || reportedState === 'CRITICO' ? 'CRITICO'
      : measuredState === 'LECTURA_INCOMPLETA' || reportedState === 'LECTURA_INCOMPLETA' ? 'LECTURA_INCOMPLETA'
      : measuredState === 'ADVERTENCIA' || reportedState === 'ADVERTENCIA' ? 'ADVERTENCIA' : 'NORMAL';
    let level = 'ok', label = 'Normal', action = 'Continúa el seguimiento de la temperatura y del nivel de combustible.';
    const actions = [];
    if (tempAlert) actions.push('Pausa la operación y revisa la temperatura antes de continuar.');
    if (fuelAlert) actions.push('Programa la recarga antes de seguir trabajando.');
    if (state === 'CRITICO') { level = 'danger'; label = 'Crítico'; }
    else if (state === 'LECTURA_INCOMPLETA') { level = 'warn'; label = 'Lectura incompleta'; }
    else if (state === 'ADVERTENCIA') { level = 'warn'; label = 'Advertencia'; }
    if (temp === null) actions.push('Revisa la conexión del sensor de temperatura.');
    else if (!tempAlert && temp >= LIMITS.tempWarning) actions.push('Vigila el aumento de temperatura y prepara una revisión.');
    if (fuel === null) actions.push('Revisa la conexión y calibración del sensor de nivel.');
    else if (!fuelAlert && fuel <= LIMITS.fuelWarning) actions.push('Planea la próxima recarga de combustible.');
    if (state === 'CRITICO' && !tempAlert && !fuelAlert) actions.unshift('El equipo reporta una condición crítica. Pausa la operación y revisa los sensores y el estado recibido.');
    if (state === 'ADVERTENCIA' && !actions.length) actions.push('El equipo reporta una advertencia. Revisa las lecturas y programa una revisión preventiva.');
    if (state === 'LECTURA_INCOMPLETA' && !actions.length) actions.push('El equipo reporta una lectura incompleta. Revisa los sensores antes de evaluar su condición.');
    if (actions.length) action = actions.join(' ');
    return { temp, fuel, tempAlert, fuelAlert, lat, lon, fixed, level, label, action, state, reportedState };
  }
  function validConfig(config) {
    if (!config || typeof config.broker !== 'string' || typeof config.topic !== 'string') return false;
    try {
      const url = new URL(config.broker);
      return url.protocol === 'wss:' && !url.username && !url.password && !url.hash && config.topic.length > 0 && config.topic.length < 512 && !/[+#\u0000]/.test(config.topic);
    } catch (_) { return false; }
  }
  const api = { EQUIPO, LIMITS, number, coordinate, classify, parse, validConfig };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Telemetry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
