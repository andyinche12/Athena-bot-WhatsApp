import cron from 'node-cron';
import http from 'http';
import { config } from '../config/env.js';
import { sendText } from '../services/whatsapp/client.js';
import {
  getToday,
  getTomorrow,
} from '../syllabus/schedule.js';
import {
  getCurrentWeek,
  getTopicForWeek,
  getNextWeekTopics,
} from '../syllabus/topics.js';
import { createStudyConfirmation } from '../memory/store.js';

const DAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

async function broadcast(text) {
  for (const owner of config.owners) {
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
 * 19:00 — Recordatorio de mañana con tema + pregunta de confirmación
 */
async function reminderTomorrow() {
  console.log('\n⏰ [CRON] Recordatorio de mañana (19:00)');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayName = DAYS_ES[tomorrow.getDay()];
  const classes = getTomorrow();

  if (classes.length === 0) {
    await broadcast(
      `🌙 Buenas noches, Werner.\n\nMañana ${dayName} no tienes clases. Descansa 😴`
    );
    return;
  }

  const week = getCurrentWeek() + 1;
  const lines = [`🌙 *Recordatorio para mañana* (${dayName})\n`];
  const toConfirm = [];

  for (const c of classes) {
    lines.push(`⏰ ${c.start} - ${c.end}`);
    lines.push(`📚 *${c.course.name}*`);

    const topic = getTopicForWeek(c.courseKey, week);
    if (topic) {
      lines.push(`📖 SEM-${String(week).padStart(2, '0')}: ${topic.topic}`);
      toConfirm.push({ courseKey: c.courseKey, courseName: c.course.name });
    }

    lines.push('');
  }

  lines.push('¿Ya repasaste algo para mañana? Responde:');
  lines.push('✅ *sí estudié*');
  lines.push('❌ *no estudié*');

  // Registrar la pregunta para cada curso
  for (const owner of config.owners) {
    for (const tc of toConfirm) {
      try {
        createStudyConfirmation(owner, tc.courseKey, tomorrowISO());
      } catch (err) {
        console.error('Error guardando confirmación:', err.message);
      }
    }
  }

  await broadcast(lines.join('\n'));
}

/**
 * 07:00 — Clases del día
 */
async function reminderToday() {
  console.log('\n☀️ [CRON] Recordatorio de hoy (07:00)');

  const today = new Date();
  const dayName = DAYS_ES[today.getDay()];
  const classes = getToday();

  if (classes.length === 0) {
    if (today.getDay() === 0 || today.getDay() === 6) return;
    await broadcast(`☀️ Buenos días, Werner.\n\nHoy ${dayName} no tienes clases. ¡Buen día! 😊`);
    return;
  }

  const week = getCurrentWeek();
  const lines = [`☀️ *Buenos días, Werner*\n`, `Hoy es ${dayName} y tienes:\n`];

  for (const c of classes) {
    lines.push(`⏰ ${c.start} - ${c.end}`);
    lines.push(`📚 *${c.course.name}*`);
    lines.push(`👨‍🏫 ${c.course.teacher}`);

    const topic = getTopicForWeek(c.courseKey, week);
    if (topic) {
      lines.push(`📖 SEM-${String(week).padStart(2, '0')}: ${topic.topic}`);
    }
    lines.push('');
  }

  lines.push('¡Mucho éxito! 💪');
  await broadcast(lines.join('\n'));
}

/**
 * Domingo 19:00 — Vista previa de la semana
 */
async function reminderWeeklyPreview() {
  console.log('\n📅 [CRON] Vista previa semanal (domingo 19:00)');

  const { week, range, courses } = getNextWeekTopics();
  const lines = [`📅 *Semana ${week} empieza mañana*`, `_${range}_\n`];

  for (const c of courses) {
    lines.push(`📚 *${c.courseName}*`);
    lines.push(`📖 ${c.topic}\n`);
  }

  lines.push('💡 Buen momento para adelantar estudio este domingo.');
  await broadcast(lines.join('\n'));
}

/**
 * Self-ping cada 10 min para evitar que Render duerma el servicio.
 */
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

  setInterval(ping, 10 * 60 * 1000); // cada 10 min
  console.log('🔄 Self-ping activo cada 10 min');
}

export function startCronJobs() {
  cron.schedule('0 19 * * *', reminderTomorrow, { timezone: 'America/Lima' });
  cron.schedule('0 7 * * *', reminderToday, { timezone: 'America/Lima' });
  cron.schedule('0 19 * * 0', reminderWeeklyPreview, { timezone: 'America/Lima' });

  console.log('⏰ Cron jobs activos:');
  console.log('   • 19:00 diario → recordatorio de mañana + pregunta');
  console.log('   • 07:00 diario → clases de hoy');
  console.log('   • Domingo 19:00 → vista previa semanal');

  startSelfPing();
}

export { reminderTomorrow, reminderToday, reminderWeeklyPreview };