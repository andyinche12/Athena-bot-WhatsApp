import cron from 'node-cron';
import http from 'http';
import { config } from '../config/env.js';
import { sendText } from '../services/whatsapp/client.js';
import {
  getToday,
  getTomorrow,
  getClassesForDay,
} from '../syllabus/schedule.js';
import {
  getCurrentWeek,
  getTopicForWeek,
  getNextWeekTopics,
} from '../syllabus/topics.js';
import {
  createStudyConfirmation,
  getPendingTasks,
  getRecentMessages,
  getFlashcards,
  getStudyStats,
} from '../memory/store.js';
import {
  getWeather,
  formatWeatherMorning,
  formatWeatherMidday,
  formatWeatherEvening,
  formatWeatherTomorrow,
} from '../services/weather/forecast.js';

const DAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/**
 * Envía un mensaje a todos los owners (número + LID, sin duplicados).
 */
async function broadcast(text) {
  // WhatsApp moderno usa LID (nuevo formato). Si hay LID, usamos SOLO LID
  // (evita enviar 2 veces al mismo usuario). Si no hay, caemos al número clásico.
  const targets = config.ownerLids.length > 0 ? config.ownerLids : config.owners;

  for (const owner of targets) {
    try {
      await sendText(owner, text);
      console.log(`📤 Recordatorio enviado a ${owner}`);
    } catch (err) {
      console.error(`❌ Error enviando a ${owner}:`, err.message);
    }
  }
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Fusiona bloques consecutivos del mismo curso (por el refrigerio).
 * Ej: Lunes tiene comprensión inglés de 10:15-11:00 y 11:20-12:50
 *     → se convierte en 10:15-12:50 (con refrigerio)
 */
function mergeAdjacentClasses(classes) {
  const out = [];
  for (const c of classes) {
    const last = out[out.length - 1];
    if (last && last.courseKey === c.courseKey) {
      const hasBreak = last.end !== c.start;
      last.end = c.end;
      last.blocks = (last.blocks || 0) + c.blocks;
      if (hasBreak) last.hasBreak = true;
    } else {
      out.push({ ...c, hasBreak: false });
    }
  }
  return out;
}

/* ============================================================
 *  07:00 — Clima mañana + clases del día
 * ============================================================ */
async function reminderToday() {
  console.log('\n☀️ [CRON] Recordatorio de hoy (07:00)');

  const today = new Date();
  const dayName = DAYS_ES[today.getDay()];
  const classes = getToday();

  const weather = await getWeather();
  const weatherMorning = formatWeatherMorning(weather);

  const lines = [`☀️ *Buenos días, mi amor*\n`];

  if (weatherMorning) {
    lines.push(weatherMorning);
    lines.push('');
  }

  if (classes.length === 0) {
    lines.push(`Hoy ${dayName} no tienes clases. ¡Descansa!`);
  } else {
    const merged = mergeAdjacentClasses(classes);
    lines.push(`📚 *Tus clases de hoy:*\n`);

    const week = getCurrentWeek();
    for (const c of merged) {
      const timeRange = c.hasBreak
        ? `${c.start} - ${c.end} (con refrigerio)`
        : `${c.start} - ${c.end}`;
      lines.push(`⏰ ${timeRange}`);
      lines.push(`📖 ${c.course.name}`);
      lines.push(`👨‍🏫 ${c.course.teacher}`);

      const topic = getTopicForWeek(c.courseKey, week);
      if (topic) {
        lines.push(`📌 SEM-${String(week).padStart(2, '0')}: ${topic.topic}`);
      }
      lines.push('');
    }

    lines.push('¡Mucho éxito hoy, corazón! 💪');
  }

  await broadcast(lines.join('\n'));
}

/* ============================================================
 *  12:00 — Clima mediodía + tarde
 * ============================================================ */
async function middayWeather() {
  console.log('\n🌤️ [CRON] Clima mediodía (12:00)');

  const weather = await getWeather();
  const weatherMidday = formatWeatherMidday(weather);

  if (!weatherMidday) {
    console.log('   Sin datos de clima, saltando');
    return;
  }

  const lines = [
    `🌤️ *Clima de mediodía*`,
    '',
    weatherMidday,
    '',
    'Cuídate del sol si sales, mi amor 😎',
  ];

  await broadcast(lines.join('\n'));
}

/* ============================================================
 *  19:00 — Clima noche + mañana + clases mañana + pregunta
 * ============================================================ */
async function reminderTomorrow() {
  console.log('\n🌙 [CRON] Recordatorio de mañana (19:00)');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayName = DAYS_ES[tomorrow.getDay()];
  const classes = getTomorrow();

  const weather = await getWeather();
  const weatherEvening = formatWeatherEvening(weather);

  const lines = [`🌙 *Recordatorio para mañana* (${dayName})\n`];

  if (weatherEvening) {
    lines.push(weatherEvening);
    lines.push('');
  }

  if (classes.length === 0) {
    lines.push(`Mañana no tienes clases. Descansa 😴`);
    await broadcast(lines.join('\n'));
    return;
  }

  const merged = mergeAdjacentClasses(classes);
  lines.push(`📚 *Tus clases de mañana:*\n`);

  const week = getCurrentWeek() + 1;
  const toConfirm = [];

  for (const c of merged) {
    const timeRange = c.hasBreak
      ? `${c.start} - ${c.end} (con refrigerio)`
      : `${c.start} - ${c.end}`;
    lines.push(`⏰ ${timeRange}`);
    lines.push(`📖 ${c.course.name}`);

    const topic = getTopicForWeek(c.courseKey, week);
    if (topic) {
      lines.push(`📌 SEM-${String(week).padStart(2, '0')}: ${topic.topic}`);
      toConfirm.push({ courseKey: c.courseKey, courseName: c.course.name });
    }

    lines.push('');
  }

  lines.push('¿Ya repasaste algo para mañana, mi amor?');
  lines.push('✅ *sí estudié*');
  lines.push('❌ *no estudié*');

  // Igual que broadcast: usar solo LID si está disponible
  const targets = config.ownerLids.length > 0 ? config.ownerLids : config.owners;
  for (const owner of targets) {
    for (const tc of toConfirm) {
      try {
        await createStudyConfirmation(owner, tc.courseKey, tomorrowISO());
      } catch (err) {
        console.error('Error guardando confirmación:', err.message);
      }
    }
  }

  await broadcast(lines.join('\n'));
}

/* ============================================================
 *  20:30 — Repaso nocturno
 * ============================================================ */
async function eveningReview() {
  console.log('\n🌜 [CRON] Repaso nocturno (20:30)');

  const today = new Date();
  const weather = await getWeather();
  const weatherTomorrow = formatWeatherTomorrow(weather);
  const classesTomorrow = getTomorrow();
  const week = getCurrentWeek() + 1;

  const lines = [`🌜 *Repaso del día*\n`];

  try {
    const lastMessages = await getRecentMessages(config.owners[0], 30);
    const userMessages = lastMessages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .slice(-15);

    if (userMessages.length > 0) {
      lines.push(`📝 *Hoy hablamos de:*`);
      for (const msg of userMessages.slice(-5)) {
        const clean = msg.replace(/\s+/g, ' ').trim();
        const short = clean.length > 100 ? clean.slice(0, 100) + '...' : clean;
        lines.push(`• ${short}`);
      }
      lines.push('');
    }
  } catch (err) {
    console.error('Error obteniendo resumen:', err.message);
  }

  try {
    const pendingTasks = await getPendingTasks(config.owners[0]);
    if (pendingTasks.length > 0) {
      lines.push(`📋 *Tienes ${pendingTasks.length} tarea(s) pendiente(s):*`);
      for (const task of pendingTasks.slice(0, 5)) {
        const due = task.due_date ? ` (vence: ${task.due_date})` : '';
        lines.push(`• ${task.title}${due}`);
      }
      lines.push('');
    }
  } catch (err) {
    console.error('Error obteniendo tareas:', err.message);
  }

  if (weatherTomorrow) {
    lines.push(weatherTomorrow);
    lines.push('');
  }

  if (classesTomorrow.length > 0) {
    const merged = mergeAdjacentClasses(classesTomorrow);
    lines.push(`📚 *Mañana (${DAYS_ES[(today.getDay() + 1) % 7]}):*`);
    for (const c of merged) {
      const topic = getTopicForWeek(c.courseKey, week);
      lines.push(`⏰ ${c.start} ${c.course.short}`);
      if (topic) {
        lines.push(`📌 ${topic.topic}`);
      }
    }
    lines.push('');
  } else {
    lines.push(`📚 Mañana no tienes clases.`);
    lines.push('');
  }

  lines.push('Que descanses, mi amor 😴');

  await broadcast(lines.join('\n'));
}

/* ============================================================
 *  Domingo 20:00 — Resumen semanal (legacy, se mantiene por compat)
 * ============================================================ */
async function reminderWeeklyPreview() {
  console.log('\n📊 [CRON] Resumen semanal (domingo 20:00)');

  const { week, range, courses } = getNextWeekTopics();

  const lines = [`📊 *Resumen de la semana*\n`];

  try {
    const study = await getStudyStats(config.owners[0], 7);
    lines.push(`📚 *Estudio*`);
    if (study.total === 0) {
      lines.push(`• Sin confirmaciones esta semana`);
    } else {
      const pct = Math.round((study.studied / study.total) * 100);
      lines.push(`✅ Confirmaste estudio: *${study.studied}/${study.total}* días (${pct}%)`);
      if (pct >= 70) lines.push(`🔥 ¡Gran semana, sigue así!`);
      else if (pct >= 40) lines.push(`👍 Buen ritmo, puedes más.`);
      else lines.push(`💪 Vamos a subir ese ritmo esta semana.`);
    }
    lines.push('');
  } catch (err) {
    console.error('Error stats estudio:', err.message);
  }

  try {
    const tasks = await getPendingTasks(config.owners[0]);
    if (tasks.length === 0) {
      lines.push(`📝 *Tareas: ✅ Todo al día*`);
    } else {
      lines.push(`📝 *Tareas pendientes: ${tasks.length}*`);
      for (const t of tasks.slice(0, 5)) {
        const due = t.due_date ? ` — 📅 ${t.due_date}` : '';
        lines.push(`• ${t.title}${due}`);
      }
      if (tasks.length > 5) lines.push(`_(+${tasks.length - 5} más)_`);
    }
    lines.push('');
  } catch (err) {
    console.error('Error stats tareas:', err.message);
  }

  try {
    const cards = await getFlashcards(config.owners[0]);
    if (cards.length > 0) {
      const total = cards.length;
      const mastered = cards.filter(
        (c) => c.times_shown >= 3 && c.times_right / c.times_shown >= 0.8
      ).length;
      const toReview = total - mastered;

      lines.push(`🎴 *Flashcards*`);
      lines.push(`• Total: ${total}`);
      lines.push(`• ✅ Dominadas: ${mastered}`);
      lines.push(`• 📖 Por repasar: ${toReview}`);
      lines.push(`_Practica con !quiz_`);
      lines.push('');
    }
  } catch (err) {
    console.error('Error stats flashcards:', err.message);
  }

  lines.push(`📅 *Semana ${week} empieza mañana*`);
  lines.push(`_${range}_\n`);

  for (const c of courses.slice(0, 4)) {
    lines.push(`📚 *${c.courseName}*`);
    lines.push(`📖 ${c.topic}\n`);
  }

  if (courses.length > 4) {
    lines.push(`_(+${courses.length - 4} cursos más)_\n`);
  }

  lines.push('💪 ¡Buena semana, mi amor!');

  await broadcast(lines.join('\n'));
}

/* ============================================================
 *  Domingo 20:00 — 🌙 Preparando el lunes
 * ============================================================ */
export async function sendSundayPrep() {
  console.log('\n🌙 [CRON] Preparando el lunes (domingo 20:00)');

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const lunesIdx = tomorrow.getDay();
  const lunesName = DAYS_ES[lunesIdx];

  const lunesClasses = getClassesForDay(lunesIdx);
  const nextWeek = getCurrentWeek() + 1;

  // 🌤️ Clima del lunes
  let weatherBlock = '';
  try {
    const weather = await getWeather();
    if (weather?.manana) {
      const m = weather.manana;
      const lines = [
        '🌤️ *Clima mañana*',
        `${m.emoji} ${m.desc}, ${m.tempMin}° - ${m.tempMax}°C`,
        `Mañana: ${m.morning.temp}°C · Tarde: ${m.afternoon.temp}°C`,
      ];
      if (m.rainProb >= 40) {
        lines.push(`☔ Probabilidad de lluvia: ${m.rainProb}% — lleva paraguas`);
      }
      weatherBlock = lines.join('\n');
    }
  } catch (err) {
    console.error('Error clima en sendSundayPrep:', err.message);
  }

  // 📚 Clases del lunes (con merge)
  let classesBlock = '';
  if (lunesClasses.length === 0) {
    classesBlock = `📚 Mañana ${lunesName} no tienes clases. ¡Descansa! 🎉`;
  } else {
    const merged = mergeAdjacentClasses(lunesClasses);
    const lines = [
      `📚 *Tus clases del ${lunesName}* (SEM-${String(nextWeek).padStart(2, '0')})`,
      '',
    ];

    for (const c of merged) {
      const timeRange = c.hasBreak
        ? `${c.start} - ${c.end} (con refrigerio)`
        : `${c.start} - ${c.end}`;
      lines.push(`⏰ ${timeRange}`);
      lines.push(`📖 ${c.course.name}`);
      lines.push(`👨‍🏫 ${c.course.teacher}`);

      const topic = getTopicForWeek(c.courseKey, nextWeek);
      if (topic) lines.push(`📌 ${topic.topic}`);
      lines.push('');
    }
    classesBlock = lines.join('\n').trim();
  }

  // 📅 Preview martes → viernes
  const previewLines = [];
  for (let i = 2; i <= 6; i++) {
    const dayIdx = (lunesIdx + (i - 1)) % 7;
    const classes = getClassesForDay(dayIdx);
    if (classes.length > 0) {
      const unique = [...new Set(classes.map((c) => c.course.short))];
      const dayShort = DAYS_ES[dayIdx].slice(0, 3);
      previewLines.push(
        `• ${dayShort.charAt(0).toUpperCase() + dayShort.slice(1)}: ${unique.join(' + ')}`
      );
    }
  }

  // 📝 Tareas pendientes
  let taskLine = '';
  try {
    const tasks = await getPendingTasks(config.owners[0]);
    if (tasks.length > 0) {
      const word = tasks.length === 1 ? 'tarea pendiente' : 'tareas pendientes';
      taskLine = `📝 Tienes *${tasks.length}* ${word} — usa !pendientes`;
    }
  } catch (err) {
    console.error('Error tareas en sendSundayPrep:', err.message);
  }

  // Ensamblado
  const parts = ['🌙 *Preparando el lunes*'];
  if (weatherBlock) parts.push('', weatherBlock);
  if (classesBlock) parts.push('', classesBlock);
  if (previewLines.length > 0) {
    parts.push('', `📅 *Semana ${nextWeek} — resto de días*`, ...previewLines);
  }
  if (taskLine) parts.push('', taskLine);
  parts.push('', 'Que descanses, mi amor 😴');

  await broadcast(parts.join('\n'));
}

/* ============================================================
 *  Self-ping anti-dormir Render
 * ============================================================ */
function startSelfPing() {
  const PORT = process.env.PORT || 3000;
  const ping = () => {
    const req = http.get(
      { host: 'localhost', port: PORT, path: '/health', timeout: 5000 },
      (res) => {
        res.resume();
      }
    );
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
  };

  setInterval(ping, 10 * 60 * 1000);
  console.log('🔄 Self-ping activo cada 10 min');
}

/* ============================================================
 *  Arranque de todos los cron jobs
 * ============================================================ */
export function startCronJobs() {
  cron.schedule('0 7 * * *', reminderToday, { timezone: 'America/Lima' });
  cron.schedule('0 12 * * *', middayWeather, { timezone: 'America/Lima' });
  cron.schedule('0 19 * * *', reminderTomorrow, { timezone: 'America/Lima' });
  cron.schedule('30 20 * * *', eveningReview, { timezone: 'America/Lima' });

  // 🆕 Domingo 20:00 → Preparando el lunes (reemplaza al resumen legacy)
  cron.schedule('0 20 * * 0', sendSundayPrep, { timezone: 'America/Lima' });

  console.log('⏰ Cron jobs activos:');
  console.log('   • 07:00 diario → clima mañana + clases del día');
  console.log('   • 12:00 diario → clima mediodía + tarde');
  console.log('   • 19:00 diario → clima noche + mañana + clases mañana');
  console.log('   • 20:30 diario → repaso nocturno');
  console.log('   • Domingo 20:00 → 🌙 Preparando el lunes');

  startSelfPing();
}

export {
  reminderTomorrow,
  reminderToday,
  reminderWeeklyPreview,
  eveningReview,
  middayWeather,
};