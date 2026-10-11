import { config, isOwner, humanDelay } from './config/env.js';
import { SYSTEM_PROMPT } from './config/persona.js';
import { startWhatsApp, sendText } from './services/whatsapp/client.js';
import { askLLM, pingProvider, PROVIDERS_AVAILABLE } from './services/llm/router.js';
import {
  saveMessage,
  getRecentMessages,
  clearHistory,
  getStats,
  getPendingStudyConfirmation,
  answerStudyConfirmation,
  getStudyStats,
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
import { analyzeImageMessage } from './services/vision/analyze.js';
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

// --- Lista de comandos (para !help) ---
const COMMANDS_HELP = `🤖 *Athena Bot* — Comandos disponibles:

📅 *Académico*
!hoy → Clases de hoy con temas
!mañana → Clases de mañana
!semana → Semana completa
!próxima → Siguiente clase
!tema → Temas de la semana actual

📊 *Sistema*
!ping → Estado de los 4 LLMs
!stats → Estadísticas + progreso de estudio
!reset → Borra historial
!help → Esta ayuda

🧪 *Debug*
!test-reminder → Simula recordatorio 19:00
!test-today → Simula recordatorio 07:00
!test-week → Simula vista previa dominical

🎤 *Audio*
Envía una nota de voz → la transcribo automáticamente

🖼️ *Imágenes*
Envía una foto (con o sin caption) → la analizo y respondo
Ejemplos de captions:
  • "resuélvelo"
  • "pásalo a texto"
  • "explícame esto"
  • "hazme un resumen de estudio"

💡 También funciona:
• Escribe "sí estudié" o "no estudié" para responder al recordatorio
• Forzar proveedor: !groq, !gemini, !nvidia, !openrouter + pregunta`;

// --- Handler de mensajes ---
async function handleMessage(sock, msg) {
  const jid = msg.key.remoteJid;
  const pushName = msg.pushName || 'desconocido';

  const isAudio = !!msg.message?.audioMessage;
  const isImage = !!msg.message?.imageMessage;

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

  // ==================== TRANSCRIPCIÓN DE AUDIO (con contexto) ====================
  if (isAudio) {
    try {
      const transcription = await transcribeAudioMessage(msg, sock);
      const cleanText = (transcription || '').trim();

      if (cleanText.length < 3) {
        console.log('   ⚠️  Transcripción vacía o muy corta');
        await sendText(
          jid,
          '🤔 No pude entender bien tu nota de voz. ¿Puedes repetirla más despacio o escribirme el mensaje? 🙏'
        );
        return;
      }

      // Envolver con contexto para que el LLM entienda que es una transcripción
      text = `[El usuario envió una nota de voz que fue transcrita automáticamente. Contenido: "${cleanText}"]\n\nResponde directamente al contenido, NO comentes sobre la transcripción ni sobre tu capacidad de procesar audio.`;
      console.log(`   ✅ Texto envuelto para LLM: "${text.slice(0, 150)}..."`);
    } catch (err) {
      console.error('Error transcribiendo:', err.message);
      await sendText(jid, '❌ No pude transcribir el audio. Intenta de nuevo.');
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
      await sendText(jid, '❌ No pude analizar la imagen. Intenta de nuevo.');
      return;
    }
  }

  console.log(`   Texto: "${text.slice(0, 200)}${text.length > 200 ? '...' : ''}"`);
  const lower = text.trim().toLowerCase();

  // ==================== CONFIRMACIONES DE ESTUDIO ====================
  if (['sí estudié', 'si estudie', 'sí', 'si', 'estudié', 'estudie', '✅'].includes(lower)) {
    const pending = getPendingStudyConfirmation(jid);
    if (pending) {
      answerStudyConfirmation(pending.id, true);
      const stats = getStudyStats(jid, 30);
      await humanDelay();
      await sendText(jid, `💪 ¡Excelente! Anotado. Llevas *${stats.studied}/${stats.total}* días de estudio en los últimos 30 días.`);
      return;
    }
  }

  if (['no estudié', 'no estudie', 'no', '❌'].includes(lower)) {
    const pending = getPendingStudyConfirmation(jid);
    if (pending) {
      answerStudyConfirmation(pending.id, false);
      await humanDelay();
      await sendText(jid, `😅 Bueno, aún tienes tiempo. Mañana te recuerdo de nuevo.`);
      return;
    }
  }

  // ==================== COMANDOS ====================
  if (lower === '!ping') { await handlePing(jid); return; }

  if (lower === '!help' || lower === '!ayuda' || lower === '!comandos') {
    await humanDelay();
    await sendText(jid, COMMANDS_HELP);
    return;
  }

  if (lower === '!stats') {
    await humanDelay();
    const s = getStats(jid);
    const study = getStudyStats(jid, 30);
    await sendText(jid, `📊 *Estadísticas*

💬 Mensajes: ${s.messages}
🧠 Hechos: ${s.facts}
📝 Tareas pendientes: ${s.pendingTasks}
📚 Estudio (30d): ${study.studied}/${study.total}`);
    return;
  }

  if (lower === '!reset') {
    await humanDelay();
    const n = clearHistory(jid);
    await sendText(jid, `🧹 Borrados ${n} mensajes del historial.`);
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

  if (lower === '!hoy') {
    await humanDelay();
    const classes = getToday();
    if (classes.length === 0) { await sendText(jid, '🎉 Hoy no tienes clases. ¡Descansa!'); }
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

  if (lower === '!mañana' || lower === '!manana') {
    await humanDelay();
    const classes = getTomorrow();
    if (classes.length === 0) { await sendText(jid, '🎉 Mañana no tienes clases.'); }
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

  if (lower === '!semana') {
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
    if (!next) { await sendText(jid, 'No hay clases próximas.'); }
    else {
      const when = next.when === 'hoy' ? 'Hoy' : next.when === 'mañana' ? 'Mañana' : next.when;
      await sendText(jid, `📌 *Próxima clase*\n\n${when}\n⏰ ${next.start} - ${next.end}\n📚 ${next.course.name}\n👨‍🏫 ${next.course.teacher}`);
    }
    return;
  }

  if (lower === '!test-reminder') {
    await humanDelay();
    await sendText(jid, '⏳ Simulando recordatorio de mañana...');
    const { reminderTomorrow } = await import('./cron/reminders.js');
    await reminderTomorrow();
    return;
  }

  if (lower === '!test-today') {
    await humanDelay();
    await sendText(jid, '⏳ Simulando recordatorio de hoy...');
    const { reminderToday } = await import('./cron/reminders.js');
    await reminderToday();
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
    saveMessage(jid, 'user', userText);
    const history = getRecentMessages(jid, config.memoryMaxShortTerm);
    const contextMessages = history.slice(0, -1);
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...contextMessages,
      { role: 'user', content: userText },
    ];

    console.log(`   🧠 Contexto: ${contextMessages.length} mensajes previos`);
    console.log(`   🤖 Enviando a LLM${preferred ? ` (preferido: ${preferred})` : ''}...`);
    const result = await askLLM(messages, { preferred });

    console.log(`   📝 Respuesta de ${result.provider} (${result.model})`);
    saveMessage(jid, 'assistant', result.text, { provider: result.provider, model: result.model });

    await humanDelay();
    await sendText(jid, result.text);
    console.log(`   ✅ Enviado a WhatsApp`);
  } catch (err) {
    console.error('❌ Error LLM:', err.message);
    await humanDelay();
    await sendText(jid, '⚠️ Todos los proveedores LLM fallaron.');
  }
}

// --- !ping ---
async function handlePing(jid) {
  await sendText(jid, '🏓 Probando proveedores LLM...');
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

// --- Servidor HTTP ---
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

// --- Arranque ---
(async () => {
  try {
    console.log('\n🚀 Iniciando Athena Bot...\n');
    await startWhatsApp(handleMessage);
    startCronJobs();
  } catch (err) {
    console.error('❌ Error fatal al arrancar:', err);
    process.exit(1);
  }
})();

process.on('SIGINT', () => {
  console.log('\n👋 Cerrando Athena Bot...');
  process.exit(0);
});