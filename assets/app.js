(function () {
  'use strict';

  const DEFAULTS = { broker: 'wss://broker.emqx.io:8084/mqtt', topic: 'cucei/iot/d06/maquinaria/telemetria' };
  const T = window.Telemetry;
  const TEMP_MAX = T.LIMITS.tempCritical, DIESEL_MIN = T.LIMITS.fuelCritical, TEMP_SCALE = 60;
  const HIST_MS = 120000, STALE_MS = 10000;
  const CUCEI = [20.6567, -103.3254];
  const ARC = 245.04, CIRC = 326.73;
  const $ = (id) => document.getElementById(id);

  function loadCfg() {
    try { const s = JSON.parse(localStorage.getItem('maquirent_cfg') || 'null'); if (T.validConfig(s)) return s; } catch (e) {}
    return { ...DEFAULTS };
  }
  function saveCfg(c) { try { localStorage.setItem('maquirent_cfg', JSON.stringify(c)); } catch (e) {} }
  let cfg = loadCfg(), savedCfg = null, trials = false, subscribed = false, trialTimer = null, selectedScenario = null, current = null, source = '';
  const trialButtons = [...document.querySelectorAll('[data-scenario]')];

  const st = { lastAt: 0, count: 0, temp: [], diesel: [], track: [], lastPos: null, lastPosAt: 0,
               alertTemp: null, alertDiesel: null, fix: null, follow: true, recorded: false, conn: 'connecting' };

  const hasL = typeof L !== 'undefined';
  let map = null, marker = null, trail = null;
  if (hasL) {
    map = L.map('map', { zoomControl: false }).setView(CUCEI, 16);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    const esri = (svc, opts) => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/' + svc + '/MapServer/tile/{z}/{y}/{x}',
      Object.assign({ maxZoom: 19, attribution: 'Mapas &copy; Esri' }, opts));
    const base = {
      'Calles': esri('World_Street_Map'),
      'Satélite': esri('World_Imagery'),
      'Oscuro': esri('Canvas/World_Dark_Gray_Base', { maxNativeZoom: 16 })
    };
    base['Calles'].addTo(map);
    L.control.layers(base, null, { position: 'topright' }).addTo(map);
    trail = L.polyline([], { color: '#f5b301', weight: 3, opacity: .75 }).addTo(map);
    map.on('dragstart', () => setFollow(false));
  } else {
    $('map').innerHTML = '<p class="empty" style="padding:24px">No se pudo cargar el mapa (¿sin internet?).</p>';
  }

  function placeMarker(pos, label) {
    if (!hasL) return;
    if (!marker) {
      marker = L.marker(pos, { icon: L.divIcon({ className: 'pin-wrap', html: '<div class="pin"></div>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(map);
      marker.bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -14], className: 'pin-tip' });
      map.setView(pos, 17);
    } else {
      marker.setLatLng(pos);
      marker.setTooltipContent(label);
    }
  }
  function setMarkerStale(stale) {
    const el = marker && marker.getElement();
    if (el) el.querySelector('.pin').classList.toggle('stale', stale);
  }
  function setFollow(on) {
    st.follow = on;
    $('btn-follow').querySelector('span').textContent = on ? 'Siguiendo' : 'Centrar';
    if (on && st.lastPos && hasL) map.panTo(st.lastPos);
  }
  $('btn-follow').addEventListener('click', () => setFollow(true));

  function fmtCoord(v, isLat) {
    const h = isLat ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'O');
    return Math.abs(v).toFixed(5) + '° ' + h;
  }
  function ago(ms) {
    const s = Math.round(ms / 1000);
    if (s < 2) return 'ahora';
    if (s < 60) return 'hace ' + s + ' s';
    const m = Math.floor(s / 60);
    if (m < 60) return 'hace ' + m + ' min';
    return 'hace ' + Math.floor(m / 60) + ' h';
  }
  function setBadge(id, text, lv) { const el = $(id); el.textContent = text; el.dataset.lv = lv; }
  function pushHist(arr, t, v) { arr.push({ t, v }); while (arr.length && arr[0].t < t - HIST_MS) arr.shift(); }

  function spark(id, arr, th, lv) {
    const svg = $(id), pts = arr.filter(p => p.v !== null);
    svg.dataset.lv = lv;
    if (pts.length < 2) { svg.innerHTML = ''; return; }
    const W = 300, H = 56, t0 = Date.now() - HIST_MS;
    const vals = pts.map(p => p.v);
    let lo = Math.min(...vals, th), hi = Math.max(...vals, th);
    const pad = (hi - lo) * 0.15 || 1; lo -= pad; hi += pad;
    const x = t => Math.max(0, ((t - t0) / HIST_MS) * W), y = v => H - ((v - lo) / (hi - lo)) * H;
    const coords = pts.map(p => x(p.t).toFixed(1) + ',' + y(p.v).toFixed(1));
    const area = 'M' + x(pts[0].t).toFixed(1) + ',' + H + ' L' + coords.join(' L') + ' L' + x(pts[pts.length - 1].t).toFixed(1) + ',' + H + ' Z';
    const ty = y(th).toFixed(1);
    svg.innerHTML = '<path class="sp-area" d="' + area + '"/>' +
      '<line class="sp-th" x1="0" x2="' + W + '" y1="' + ty + '" y2="' + ty + '"/>' +
      '<polyline class="sp-line" points="' + coords.join(' ') + '"/>';
  }
  function range(id, arr, unit, dec) {
    const v = arr.filter(p => p.v !== null).map(p => p.v);
    $(id).textContent = v.length ? 'mín ' + Math.min(...v).toFixed(dec) + unit + ' · máx ' + Math.max(...v).toFixed(dec) + unit : '';
  }
  function trend(arr) {
    const pts = arr.filter(p => p.v !== null);
    if (pts.length < 3) return '—';
    const a = pts[0], b = pts[pts.length - 1], min = (b.t - a.t) / 60000;
    if (min < 0.3) return '—';
    const r = (b.v - a.v) / min;
    if (Math.abs(r) < 0.2) return 'Estable';
    return (r < 0 ? '↓ ' : '↑ ') + Math.abs(r).toFixed(1) + ' %/min';
  }

  function log(lv, msg) {
    const li = document.createElement('li');
    li.dataset.lv = lv;
    li.innerHTML = '<i></i><time></time><span></span>';
    li.querySelector('time').textContent = new Date().toLocaleTimeString('es-MX', { hour12: false });
    li.querySelector('span').textContent = msg;
    const ul = $('log');
    ul.prepend(li);
    while (ul.children.length > 40) ul.lastChild.remove();
    $('log-empty').hidden = true;
  }

  function renderTemp(t, alert) {
    const lv = t === null ? 'muted' : (alert || t > TEMP_MAX) ? 'danger' : t > TEMP_MAX - 5 ? 'warn' : 'ok';
    $('temp-val').textContent = t === null ? '--' : t.toFixed(2);
    setBadge('temp-badge', t === null ? 'Sin lectura' : lv === 'danger' ? 'Alta' : lv === 'warn' ? 'Elevada' : 'Normal', lv);
    const fill = $('temp-fill');
    fill.style.width = t === null ? '0%' : Math.max(0, Math.min(100, t / TEMP_SCALE * 100)) + '%';
    fill.dataset.lv = lv;
    $('card-temp').dataset.lv = lv;
    spark('temp-spark', st.temp, TEMP_MAX, lv);
    range('temp-range', st.temp, '°', 1);
  }

  function renderDiesel(f, alert) {
    const lv = f === null ? 'muted' : (alert || f < DIESEL_MIN) ? 'danger' : f < 40 ? 'warn' : 'ok';
    $('diesel-val').textContent = f === null ? '--' : Math.round(f);
    const arc = $('diesel-arc');
    arc.style.strokeDasharray = (f === null ? 0 : ARC * Math.max(0, Math.min(100, f)) / 100) + ' ' + CIRC;
    arc.dataset.lv = lv;
    setBadge('diesel-badge', f === null ? 'Sin lectura' : lv === 'danger' ? 'Bajo' : lv === 'warn' ? 'Medio' : 'Bueno', lv);
    $('card-diesel').dataset.lv = lv;
    $('diesel-state').textContent = f === null ? '—' : f.toFixed(1) + ' %';
    $('diesel-trend').textContent = trend(st.diesel);
    spark('diesel-spark', st.diesel, DIESEL_MIN, lv);
    range('diesel-range', st.diesel, '%', 0);
  }

  function renderGps(g, now, label) {
    const estado = g.estado || '';
    const lat = T.coordinate(g.latitud, true), lon = T.coordinate(g.longitud, false);
    const fixed = estado === 'FIJADO' && lat !== null && lon !== null;

    if (fixed) {
      const pos = [lat, lon];
      st.lastPos = pos; st.lastPosAt = now;
      const prev = st.track[st.track.length - 1];
      if (!prev || prev[0] !== lat || prev[1] !== lon) { st.track.push(pos); if (st.track.length > 400) st.track.shift(); }
      if (trail) trail.setLatLngs(st.track);
      placeMarker(pos, label);
      if (st.follow && hasL) map.panTo(pos, { animate: true });
      $('map-coords').querySelector('span').textContent = lat.toFixed(5) + ', ' + lon.toFixed(5);
    }
    setMarkerStale(!fixed);

    setBadge('gps-badge', fixed ? 'Señal fija' : estado === 'BUSCANDO' ? 'Buscando satélites' : 'Sin señal', fixed ? 'ok' : 'warn');
    $('gps-lat').textContent = st.lastPos ? fmtCoord(st.lastPos[0], true) : '—';
    $('gps-lon').textContent = st.lastPos ? fmtCoord(st.lastPos[1], false) : '—';
    $('gps-raw').textContent = g.latitud != null ? String(g.latitud) + ', ' + String(g.longitud) : '—';
    const link = $('gps-link');
    if (st.lastPos) { link.href = 'https://www.google.com/maps?q=' + st.lastPos[0].toFixed(6) + ',' + st.lastPos[1].toFixed(6); link.hidden = false; }

    const msg = $('map-msg');
    if (fixed) msg.hidden = true;
    else {
      msg.hidden = false;
      msg.innerHTML = st.lastPos
        ? '<span class="spin"></span>Sin señal GPS<small>Se muestra la última posición conocida</small>'
        : '<span class="spin"></span>Buscando satélites…<small>El GPS necesita cielo abierto para fijar posición</small>';
    }

    if (st.fix !== null && st.fix !== fixed) log(fixed ? 'ok' : 'warn', fixed ? 'GPS: posición fijada' : 'GPS: se perdió la señal');
    if (st.fix === null && fixed) log('ok', 'GPS: posición fijada');
    st.fix = fixed;
  }

  function renderAlerts(t, f, aT, aD) {
    const box = $('alerts'), items = [];
    const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>';
    if (aT && t !== null) items.push(['danger', 'Temperatura del motor alta: ' + t.toFixed(1) + ' °C', 'límite ' + TEMP_MAX + ' °C']);
    if (aD && f !== null) items.push(['danger', 'Combustible bajo: ' + f.toFixed(1) + ' %', 'mínimo ' + DIESEL_MIN + ' %']);
    if (t === null) items.push(['warn', 'No hay una lectura válida de temperatura', 'revisar DS18B20']);
    if (f === null) items.push(['warn', 'No hay una lectura válida de nivel', 'revisar sensor de nivel']);
    box.hidden = !items.length;
    box.innerHTML = '';
    items.forEach(([lv, text, note]) => {
      const d = document.createElement('div');
      d.className = 'alert'; d.dataset.lv = lv;
      d.innerHTML = icon + '<span></span><small></small>';
      d.querySelector('span').textContent = text;
      d.querySelector('small').textContent = note;
      box.appendChild(d);
    });
  }

  function transitions(aT, aD, t, f) {
    if (aT !== st.alertTemp) {
      if (aT && t !== null) log('danger', 'Alerta: temperatura alta (' + t.toFixed(1) + ' °C)');
      else if (st.alertTemp) log(t === null ? 'warn' : 'ok', t === null ? 'Temperatura: lectura perdida' : 'Temperatura fuera de la zona de alerta');
      st.alertTemp = aT;
    }
    if (aD !== st.alertDiesel) {
      if (aD && f !== null) log('danger', 'Alerta: combustible bajo (' + f.toFixed(1) + ' %)');
      else if (st.alertDiesel) log(f === null ? 'warn' : 'ok', f === null ? 'Nivel: lectura perdida' : 'Nivel fuera de la zona de alerta');
      st.alertDiesel = aD;
    }
  }

  function handle(d) {
    const parsed = T.parse(d);
    if (!parsed) { log('warn', 'Paquete ignorado: equipo o estructura no válidos'); return; }
    current = parsed;
    source = d.origen === 'entrada_controlada' ? 'Entradas controladas · MQTT' : d.origen === 'lectura_registrada' ? 'Lectura registrada · MQTT' : 'Sensores · MQTT';
    const now = Date.now();
    st.lastAt = now; st.count++;
    st.recorded = d.origen === 'lectura_registrada';
    const t = parsed.temp, f = parsed.fuel;
    pushHist(st.temp, now, t); pushHist(st.diesel, now, f);
    const aT = parsed.tempAlert, aD = parsed.fuelAlert;
    const label = d.equipo_id || 'Equipo';

    $('equipo').textContent = d.equipo_id || '—';
    $('agencia').textContent = d.agencia || '—';
    $('count').textContent = st.count.toLocaleString('es-MX');
    $('sub').textContent = (d.agencia ? d.agencia + ' · ' : '') + label;

    renderTemp(t, aT);
    renderDiesel(f, aD);
    renderGps(d.gps || {}, now, label);
    renderAlerts(t, f, aT, aD);
    transitions(aT, aD, t, f);
    $('raw').textContent = JSON.stringify(d, null, 2);
    if (trials) $('trial-status').textContent = 'Recibido del broker · ' + parsed.label + ' · ' + new Date(now).toLocaleTimeString('es-MX');
    tick();
  }

  function resetData() {
    Object.assign(st, { lastAt: 0, recorded: false, count: 0, temp: [], diesel: [], track: [], lastPos: null, lastPosAt: 0, alertTemp: null, alertDiesel: null, fix: null });
    if (trail) trail.setLatLngs([]);
    if (marker) { marker.remove(); marker = null; }
    current = null; source = '';
    renderTemp(null, false); renderDiesel(null, false);
    ['equipo','agencia','gps-lat','gps-lon','gps-raw','gps-age','raw'].forEach(id => $(id).textContent = '—');
    $('count').textContent = '0'; $('sub').textContent = 'Esperando datos…';
    $('alerts').hidden = true; $('gps-link').hidden = true;
    setBadge('gps-badge', 'Sin datos', 'muted');
    $('map-coords').querySelector('span').textContent = 'Sin posición';
    $('map-msg').hidden = false;
    $('map-msg').innerHTML = 'Esperando lecturas<small>El mapa mostrará la posición cuando llegue una fijación GPS válida.</small>';
    if (map) map.setView(CUCEI, 16);
    tick();
  }

  function setConn(state) { st.conn = state; if (state !== 'online') subscribed = false; trialButtons.forEach(b => b.disabled = !subscribed); tick(); }
  function tick() {
    const now = Date.now(), stale = st.lastAt && now - st.lastAt > STALE_MS;
    const pill = $('conn'), txt = pill.querySelector('span');
    if (st.conn === 'online') {
      if (!st.lastAt) { pill.dataset.lv = 'warn'; txt.textContent = 'Conectado · esperando datos'; }
      else if (stale) { pill.dataset.lv = 'warn'; txt.textContent = 'Conectado · sin datos recientes'; }
      else { pill.dataset.lv = 'ok'; txt.textContent = source.startsWith('Sensores') ? 'En vivo' : 'MQTT · recibiendo'; }
    } else if (st.conn === 'connecting') { pill.dataset.lv = 'warn'; txt.textContent = 'Conectando al broker…'; }
    else { pill.dataset.lv = 'danger'; txt.textContent = 'Desconectado'; }

    const up = $('updated');
    up.textContent = st.lastAt ? ago(now - st.lastAt) : '—';
    up.dataset.lv = stale ? 'warn' : '';
    $('gps-age').textContent = st.lastPosAt ? (st.fix && !stale && st.conn === 'online' ? 'Actual' : 'Última · ' + ago(now - st.lastPosAt)) : '—';
    setMarkerStale(!st.fix || stale || st.conn !== 'online');
    if (st.fix && (stale || st.conn !== 'online')) setBadge('gps-badge', 'Última posición', 'warn');
    const box = $('condition');
    let level = current ? current.level : 'muted', label = current ? current.label : 'Esperando lecturas';
    let decision = current ? current.action : 'Conecta el gateway para recibir los datos del equipo.';
    if (stale || st.conn === 'offline') {
      level = 'muted'; label = st.conn === 'offline' ? 'Sin conexión' : 'Sin datos recientes';
      decision = 'Revisa la red y el gateway. Las últimas lecturas se conservan como referencia; espera datos nuevos antes de evaluar el equipo.';
    }
    box.dataset.lv = level;
    $('condition-title').textContent = label; $('decision-text').textContent = decision;
    setBadge('source-badge', source || (trials ? 'Entradas controladas · MQTT' : 'Sensores · MQTT'), trials ? 'info' : 'muted');
    $('gps-note').textContent = current && current.fixed && !stale && st.conn === 'online' ? 'GPS con posición válida: consulta la ubicación del equipo en el mapa.' : 'GPS sin ubicación actual: verifica la señal antes de planear un traslado.';
  }
  setInterval(tick, 1000);

  let client = null;
  function connect() {
    subscribed = false;
    if (client) { try { client.end(true); } catch (_) {} client = null; }
    $('topic-badge').textContent = cfg.topic;
    if (typeof mqtt === 'undefined') { setConn('offline'); log('danger', 'No se pudo cargar MQTT. Revisa los archivos de la aplicación.'); return; }
    setConn('connecting');
    let c;
    try { c = mqtt.connect(cfg.broker, { clientId: 'maquirent_' + crypto.randomUUID().slice(0, 8), clean: true, reconnectPeriod: 4000, connectTimeout: 8000 }); }
    catch (error) { setConn('offline'); log('danger', 'No se pudo iniciar MQTT: ' + error.message); return; }
    client = c;
    c.on('connect', () => {
      if (c !== client) return;
      c.subscribe(cfg.topic, { qos: 0 }, (error, granted) => {
        if (c !== client) return;
        if (error || !granted || granted.some(g => g.qos === 128)) { setConn('offline'); log('danger', 'El broker rechazó la suscripción.'); return; }
        subscribed = true; setConn('online');
        log('info', 'Suscripción lista · ' + cfg.topic);
        if (trials) $('trial-status').textContent = 'Conexión lista. Elige un estado para enviarlo.';
      });
    });
    c.on('reconnect', () => { if (c === client) setConn('connecting'); });
    c.on('offline', () => { if (c === client) setConn('offline'); });
    c.on('close', () => { if (c === client) setConn('offline'); });
    c.on('error', e => { if (c === client) log('danger', 'Error MQTT: ' + e.message); });
    c.on('message', (topic, payload, packet) => {
      if (c !== client || topic !== cfg.topic) return;
      // Un mensaje retenido puede ser antiguo; no se presenta como lectura actual.
      if (packet.retain) { log('warn', 'Mensaje retenido ignorado; esperando una lectura nueva.'); return; }
      if (payload.length > 16384) { log('warn', 'Paquete ignorado: excede el tamaño esperado.'); return; }
      let data;
      try { data = JSON.parse(payload.toString()); } catch (_) { log('warn', 'Mensaje ignorado: no es JSON.'); return; }
      handle(data);
    });
  }

  const scenarios = { normal: [27, 70], precaucion: [33, 30], alerta: [38, 10] };
  function publishScenario() {
    if (!trials || !selectedScenario || !client || !client.connected || !subscribed) return;
    const [temp, fuel] = scenarios[selectedScenario];
    const data = { equipo_id: T.EQUIPO, agencia: 'Arrendadora Maquinaria Pesada', temp_motor: temp, nivel_diesel_pct: fuel,
      gps: { estado: 'SIN_SENAL_O_BUSCANDO', latitud: null, longitud: null },
      alerta_temp: temp > TEMP_MAX, alerta_combustible: fuel < DIESEL_MIN, origen: 'entrada_controlada' };
    client.publish(cfg.topic, JSON.stringify(data), { qos: 0, retain: false }, error => {
      if (error) { $('trial-status').textContent = 'No se pudo enviar el estado.'; log('danger', error.message); }
    });
  }
  trialButtons.forEach(button => button.addEventListener('click', () => {
    selectedScenario = button.dataset.scenario;
    trialButtons.forEach(b => { const active = b === button; b.classList.toggle('selected', active); b.setAttribute('aria-pressed', String(active)); });
    clearInterval(trialTimer); publishScenario(); trialTimer = setInterval(publishScenario, 2500);
  }));
  $('btn-trials').addEventListener('click', () => {
    clearInterval(trialTimer); selectedScenario = null;
    trials = !trials;
    if (trials) { savedCfg = { ...cfg }; cfg = { ...cfg, topic: cfg.topic + '/pruebas/' + crypto.randomUUID().slice(0, 8) }; }
    else { cfg = savedCfg; savedCfg = null; }
    $('trial-panel').hidden = !trials; $('btn-cfg').disabled = trials;
    $('btn-trials').textContent = trials ? 'Volver a sensores' : 'Pruebas de estados';
    $('trial-status').textContent = 'Conectando al tópico de pruebas…';
    trialButtons.forEach(b => { b.classList.remove('selected'); b.setAttribute('aria-pressed', 'false'); });
    resetData(); connect();
    log('info', trials ? 'Pruebas activadas en un tópico separado.' : 'Se restauró la conexión de los sensores.');
  });

  const dlg = $('cfg');
  $('btn-cfg').addEventListener('click', () => {
    $('cfg-broker').value = cfg.broker; $('cfg-topic').value = cfg.topic;
    $('cfg-error').hidden = true; dlg.returnValue = ''; dlg.showModal();
  });
  $('cfg-reset').addEventListener('click', () => { $('cfg-broker').value = DEFAULTS.broker; $('cfg-topic').value = DEFAULTS.topic; });
  $('cfg-form').addEventListener('submit', event => {
    if (!event.submitter || event.submitter.value !== 'save') return;
    const next = { broker: $('cfg-broker').value.trim(), topic: $('cfg-topic').value.trim() };
    if (!T.validConfig(next)) {
      event.preventDefault(); $('cfg-error').hidden = false;
      $('cfg-error').textContent = 'Usa una dirección wss:// sin credenciales y un tópico exacto, sin + ni #.';
    }
  });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'save') return;
    const next = { broker: $('cfg-broker').value.trim(), topic: $('cfg-topic').value.trim() };
    if (!T.validConfig(next)) return;
    cfg = next; saveCfg(cfg); resetData(); connect();
  });
  window.addEventListener('pagehide', () => { clearInterval(trialTimer); if (client) client.end(true); });
  connect();
})();
