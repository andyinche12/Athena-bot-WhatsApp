/**
 * Clima para Junín (Huancayo) usando Open-Meteo.
 * API gratuita, sin key, sin límites prácticos.
 * Docs: https://open-meteo.com/en/docs
 *
 * v5 — Fixes anti-cold-start de Render:
 *   • Timeout 8s → 15s (aguanta cold start de Render free)
 *   • Reintentos 2 → 3 (más margen ante red inestable)
 *   • Fallback a cache vieja si la API falla (el bot nunca se queda sin clima)
 *   • Timeout ahora cubre también el .json() (no solo las cabeceras)
 */

const LAT = -11.15;
const LON = -75.99;
const TZ = 'America/Lima';

// Timeout para fetch + parseo (15 segundos → aguanta cold start de Render)
const FETCH_TIMEOUT_MS = 15000;
// Reintentos máximos
const MAX_RETRIES = 3;
// Caché: tiempo de vida en ms (10 minutos)
const CACHE_TTL_MS = 10 * 60 * 1000;
// Caché "vieja" de emergencia: si la API falla, usamos datos de hasta 2 horas atrás
const STALE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

/* ============================================================
 *  Caché en memoria
 * ============================================================ */
let _cache = null;
let _cacheTime = 0;

function isCacheValid() {
  return _cache && Date.now() - _cacheTime < CACHE_TTL_MS;
}

function isStaleCacheUsable() {
  return _cache && Date.now() - _cacheTime < STALE_CACHE_TTL_MS;
}

/* ============================================================
 *  Códigos WMO → descripción + emoji base
 * ============================================================ */
const WEATHER_CODES = {
  0:  { desc: 'Despejado',            emoji: '☀️' },
  1:  { desc: 'Mayormente despejado', emoji: '🌤️' },
  2:  { desc: 'Parcialmente nublado', emoji: '⛅' },
  3:  { desc: 'Nublado',              emoji: '☁️' },
  45: { desc: 'Niebla',               emoji: '🌫️' },
  48: { desc: 'Niebla con escarcha',  emoji: '🌫️' },
  51: { desc: 'Llovizna ligera',      emoji: '🌦️' },
  53: { desc: 'Llovizna moderada',    emoji: '🌦️' },
  55: { desc: 'Llovizna intensa',     emoji: '🌧️' },
  61: { desc: 'Lluvia ligera',        emoji: '🌧️' },
  63: { desc: 'Lluvia moderada',      emoji: '🌧️' },
  65: { desc: 'Lluvia fuerte',        emoji: '🌧️' },
  71: { desc: 'Nevada ligera',        emoji: '🌨️' },
  73: { desc: 'Nevada moderada',      emoji: '🌨️' },
  75: { desc: 'Nevada fuerte',        emoji: '❄️' },
  80: { desc: 'Chubascos ligeros',    emoji: '🌦️' },
  81: { desc: 'Chubascos moderados',  emoji: '🌧️' },
  82: { desc: 'Chubascos fuertes',    emoji: '⛈️' },
  95: { desc: 'Tormenta eléctrica',   emoji: '⛈️' },
  96: { desc: 'Tormenta con granizo', emoji: '⛈️' },
  99: { desc: 'Tormenta fuerte',      emoji: '⛈️' },
};

function codeInfo(code) {
  return WEATHER_CODES[code] || { desc: 'Clima variable', emoji: '🌡️' };
}

/**
 * Devuelve el emoji apropiado según el código WMO y la hora del día.
 * Ajusta solo los códigos "despejados" para reflejar día vs noche.
 */
function emojiForHour(code, hour) {
  const base = codeInfo(code).emoji;

  if (code === 0 || code === 1) {
    if (hour >= 19 || hour < 6) {
      return code === 0 ? '🌙' : '☁️';
    }
    if (hour >= 12 && hour < 18) {
      return code === 0 ? '☀️' : '🌤️';
    }
    return code === 0 ? '☀️' : '🌤️';
  }

  return base;
}

/**
 * Convierte grados a punto cardinal (N, NE, E, etc.)
 */
function windDirection(degrees) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return dirs[Math.round(degrees / 45) % 8];
}

/**
 * Nivel de UV según el índice.
 */
function uvLevel(uv) {
  if (uv <= 2) return { level: 'bajo', emoji: '🟢' };
  if (uv <= 5) return { level: 'moderado', emoji: '🟡' };
  if (uv <= 7) return { level: 'alto', emoji: '🟠' };
  if (uv <= 10) return { level: 'muy alto', emoji: '🔴' };
  return { level: 'extremo', emoji: '🟣' };
}

/**
 * Formatea una hora ISO (2026-10-11T06:12) → "06:12"
 */
function formatHour(isoStr) {
  if (!isoStr) return '';
  const t = isoStr.split('T')[1];
  return t ? t.slice(0, 5) : '';
}

/* ============================================================
 *  Fetch con timeout (ahora cubre TODO: headers + body + json parse)
 * ============================================================ */
async function fetchWeatherJSON(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    // .json() TAMBIÉN está protegido por el mismo timeout
    const data = await res.json();
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/* ============================================================
 *  getWeather() — con caché, retry y fallback a cache vieja
 * ============================================================ */
export async function getWeather() {
  // Caché válida → devolver sin llamar a la API
  if (isCacheValid()) {
    const ageMin = Math.round((Date.now() - _cacheTime) / 60000);
    console.log(`🌤️ [Weather] Usando caché (${ageMin} min)`);
    return _cache;
  }

  const url =
    `https://api.open-meteo.com/v1/forecast?` +
    `latitude=${LAT}&longitude=${LON}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max,wind_speed_10m_max` +
    `&hourly=weather_code,temperature_2m,apparent_temperature,precipitation_probability,relative_humidity_2m,wind_speed_10m,wind_direction_10m` +
    `&timezone=${encodeURIComponent(TZ)}` +
    `&forecast_days=3`;

  console.log('🌤️ [Weather] Consultando Open-Meteo...');

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const t0 = Date.now();
    try {
      const data = await fetchWeatherJSON(url, FETCH_TIMEOUT_MS);
      const elapsed = Date.now() - t0;

      if (!data.daily || !data.hourly || !data.daily.weather_code) {
        throw new Error('Respuesta inválida de Open-Meteo (faltan campos)');
      }

      const hoy = buildDayInfo(data, 0);
      const manana = buildDayInfo(data, 1);

      // Guardar en caché
      _cache = { hoy, manana };
      _cacheTime = Date.now();

      console.log(`   ✅ Open-Meteo OK (${elapsed}ms, intento ${attempt})`);
      return _cache;
    } catch (err) {
      const elapsed = Date.now() - t0;
      const reason = err.name === 'AbortError' ? 'TIMEOUT' : err.message;
      console.error(
        `   ⚠️  Intento ${attempt}/${MAX_RETRIES} falló (${elapsed}ms): ${reason}`
      );
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, attempt * 800));
      }
    }
  }

  // ❌ Todos los intentos fallaron
  console.error('   ❌ Open-Meteo falló todos los intentos');

  // Fallback: usar cache vieja si existe (hasta 2 horas de antigüedad)
  if (isStaleCacheUsable()) {
    const ageMin = Math.round((Date.now() - _cacheTime) / 60000);
    console.warn(`   ⚠️  Usando cache VIEJA (${ageMin} min de antigüedad)`);
    return _cache;
  }

  console.error('   ❌ No hay cache de respaldo');
  return null;
}

/* ============================================================
 *  Construcción de un día
 * ============================================================ */
function buildDayInfo(data, dayOffset) {
  const { daily, hourly } = data;

  const code = daily.weather_code[dayOffset];
  const tMax = Math.round(daily.temperature_2m_max[dayOffset]);
  const tMin = Math.round(daily.temperature_2m_min[dayOffset]);
  const rainProb = daily.precipitation_probability_max[dayOffset];
  const info = codeInfo(code);
  const sunrise = formatHour(daily.sunrise?.[dayOffset]);
  const sunset = formatHour(daily.sunset?.[dayOffset]);
  const uvMax = daily.uv_index_max?.[dayOffset] ?? null;
  const windMax = daily.wind_speed_10m_max?.[dayOffset] ?? null;

  const getSlot = (hour) => {
    const idx = dayOffset * 24 + hour;
    const c = hourly.weather_code[idx];
    const t = Math.round(hourly.temperature_2m[idx]);
    const feels = Math.round(hourly.apparent_temperature?.[idx] ?? t);
    const r = hourly.precipitation_probability[idx];
    const humidity = hourly.relative_humidity_2m?.[idx] ?? null;
    const windSpd = Math.round(hourly.wind_speed_10m?.[idx] ?? 0);
    const windDir = hourly.wind_direction_10m?.[idx] ?? 0;
    const ci = codeInfo(c);
    const emoji = emojiForHour(c, hour);

    return {
      code: c,
      desc: ci.desc,
      emoji,
      temp: t,
      feels,
      rainProb: r,
      humidity,
      windSpd,
      windDir: windDirection(windDir),
    };
  };

  return {
    code,
    desc: info.desc,
    emoji: info.emoji,
    tempMin: tMin,
    tempMax: tMax,
    rainProb,
    sunrise,
    sunset,
    uvMax,
    windMax,
    morning: getSlot(7),
    noon: getSlot(12),
    afternoon: getSlot(15),
    evening: getSlot(19),
    night: getSlot(22),
  };
}

/* ============================================================
 *  Helpers para generar la línea de cada franja
 * ============================================================ */
function slotLine(label, slot) {
  const temp = `${slot.emoji} ${slot.desc}, ${slot.temp}°C`;
  const feels = slot.feels !== slot.temp ? `(ST ${slot.feels}°C)` : '';
  return `${label}: ${temp} ${feels}`.trim();
}

function rainAlert(prob) {
  if (prob >= 70) return `☔ Lluvia muy probable (${prob}%) — paraguas obligatorio`;
  if (prob >= 50) return `🌧️ Lluvia probable (${prob}%) — lleva paraguas`;
  if (prob >= 20) return `🌦️ Posible lluvia (${prob}%)`;
  return null;
}

function uvAlert(uv) {
  if (uv === null || uv === undefined) return null;
  const { level, emoji } = uvLevel(uv);
  if (uv >= 6) return `${emoji} UV ${level} (${uv.toFixed(1)}) — usa protector solar`;
  return null;
}

function windAlert(wind) {
  if (wind === null || wind === undefined) return null;
  if (wind >= 40) return `💨 Viento fuerte (${Math.round(wind)} km/h)`;
  if (wind >= 25) return `💨 Viento moderado (${Math.round(wind)} km/h)`;
  return null;
}

/* ============================================================
 *  Formateadores públicos
 * ============================================================ */

export function formatWeatherMorning(weather) {
  if (!weather) return null;

  const { hoy } = weather;
  const lines = [
    `${hoy.emoji} *Clima en Junín (hoy)*`,
    slotLine('Mañana', hoy.morning),
    `Día: ${hoy.tempMin}° - ${hoy.tempMax}°C`,
    `🌅 ${hoy.sunrise} · 🌇 ${hoy.sunset}`,
  ];

  const r = rainAlert(hoy.rainProb);
  if (r) lines.push(r);

  return lines.join('\n');
}

export function formatWeatherMidday(weather) {
  if (!weather) return null;

  const { hoy } = weather;
  const lines = [
    `🌤️ *Clima ahora y en la tarde*`,
    slotLine('Mediodía', hoy.noon),
    slotLine('Tarde (3 pm)', hoy.afternoon),
    `💧 Humedad: ${hoy.noon.humidity}% · 💨 Viento: ${hoy.noon.windSpd} km/h ${hoy.noon.windDir}`,
  ];

  const maxRain = Math.max(hoy.noon.rainProb, hoy.afternoon.rainProb);
  const r = rainAlert(maxRain);
  if (r) lines.push(r);

  const u = uvAlert(hoy.uvMax);
  if (u) lines.push(u);

  return lines.join('\n');
}

export function formatWeatherEvening(weather) {
  if (!weather) return null;

  const { hoy, manana } = weather;
  const lines = [
    `🌙 *Clima de esta noche y mañana*`,
    slotLine('Hoy noche', hoy.night),
    slotLine('Mañana temprano', manana.morning),
    `Mañana: ${manana.tempMin}° - ${manana.tempMax}°C`,
  ];

  const r = rainAlert(manana.rainProb);
  if (r) lines.push(`☔ Mañana: ${r.replace(/^[^\w]*\s*/, '')}`);

  return lines.join('\n');
}

export function formatWeatherTomorrow(weather) {
  if (!weather) return null;

  const { manana } = weather;
  const lines = [
    `${manana.emoji} *Clima mañana en Junín*`,
    slotLine('Mañana', manana.morning),
    slotLine('Tarde', manana.afternoon),
    `Rango: ${manana.tempMin}° - ${manana.tempMax}°C`,
    `🌅 ${manana.sunrise} · 🌇 ${manana.sunset}`,
  ];

  const r = rainAlert(manana.rainProb);
  if (r) lines.push(r);

  const u = uvAlert(manana.uvMax);
  if (u) lines.push(u);

  const w = windAlert(manana.windMax);
  if (w) lines.push(w);

  return lines.join('\n');
}

/**
 * Formato completo (usado por !clima).
 */
export function formatWeatherFull(weather) {
  if (!weather) return null;

  return [
    formatWeatherMorning(weather),
    '',
    formatWeatherMidday(weather),
    '',
    formatWeatherEvening(weather),
  ].join('\n');
}

/**
 * Invalida la caché manualmente (útil para tests o forzar refresh).
 */
export function clearWeatherCache() {
  _cache = null;
  _cacheTime = 0;
  console.log('🌤️ [Weather] Caché invalidada');
}