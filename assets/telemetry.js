/* Reglas compartidas por el dashboard y las pruebas de datos. */
(function (root) {
  'use strict';
  const EQUIPO = 'EXCAVADORA-CAT-01';
  const LIMITS = Object.freeze({ tempWarning: 30, tempCritical: 35, fuelWarning: 40, fuelCritical: 15 });
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
    let level = 'ok', label = 'Normal', action = 'Continúa el seguimiento de la temperatura y del nivel de combustible.';
    const actions = [];
    if (tempAlert) actions.push('Pausa la operación y revisa la temperatura antes de continuar.');
    if (fuelAlert) actions.push('Programa la recarga antes de seguir trabajando.');
    if (tempAlert || fuelAlert) { level = 'danger'; label = 'Alerta'; }
    else if (temp === null || fuel === null) { level = 'warn'; label = 'Lectura incompleta'; }
    else if (temp > LIMITS.tempWarning || fuel < LIMITS.fuelWarning) { level = 'warn'; label = 'Precaución'; }
    if (temp === null) actions.push('Revisa la conexión del sensor de temperatura.');
    else if (!tempAlert && temp > LIMITS.tempWarning) actions.push('Vigila el aumento de temperatura y prepara una revisión.');
    if (fuel === null) actions.push('Revisa la conexión y calibración del sensor de nivel.');
    else if (!fuelAlert && fuel < LIMITS.fuelWarning) actions.push('Planea la próxima recarga de combustible.');
    if (actions.length) action = actions.join(' ');
    return { temp, fuel, tempAlert, fuelAlert, lat, lon, fixed, level, label, action };
  }
  function validConfig(config) {
    if (!config || typeof config.broker !== 'string' || typeof config.topic !== 'string') return false;
    try {
      const url = new URL(config.broker);
      return url.protocol === 'wss:' && !url.username && !url.password && !url.hash && config.topic.length > 0 && config.topic.length < 512 && !/[+#\u0000]/.test(config.topic);
    } catch (_) { return false; }
  }
  const api = { EQUIPO, LIMITS, number, coordinate, parse, validConfig };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Telemetry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
