import { config, isOwner, humanDelay } from './config/env.js';
import { SYSTEM_PROMPT } from './config/persona.js';
import { startWhatsApp, sendText, sendAudio } from './services/whatsapp/client.js';
import { askLLM, pingProvider, PROVIDERS_AVAILABLE } from './services/llm/router.js';
import {
  saveMessage,
  getRecentMessages,
  clearHistory,
  getStats,
  getPendingStudyConfirmation,
  answerStudyConfirmation,
  getStudyStats,
  createTask,
  getPendingTasks,
  completeTask,
} from './memory/store.js';
import {
  getToday,
  getTomorrow,
  getWeek,
  getNextClass,
} from './syllabus/schedule.js';
import { getCurrentWeek, getTopicForWeek } from './syllabus/topics.js';
import { startCronJobs } from './cron/reminders.js';
import { transcribeAudioMessage } from './services/audio/transcribe.js';
import { textToSpeech } from './services/audio/tts.js';
import { analyzeImageMessage } from './services/vision/analyze.js';
import { parseTaskInput, formatDueDate } from './services/tasks/parser.js';
import {
  isInPomodoro,
  getPomodoro,
  startPomodoro,
  stopPomodoro,
} from './services/pomodoro/manager.js';
import { createServer } from 'http';

console.log('🤖 Athena Bot — Asistente Académico');
console.log('   Entorno:', config.nodeEnv);
console.log('   Zona horaria:', config.timezone);
console.log('   Proveedor LLM por defecto:', config.defaultProvider);
console.log('   Modelo por defecto:', config.defaultModel);
console.log('   Owners (número):', config.owners.length ? config.owners : '⚠️  ninguno');
console.log('   Owners (LID):', config.ownerLids.length ? config.ownerLids : '⚠️  ninguno');

if (config.owners.length === 0 && config.ownerLids.length === 0) {
  console.warn('⚠️  OWNER_NUMBER / OWNER_LID no configurados.');
}

/* ============================================================
 *  AYUDA — organizada por categorías
 * ============================================================ */

const HELP_FULL = `🤖 *Athena Bot — Comandos*

📚 *CLASES Y HORARIO*
!hoy (o !h) → Clases de hoy
!mañana (o !m) → Clases de mañana
!semana (o !s) → Semana completa
!próxima → Siguiente clase
!tema → Temas de la semana actual

📝 *TAREAS*
!tarea <texto> → Guardar tarea
!tarea <texto> para el viernes → Con fecha
!pendientes → Ver tareas pendientes
!completar <n> → Marcar como hecha
!limpiar-tareas → Borrar todas las completadas

⏱️ *POMODORO*
!pomodoro → 25 min estudio + 5 descanso × 4 rondas
!pomodoro 45 10 3 → Custom (45/10 × 3 rondas)
!pomodoro-estado → Ver sesión activa
!pomodoro-stop → Cancelar sesión

🌤️ *CLIMA*
!clima (o !c) → Clima hoy y mañana

📊 *SISTEMA*
!stats → Estadísticas + progreso
!ping → Estado de los 4 LLMs
!reset → Borra historial
!help → Esta ayuda
!ayuda-rapida → Solo comandos básicos

🎤 *AUDIO*
Envía una nota de voz → la transcribo
!voz <texto> → Forzar respuesta en audio
!texto <texto> → Forzar respuesta en texto

🖼️ *IMÁGENES*
Envía una foto (con o sin caption) → la analizo

✅ *ESTUDIO*
"sí estudié" / "no estudié" → Responder al recordatorio
!stats → Ver tu progreso

🧪 *DEBUG*
!test-today → Simula recordatorio 07:00
!test-midday → Simula clima mediodía
!test-reminder → Simula recordatorio 19:00
!test-review → Simula repaso nocturno
!test-week → Simula vista previa semanal`;

const HELP_SHORT = `🤖 *Comandos básicos* (escribe !help para ver todos)

!hoy / !h → Clases de hoy
!mañana / !m → Clases de mañana
!semana / !s → Semana
!clima / !c → Clima hoy y mañana

📝 *Tareas*
!tarea <texto> → Guardar
!pendientes → Ver pendientes

⏱️ *Foco*
!pomodoro → Iniciar 25 min

!stats → Tus estadísticas
!help → Ayuda completa

🎤 Manda audio → lo transcribo
🖼️ Manda foto → la analizo`;

/* ============================================================
 *  Palabras clave que activan respuesta en voz
 * ============================================================ */
const VOICE_KEYWORDS = [
  'en audio', 'en voz', 'por audio', 'por voz',
  'respóndeme en audio', 'respondeme en audio',
  'respóndeme en voz', 'respondeme en voz',
  'dime en audio', 'dime en voz',
  'contéstame en audio', 'contestame en audio',
  'contéstame en voz', 'contestame en voz',
  'mándame un audio', 'mandame un audio',
  'mándame audio', 'mandame audio',
  'envíame un audio', 'enviame un audio',
  'con tu voz', 'en tu voz', 'háblame', 'hablame',
];

/* ============================================================
 *  HANDLER PRINCIPAL
 * ============================================================ */
async function handleMessage(sock, msg) {
  const jid = msg.key.remoteJid;
  const pushName = msg.pushName || 'desconocido';

  const isAudio = !!msg.message?.audioMessage;
  const isImage = !!msg.message?.imageMessage;

  let replyWithVoice = false;

  let text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    '';

  console.log(`\n📩 [${pushName}] JID=${jid}`);
  if (isAudio) console.log('   🎤 Es una nota de voz');
  if (isImage) console.log('   🖼️  Es una imagen');

  if (!text && !isAudio && !isImage) return;
  if (!jid) return;
  if (jid.endsWith('@g.us')) return;
  if (jid === 'status@broadcast') return;

  const isPrivate = jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid');
  if (!isPrivate) return;

  const ownerCheck = isOwner(jid);
  console.log(`   ¿Es owner? ${ownerCheck ? '✅ SÍ' : '❌ NO'}`);
  if (!ownerCheck) return;

  // ==================== TRANSCRIPCIÓN DE AUDIO ====================
  if (isAudio) {
    try {
      const transcription = await transcribeAudioMessage(msg, sock);
      const cleanText = (transcription || '').trim();

      if (cleanText.length < 3) {
        console.log('   ⚠️  Transcripción vacía o muy corta');
        await sendText(jid, '🤔 Mi amor, no entendí bien tu audio. ¿Me lo repites?');
        return;
      }

      text = `[El usuario envió una nota de voz que fue transcrita automáticamente. Contenido: "${cleanText}"]\n\nResponde directamente al contenido, NO comentes sobre la transcripción ni sobre tu capacidad de procesar audio.`;
      console.log(`   ✅ Texto envuelto para LLM`);
    } catch (err) {
      console.error('Error transcribiendo:', err.message);
      await sendText(jid, '❌ No pude escuchar tu audio, mi amor. Intenta de nuevo.');
      return;
    }
  }

  // ==================== ANÁLISIS DE IMAGEN ====================
  if (isImage) {
    try {
      const caption = msg.message.imageMessage?.caption || '';
      const analysis = await analyzeImageMessage(msg, sock, caption);

      text = caption
        ? `${caption}\n\n[Contenido de la imagen]:\n${analysis}`
        : `[Contenido de la imagen]:\n${analysis}`;
    } catch (err) {
      console.error('Error analizando imagen:', err.message);
      await sendText(jid, '❌ No pude ver la imagen, corazón. Intenta de nuevo.');
      return;
    }
  }

  // ==================== DETECCIÓN DE VOZ ====================
  const lowerForVoice = text.toLowerCase();
  const userAskedForVoice = VOICE_KEYWORDS.some((kw) => lowerForVoice.includes(kw));
  if (userAskedForVoice) {
    replyWithVoice = true;
    console.log('   🔊 Usuario pidió respuesta en audio');
  }

  console.log(`   Texto: "${text.slice(0, 200)}${text.length > 200 ? '...' : ''}"`);
  const lower = text.trim().toLowerCase();

  // ==================== ATAJOS ====================
  if (lower === '!' || lower === '!ayuda-rapida' || lower === '!comandos') {
    await humanDelay();
    await sendText(jid, HELP_SHORT);
    return;
  }

  // ==================== CONFIRMACIONES DE ESTUDIO ====================
  if (['sí estudié', 'si estudie', 'sí', 'si', 'estudié', 'estudie', '✅'].includes(lower)) {
    const pending = await getPendingStudyConfirmation(jid);
    if (pending) {
      await answerStudyConfirmation(pending.id, true);
      const stats = await getStudyStats(jid, 30);
      await humanDelay();
      await sendText(jid, `💪 ¡Ese es mi Werner! Anotado. Llevas *${stats.studied}/${stats.total}* días estudiando en los últimos 30. ¡Sigue así, mi amor!`);
      return;
    }
  }

  if (['no estudié', 'no estudie', 'no', '❌'].includes(lower)) {
    const pending = await getPendingStudyConfirmation(jid);
    if (pending) {
      await answerStudyConfirmation(pending.id, false);
      await humanDelay();
      await sendText(jid, `😅 Bueno, mi amor, aún tienes tiempo. Mañana te recuerdo otra vez. No te agobies.`);
      return;
    }
  }

  // ==================== COMANDO !voz ====================
  if (lower.startsWith('!voz ')) {
    const textToSay = text.slice(5).trim();
    if (!textToSay) {
      await sendText(jid, '❌ Uso: `!voz <texto que quieres que diga>`');
      return;
    }
    try {
      await humanDelay();
      const audioBuffer = await textToSpeech(textToSay);
      await sendAudio(jid, audioBuffer);
      console.log(`   🔊 Audio enviado (${(audioBuffer.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.error('❌ Error generando voz:', err.message);
      await sendText(jid, `❌ No pude generar el audio: ${err.message.slice(0, 100)}`);
    }
    return;
  }

  // ==================== COMANDO !texto ====================
  let forceTextReply = false;
  if (lower.startsWith('!texto ')) {
    text = text.slice(7).trim();
    forceTextReply = true;
    replyWithVoice = false;
  }

  // ==================== COMANDOS DE TAREAS ====================
  if (lower.startsWith('!tarea ') || lower.startsWith('!t ')) {
    const start = lower.startsWith('!tarea ') ? 7 : 3;
    const input = text.slice(start).trim();

    if (!input) {
      await sendText(jid, '❌ Uso: `!tarea <texto>`\nEjemplos:\n• !tarea entregar informe de auditoría\n• !tarea estudiar NIA 500 para el viernes');
      return;
    }

    const { cleanTitle, dueDate } = parseTaskInput(input);

    if (!cleanTitle) {
      await sendText(jid, '❌ Necesito un texto para la tarea.');
      return;
    }

    try {
      const id = await createTask(jid, {
        title: cleanTitle,
        dueDate,
      });

      const dueText = dueDate ? `\n📅 Vence: *${formatDueDate(dueDate)}*` : '';
      const reminderText = dueDate
        ? '\nTe aviso el día anterior y el mismo día 💙'
        : '';

      await humanDelay();
      await sendText(jid, `📝 Anotado (tarea #${id}):\n*${cleanTitle}*${dueText}${reminderText}`);
    } catch (err) {
      console.error('Error creando tarea:', err.message);
      await sendText(jid, '❌ No pude guardar la tarea, mi amor.');
    }
    return;
  }

  if (lower === '!pendientes' || lower === '!tareas' || lower === '!lista') {
    try {
      const tasks = await getPendingTasks(jid);

      if (tasks.length === 0) {
        await humanDelay();
        await sendText(jid, '✨ No tienes tareas pendientes, mi amor. ¡Sigue así!');
        return;
      }

      const lines = [`📋 *Tareas pendientes (${tasks.length})*\n`];
      for (const t of tasks.slice(0, 15)) {
        const due = t.due_date ? ` — 📅 ${formatDueDate(t.due_date)}` : '';
        lines.push(`*#${t.id}* ${t.title}${due}`);
      }
      if (tasks.length > 15) {
        lines.push(`\n_(+${tasks.length - 15} más)_`);
      }
      lines.push(`\nCompleta con: !completar <n>`);

      await humanDelay();
      await sendText(jid, lines.join('\n'));
    } catch (err) {
      console.error('Error listando tareas:', err.message);
      await sendText(jid, '❌ No pude leer tus tareas.');
    }
    return;
  }

  if (lower.startsWith('!completar ') || lower.startsWith('!listo ')) {
    const start = lower.startsWith('!completar ') ? 11 : 7;
    const idStr = text.slice(start).trim();
    const id = parseInt(idStr, 10);

    if (isNaN(id)) {
      await sendText(jid, '❌ Uso: `!completar <número>`\nEjemplo: !completar 3');
      return;
    }

    try {
      const ok = await completeTask(id);
      if (ok) {
        await humanDelay();
        await sendText(jid, `✅ Tarea #${id} completada. ¡Un paso menos, mi amor! 💙`);
      } else {
        await sendText(jid, `❌ No encontré la tarea #${id}.`);
      }
    } catch (err) {
      console.error('Error completando tarea:', err.message);
      await sendText(jid, '❌ No pude actualizar la tarea.');
    }
    return;
  }

  // ==================== POMODORO ====================
  if (lower === '!pomodoro' || lower.startsWith('!pomodoro ')) {
    if (isInPomodoro(jid)) {
      const current = getPomodoro(jid);
      await humanDelay();
      await sendText(jid, `⏱️ Ya tienes una sesión activa.\n\n${current.type === 'work' ? '🔴 Foco' : '☕ Descanso'} · Ronda ${current.currentRound}/${current.totalRounds}\nQuedan ${current.remainingMin} min.\n\nPara cancelar: !pomodoro-stop`);
      return;
    }

    // Parsear argumentos custom: !pomodoro 45 10 3
    const args = text.slice(9).trim().split(/\s+/).filter(Boolean);
    let work = 25, brk = 5, rounds = 4;

    if (args.length >= 1) {
      const w = parseInt(args[0], 10);
      if (!isNaN(w) && w > 0 && w <= 120) work = w;
    }
    if (args.length >= 2) {
      const b = parseInt(args[1], 10);
      if (!isNaN(b) && b > 0 && b <= 30) brk = b;
    }
    if (args.length >= 3) {
      const r = parseInt(args[2], 10);
      if (!isNaN(r) && r > 0 && r <= 10) rounds = r;
    }

    const result = await startPomodoro(jid, work, brk, rounds);
    if (result.error) {
      await sendText(jid, `⚠️ ${result.error}`);
      return;
    }

    await humanDelay();
    await sendText(jid, `⏱️ *Pomodoro iniciado*\n\n🔴 Ronda 1/${rounds} — ${work} min de foco\n☕ Descanso: ${brk} min entre rondas\n\nTe aviso cuando termine la ronda. ¡Éxito! 💪`);
    return;
  }

  if (lower === '!pomodoro-estado' || lower === '!pomo-estado') {
    if (!isInPomodoro(jid)) {
      await sendText(jid, '✨ No tienes una sesión de Pomodoro activa.');
      return;
    }

    const s = getPomodoro(jid);
    await humanDelay();
    await sendText(jid, `⏱️ *Estado del Pomodoro*\n\n${s.type === 'work' ? '🔴 Foco' : '☕ Descanso'}\nRonda ${s.currentRound}/${s.totalRounds}\nQuedan ~${s.remainingMin} min`);
    return;
  }

  if (lower === '!pomodoro-stop' || lower === '!pomo-stop' || lower === '!cancelar-pomodoro') {
    if (!isInPomodoro(jid)) {
      await sendText(jid, '✨ No había ninguna sesión activa.');
      return;
    }

    stopPomodoro(jid);
    await humanDelay();
    await sendText(jid, '🛑 Sesión cancelada. Cuando quieras retomar, usa !pomodoro.');
    return;
  }

  // ==================== SISTEMA ====================
  if (lower === '!ping') { await handlePing(jid); return; }

  if (lower === '!help' || lower === '!ayuda') {
    await humanDelay();
    await sendText(jid, HELP_FULL);
    return;
  }

  if (lower === '!stats') {
    await humanDelay();
    const s = await getStats(jid);
    const study = await getStudyStats(jid, 30);
    const tasks = await getPendingTasks(jid);
    await sendText(jid, `📊 *Estadísticas*

💬 Mensajes: ${s.messages}
🧠 Hechos: ${s.facts}
📝 Tareas pendientes: ${tasks.length}
📚 Estudio (30d): ${study.studied}/${study.total}`);
    return;
  }

  if (lower === '!reset') {
    await humanDelay();
    await clearHistory(jid);
    await sendText(jid, `🧹 Historial borrado, mi amor.`);
    return;
  }

  // ==================== CLASES Y HORARIO ====================
  if (lower === '!hoy' || lower === '!h') {
    await humanDelay();
    const classes = getToday();
    if (classes.length === 0) { await sendText(jid, '🎉 Hoy no tienes clases, corazón. ¡Descansa!'); }
    else {
      const week = getCurrentWeek();
      const lines = classes.map((c) => {
        const topic = getTopicForWeek(c.courseKey, week);
        let block = `⏰ *${c.start} - ${c.end}*\n📚 ${c.course.name}\n👨‍🏫 ${c.course.teacher}`;
        if (topic) block += `\n📖 ${topic.topic}`;
        return block;
      });
      await sendText(jid, `📅 *Clases de hoy*\n\n${lines.join('\n\n')}`);
    }
    return;
  }

  if (lower === '!mañana' || lower === '!manana' || lower === '!m') {
    await humanDelay();
    const classes = getTomorrow();
    if (classes.length === 0) { await sendText(jid, '🎉 Mañana no tienes clases, mi amor.'); }
    else {
      const week = getCurrentWeek() + 1;
      const lines = classes.map((c) => {
        const topic = getTopicForWeek(c.courseKey, week);
        let block = `⏰ *${c.start} - ${c.end}*\n📚 ${c.course.name}\n👨‍🏫 ${c.course.teacher}`;
        if (topic) block += `\n📖 SEM-${week}: ${topic.topic}`;
        return block;
      });
      await sendText(jid, `📅 *Clases de mañana*\n\n${lines.join('\n\n')}`);
    }
    return;
  }

  if (lower === '!semana' || lower === '!s') {
    await humanDelay();
    const week = getWeek();
    const lines = week.map((d) => {
      if (d.classes.length === 0) return `*${d.dayLabel}* — sin clases`;
      const items = d.classes.map((c) => `  ${c.start}-${c.end} · ${c.course.short}`).join('\n');
      return `*${d.dayLabel}*\n${items}`;
    });
    await sendText(jid, `📅 *Semana académica*\n\n${lines.join('\n\n')}`);
    return;
  }

  if (lower === '!proxima' || lower === '!próxima') {
    await humanDelay();
    const next = getNextClass();
    if (!next) { await sendText(jid, 'No hay clases próximas, mi amor.'); }
    else {
      const when = next.when === 'hoy' ? 'Hoy' : next.when === 'mañana' ? 'Mañana' : next.when;
      await sendText(jid, `📌 *Próxima clase*\n\n${when}\n⏰ ${next.start} - ${next.end}\n📚 ${next.course.name}\n👨‍🏫 ${next.course.teacher}`);
    }
    return;
  }

  if (lower === '!tema') {
    await humanDelay();
    const week = getCurrentWeek();
    const courses = ['contabilidad-financieras','comprension-ingles','solucion-problemas','analisis-eeff','auditoria','finanzas-privadas'];
    const lines = [`📚 *Temas de la semana ${week}*\n`];
    for (const key of courses) {
      const t = getTopicForWeek(key, week);
      if (t) { lines.push(`*${t.courseName}*`); lines.push(`📖 ${t.topic}\n`); }
    }
    await sendText(jid, lines.join('\n'));
    return;
  }

  // ==================== CLIMA ====================
  if (lower === '!clima' || lower === '!c') {
    await humanDelay();
    try {
      const { getWeather, formatWeatherFull } = await import('./services/weather/forecast.js');
      const w = await getWeather();
      if (!w) {
        await sendText(jid, '❌ No pude obtener el clima, mi amor. Intenta en un rato.');
        return;
      }
      await sendText(jid, formatWeatherFull(w));
    } catch (err) {
      console.error('Error clima:', err.message);
      await sendText(jid, '❌ Hubo un problema con el clima, corazón.');
    }
    return;
  }

  // ==================== DEBUG / TESTS ====================
  if (lower === '!test-today') {
    await humanDelay();
    await sendText(jid, '⏳ Simulando recordatorio 07:00...');
    const { reminderToday } = await import('./cron/reminders.js');
    await reminderToday();
    return;
  }

  if (lower === '!test-midday') {
    await humanDelay();
    await sendText(jid, '⏳ Simulando clima mediodía...');
    const { middayWeather } = await import('./cron/reminders.js');
    await middayWeather();
    return;
  }

  if (lower === '!test-reminder') {
    await humanDelay();
    await sendText(jid, '⏳ Simulando recordatorio 19:00...');
    const { reminderTomorrow } = await import('./cron/reminders.js');
    await reminderTomorrow();
    return;
  }

  if (lower === '!test-review') {
    await humanDelay();
    await sendText(jid, '⏳ Simulando repaso nocturno...');
    const { eveningReview } = await import('./cron/reminders.js');
    await eveningReview();
    return;
  }

  if (lower === '!test-week') {
    await humanDelay();
    await sendText(jid, '⏳ Simulando vista previa semanal...');
    const { reminderWeeklyPreview } = await import('./cron/reminders.js');
    await reminderWeeklyPreview();
    return;
  }

  // ==================== LLM NORMAL ====================
  let preferred;
  let userText = text;
  const m = text.match(/^!(groq|gemini|nvidia|openrouter)\s+(.*)$/is);
  if (m) { preferred = m[1].toLowerCase(); userText = m[2]; }

  try {
    await saveMessage(jid, 'user', userText);
    const history = await getRecentMessages(jid, config.memoryMaxShortTerm);
    const contextMessages = history.slice(0, -1);
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...contextMessages,
      { role: 'user', content: userText },
    ];

    console.log(`   🧠 Contexto: ${contextMessages.length} mensajes previos`);
    console.log(`   🤖 Enviando a LLM...`);
    const result = await askLLM(messages, { preferred });

    console.log(`   📝 Respuesta de ${result.provider} (${result.model})`);
    await saveMessage(jid, 'assistant', result.text, { provider: result.provider, model: result.model });

    await humanDelay();

    const shouldReplyWithVoice =
      replyWithVoice &&
      !forceTextReply &&
      result.text.length <= 500 &&
      !result.text.includes('```');

    if (shouldReplyWithVoice) {
      try {
        console.log('   🔊 Generando respuesta en voz...');
        const audioBuffer = await textToSpeech(result.text);
        await sendAudio(jid, audioBuffer);
        console.log(`   ✅ Enviado (voz, ${(audioBuffer.length / 1024).toFixed(1)} KB)`);
      } catch (err) {
        console.error('❌ Falló TTS, enviando texto:', err.message);
        await sendText(jid, result.text);
      }
    } else {
      await sendText(jid, result.text);
      console.log(`   ✅ Enviado (texto)`);
    }
  } catch (err) {
    console.error('❌ Error LLM:', err.message);
    await humanDelay();
    await sendText(jid, '⚠️ Algo falló, mi amor. Intenta de nuevo.');
  }
}

async function handlePing(jid) {
  await sendText(jid, '🏓 Probando proveedores...');
  const lines = [];
  for (const name of PROVIDERS_AVAILABLE) {
    try {
      const r = await pingProvider(name);
      lines.push(`✅ ${name} · ${r.model} · ${r.ms}ms`);
    } catch (err) {
      lines.push(`❌ ${name} · ${err.message.slice(0, 80)}`);
    }
  }
  await sendText(jid, lines.join('\n'));
}

/* ============================================================
 *  SERVIDOR HTTP
 * ============================================================ */
const PORT = process.env.PORT || 3000;
const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'athena-bot-whatsapp',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Athena Bot WhatsApp — en línea');
  }
});
server.listen(PORT, () => {
  console.log(`🌐 Healthcheck HTTP escuchando en puerto ${PORT}`);
});

/* ============================================================
 *  ARRANQUE
 * ============================================================ */
(async () => {
  try {
    console.log('\n🚀 Iniciando Athena Bot...\n');
    await startWhatsApp(handleMessage);
    startCronJobs();
  } catch (err) {
    console.error('❌ Error fatal:', err);
    process.exit(1);
  }
})();

process.on('SIGINT', () => {
  console.log('\n👋 Cerrando Athena Bot...');
  process.exit(0);
});