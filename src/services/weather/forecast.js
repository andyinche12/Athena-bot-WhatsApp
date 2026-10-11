/**
 * Clima para Junín (Huancayo) usando Open-Meteo.
 * API gratuita, sin key, sin límites prácticos.
 * Docs: https://open-meteo.com/en/docs
 *
 * v2: añadido timeout, retry, y logs detallados de errores.
 */

const LAT = -11.15;
const LON = -75.99;
const TZ = 'America/Lima';

// Timeout para fetch (8 segundos)
const FETCH_TIMEOUT_MS = 8000;
// Reintentos máximos
const MAX_RETRIES = 2;

// Códigos WMO → descripción + emoji
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
 * Fetch con timeout usando AbortController.
 */
async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Obtiene el clima de hoy y mañana para Junín, con granularidad por franja.
 * Reintenta hasta MAX_RETRIES veces si falla.
 * @returns {Promise<{hoy: object, manana: object} | null>}
 */
export async function getWeather() {
  const url =
    `https://api.open-meteo.com/v1/forecast?` +
    `latitude=${LAT}&longitude=${LON}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&hourly=weather_code,temperature_2m,precipitation_probability` +
    `&timezone=${encodeURIComponent(TZ)}` +
    `&forecast_days=3`;

  console.log('🌤️ [Weather] Consultando Open-Meteo...');

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const t0 = Date.now();

    try {
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
      const elapsed = Date.now() - t0;

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const data = await res.json();

      // Validar estructura mínima
      if (!data.daily || !data.hourly || !data.daily.weather_code) {
        throw new Error('Respuesta inválida de Open-Meteo (faltan campos)');
      }

      const hoy = buildDayInfo(data, 0);
      const manana = buildDayInfo(data, 1);

      console.log(`   ✅ Open-Meteo OK (${elapsed}ms, intento ${attempt})`);
      return { hoy, manana };
    } catch (err) {
      const elapsed = Date.now() - t0;
      const isAbort = err.name === 'AbortError';
      const reason = isAbort ? 'TIMEOUT' : err.message;

      console.error(
        `   ⚠️  Intento ${attempt}/${MAX_RETRIES} falló (${elapsed}ms): ${reason}`
      );

      // Si es el último intento, dar up
      if (attempt === MAX_RETRIES) {
        console.error('   ❌ Open-Meteo falló todos los intentos');
        return null;
      }

      // Esperar antes de reintentar (backoff: 500ms, 1000ms)
      await new Promise((r) => setTimeout(r, attempt * 500));
    }
  }

  return null;
}

/**
 * Construye la info de un día específico (offset 0 = hoy, 1 = mañana).
 * Incluye franjas horarias: mañana, mediodía, tarde, noche.
 */
function buildDayInfo(data, dayOffset) {
  const { daily, hourly } = data;

  const code = daily.weather_code[dayOffset];
  const tMax = Math.round(daily.temperature_2m_max[dayOffset]);
  const tMin = Math.round(daily.temperature_2m_min[dayOffset]);
  const rainProb = daily.precipitation_probability_max[dayOffset];
  const info = codeInfo(code);

  const getSlot = (hour) => {
    const idx = dayOffset * 24 + hour;
    const c = hourly.weather_code[idx];
    const t = Math.round(hourly.temperature_2m[idx]);
    const r = hourly.precipitation_probability[idx];
    const ci = codeInfo(c);
    return { code: c, desc: ci.desc, emoji: ci.emoji, temp: t, rainProb: r };
  };

  return {
    code,
    desc: info.desc,
    emoji: info.emoji,
    tempMin: tMin,
    tempMax: tMax,
    rainProb,
    morning: getSlot(7),
    noon: getSlot(12),
    afternoon: getSlot(15),
    evening: getSlot(19),
    night: getSlot(22),
  };
}

/* ============================================================
 *  Formateadores
 * ============================================================ */

export function formatWeatherMorning(weather) {
  if (!weather) return null;

  const { hoy } = weather;
  const lines = [
    `${hoy.emoji} *Clima en Junín (hoy)*`,
    `Mañana: ${hoy.morning.emoji} ${hoy.morning.desc}, ${hoy.morning.temp}°C`,
    `Día: ${hoy.tempMin}° - ${hoy.tempMax}°C`,
  ];

  if (hoy.rainProb >= 50) {
    lines.push(`☔ Lluvia probable (${hoy.rainProb}%) — lleva paraguas`);
  } else if (hoy.rainProb >= 20) {
    lines.push(`🌦️ Posible lluvia (${hoy.rainProb}%)`);
  }

  return lines.join('\n');
}

export function formatWeatherMidday(weather) {
  if (!weather) return null;

  const { hoy } = weather;
  const lines = [
    `🌤️ *Clima ahora y en la tarde*`,
    `Mediodía: ${hoy.noon.emoji} ${hoy.noon.desc}, ${hoy.noon.temp}°C`,
    `Tarde (3 pm): ${hoy.afternoon.emoji} ${hoy.afternoon.desc}, ${hoy.afternoon.temp}°C`,
  ];

  const maxRain = Math.max(hoy.noon.rainProb, hoy.afternoon.rainProb);
  if (maxRain >= 50) {
    lines.push(`☔ Lluvia probable (${maxRain}%) — lleva paraguas`);
  } else if (maxRain >= 20) {
    lines.push(`🌦️ Posible lluvia (${maxRain}%)`);
  }

  return lines.join('\n');
}

export function formatWeatherEvening(weather) {
  if (!weather) return null;

  const { hoy, manana } = weather;
  const lines = [
    `🌙 *Clima de esta noche y mañana*`,
    `Hoy noche: ${hoy.night.emoji} ${hoy.night.desc}, ${hoy.night.temp}°C`,
    `Mañana: ${manana.emoji} ${manana.desc}, ${manana.tempMin}° - ${manana.tempMax}°C`,
    `Mañana temprano: ${manana.morning.emoji} ${manana.morning.desc}, ${manana.morning.temp}°C`,
  ];

  if (manana.rainProb >= 50) {
    lines.push(`☔ Lluvia probable mañana (${manana.rainProb}%) — lleva paraguas`);
  } else if (manana.rainProb >= 20) {
    lines.push(`🌦️ Posible lluvia mañana (${manana.rainProb}%)`);
  }

  return lines.join('\n');
}

export function formatWeatherTomorrow(weather) {
  if (!weather) return null;

  const { manana } = weather;
  const lines = [
    `${manana.emoji} *Clima mañana en Junín*`,
    `Mañana: ${manana.morning.emoji} ${manana.morning.desc}, ${manana.morning.temp}°C`,
    `Tarde: ${manana.afternoon.emoji} ${manana.afternoon.desc}, ${manana.afternoon.temp}°C`,
    `Rango: ${manana.tempMin}° - ${manana.tempMax}°C`,
  ];

  if (manana.rainProb >= 50) {
    lines.push(`☔ Lluvia probable (${manana.rainProb}%) — lleva paraguas`);
  }

  return lines.join('\n');
}