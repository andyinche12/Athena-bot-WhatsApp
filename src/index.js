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

🎤 *Audio*
Envía una nota de voz → la transcribo y respondo en texto
!voz <texto> → Fuerza respuesta en audio
!texto <texto> → Fuerza respuesta en texto
💡 Para recibir respuesta en audio: di "respóndeme en audio" en tu mensaje

🖼️ *Imágenes*
Envía una foto (con o sin caption) → la analizo y respondo

💡 También funciona:
• Escribe "sí estudié" o "no estudié" para responder al recordatorio
• Forzar proveedor: !groq, !gemini, !nvidia, !openrouter + pregunta`;

// Palabras clave que activan respuesta en voz
const VOICE_KEYWORDS = [
  'en audio',
  'en voz',
  'por audio',
  'por voz',
  'respóndeme en audio',
  'respondeme en audio',
  'respóndeme en voz',
  'respondeme en voz',
  'dime en audio',
  'dime en voz',
  'contéstame en audio',
  'contestame en audio',
  'contéstame en voz',
  'contestame en voz',
  'mándame un audio',
  'mandame un audio',
  'mándame audio',
  'mandame audio',
  'envíame un audio',
  'enviame un audio',
  'con tu voz',
  'en tu voz',
  'háblame',
  'hablame',
];

async function handleMessage(sock, msg) {
  const jid = msg.key.remoteJid;
  const pushName = msg.pushName || 'desconocido';

  const isAudio = !!msg.message?.audioMessage;
  const isImage = !!msg.message?.imageMessage;

  // Por defecto, responder SIEMPRE en texto
  // Solo responder en voz si el usuario lo pide explícitamente
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
        await sendText(jid, '🤔 Mi amor, no entendí bien tu audio. ¿Me lo repites? 🙏');
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

  // ==================== DETECCIÓN DE SOLICITUD DE VOZ ====================
  // Buscar palabras clave en el texto (funciona tanto con texto como con audio transcrito)
  const lowerForVoice = text.toLowerCase();
  const userAskedForVoice = VOICE_KEYWORDS.some((kw) => lowerForVoice.includes(kw));

  if (userAskedForVoice) {
    replyWithVoice = true;
    console.log('   🔊 Usuario pidió respuesta en audio');
  }

  console.log(`   Texto: "${text.slice(0, 200)}${text.length > 200 ? '...' : ''}"`);
  const lower = text.trim().toLowerCase();

  // ==================== CONFIRMACIONES DE ESTUDIO ====================
  if (['sí estudié', 'si estudie', 'sí', 'si', 'estudié', 'estudie', '✅'].includes(lower)) {
    const pending = await getPendingStudyConfirmation(jid);
    if (pending) {
      await answerStudyConfirmation(pending.id, true);
      const stats = await getStudyStats(jid, 30);
      await humanDelay();
      await sendText(jid, `💪 ¡Ese es mi Werner! Anotado. Llevas *${stats.studied}/${stats.total}* días estudiando en los últimos 30. ¡Sigue así, mi amor! 💙`);
      return;
    }
  }

  if (['no estudié', 'no estudie', 'no', '❌'].includes(lower)) {
    const pending = await getPendingStudyConfirmation(jid);
    if (pending) {
      await answerStudyConfirmation(pending.id, false);
      await humanDelay();
      await sendText(jid, `😅 Bueno, mi amor, aún tienes tiempo. Mañana te recuerdo otra vez. No te agobies 💙`);
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
    replyWithVoice = false; // forzar texto
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
    const s = await getStats(jid);
    const study = await getStudyStats(jid, 30);
    await sendText(jid, `📊 *Estadísticas*

💬 Mensajes: ${s.messages}
🧠 Hechos: ${s.facts}
📝 Tareas pendientes: ${s.pendingTasks}
📚 Estudio (30d): ${study.studied}/${study.total}`);
    return;
  }

  if (lower === '!reset') {
    await humanDelay();
    await clearHistory(jid);
    await sendText(jid, `🧹 Historial borrado, mi amor.`);
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

  if (lower === '!mañana' || lower === '!manana') {
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
    if (!next) { await sendText(jid, 'No hay clases próximas, mi amor.'); }
    else {
      const when = next.when === 'hoy' ? 'Hoy' : next.when === 'mañana' ? 'Mañana' : next.when;
      await sendText(jid, `📌 *Próxima clase*\n\n${when}\n⏰ ${next.start} - ${next.end}\n📚 ${next.course.name}\n👨‍🏫 ${next.course.teacher}`);
    }
    return;
  }

  if (lower === '!test-reminder') {
    await humanDelay();
    await sendText(jid, '⏳ Simulando recordatorio...');
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
        console.log('   🔊 Generando respuesta en voz (solicitado por usuario)...');
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