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
  createFlashcard,
  getFlashcards,
  getRandomFlashcards,
  updateFlashcardStats,
  deleteFlashcard,
  getFlashcardStats,
  createExpense,
  getExpenses,
  getExpensesSum,
  deleteExpense,
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
  parseExpense,
  formatAmount,
  formatCategory,
} from './services/expenses/parser.js';
import {
  isInPomodoro,
  getPomodoro,
  startPomodoro,
  stopPomodoro,
} from './services/pomodoro/manager.js';
import {
  hasActiveQuiz,
  getActiveQuiz,
  startQuiz,
  endQuiz,
  checkAnswer,
  nextQuestion,
  recordAnswer,
  getQuizSummary,
} from './services/flashcards/quiz.js';
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

🎴 *FLASHCARDS Y QUIZ*
!flashcard pregunta | respuesta → Crear tarjeta
!flashcards → Listar todas
!quiz → Quiz de 5 preguntas aleatorias
!quiz 10 → Quiz de 10 preguntas
!borrar-flashcard <n> → Eliminar una

💰 *GASTOS*
!gasto <monto> <descripción> → Registrar
!gasto 25 almuerzo → Auto-categoriza
!gasto 30 libro | estudio → Categoría explícita
!gastos → Gastos de hoy
!gastos-semana → Semana
!gastos-mes → Mes
!borrar-gasto <n> → Eliminar

_Categorías: comida, transporte, estudio, ocio, salud, hogar, otros_

⏱️ *POMODORO*
!pomodoro → 25 min foco + 5 descanso × 4 rondas
!pomodoro 45 10 3 → Custom (45/10 × 3)
!pomodoro-estado → Ver sesión activa
!pomodoro-stop → Cancelar sesión

🌤️ *CLIMA*
!clima (o !c) → Clima completo por franjas

📊 *SISTEMA*
!stats → Estadísticas + progreso
!resumen-semana → Reporte semanal
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

🧪 *DEBUG*
!test-today → Simula recordatorio 07:00
!test-midday → Simula clima mediodía
!test-reminder → Simula recordatorio 19:00
!test-review → Simula repaso nocturno
!test-week → Simula resumen semanal`;

const HELP_SHORT = `🤖 *Comandos básicos* (escribe !help para ver todos)

!hoy / !h → Clases de hoy
!mañana / !m → Clases de mañana
!semana / !s → Semana
!clima / !c → Clima hoy y mañana

📝 *Tareas*
!tarea <texto> → Guardar
!pendientes → Ver pendientes

🎴 *Estudio*
!flashcard pregunta | respuesta → Crear tarjeta
!quiz → Quiz rápido

💰 *Gastos*
!gasto 25 almuerzo → Registrar
!gastos → Ver gastos de hoy

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

  // ==================== FLASHCARDS ====================
  if (lower.startsWith('!flashcard ') || lower.startsWith('!fc ')) {
    const start = lower.startsWith('!flashcard ') ? 11 : 4;
    const input = text.slice(start).trim();

    if (!input || !input.includes('|')) {
      await sendText(
        jid,
        '❌ Uso: `!flashcard pregunta | respuesta`\n\nEjemplo:\n!flashcard ¿Qué es el encaje bancario? | Reserva obligatoria en el BCRP, 4-6% de depósitos'
      );
      return;
    }

    const [question, ...answerParts] = input.split('|');
    const answer = answerParts.join('|').trim();

    if (!question.trim() || !answer) {
      await sendText(jid, '❌ Necesito pregunta y respuesta separadas por `|`');
      return;
    }

    try {
      const id = await createFlashcard(jid, question.trim(), answer);
      await humanDelay();
      await sendText(
        jid,
        `🎴 Flashcard #${id} guardada\n\n*P:* ${question.trim()}\n*R:* ${answer}`
      );
    } catch (err) {
      console.error('Error creando flashcard:', err.message);
      await sendText(jid, '❌ No pude guardar la flashcard.');
    }
    return;
  }

  if (lower === '!flashcards' || lower === '!tarjetas') {
    try {
      const cards = await getFlashcards(jid);

      if (cards.length === 0) {
        await humanDelay();
        await sendText(jid, '✨ No tienes flashcards todavía, mi amor.\n\nCrea una con:\n`!flashcard pregunta | respuesta`');
        return;
      }

      const stats = await getFlashcardStats(jid);
      const lines = [`🎴 *Tus flashcards (${stats.total})*\n`];
      lines.push(`✅ Dominadas: ${stats.mastered}`);
      lines.push(`📚 Por repasar: ${stats.toReview}\n`);

      for (const c of cards.slice(0, 10)) {
        const accuracy = c.times_shown > 0
          ? Math.round((c.times_right / c.times_shown) * 100)
          : 0;
        const badge = c.times_shown === 0 ? '🆕' : accuracy >= 80 ? '✅' : accuracy >= 50 ? '🟡' : '🔴';
        lines.push(`${badge} *#${c.id}* ${c.question}`);
      }
      if (cards.length > 10) {
        lines.push(`\n_(+${cards.length - 10} más)_`);
      }

      await humanDelay();
      await sendText(jid, lines.join('\n'));
    } catch (err) {
      console.error('Error listando flashcards:', err.message);
      await sendText(jid, '❌ No pude leer tus flashcards.');
    }
    return;
  }

  if (lower === '!quiz' || lower === '!examen' || lower.startsWith('!quiz ')) {
    if (hasActiveQuiz(jid)) {
      await sendText(jid, '⏳ Ya tienes un quiz activo. Respóndelo o escribe `!quiz-stop` para cancelar.');
      return;
    }

    try {
      const parts = text.split(/\s+/);
      let count = 5;
      if (parts.length >= 2) {
        const n = parseInt(parts[1], 10);
        if (!isNaN(n) && n > 0 && n <= 20) count = n;
      }

      const cards = await getRandomFlashcards(jid, count);

      if (cards.length === 0) {
        await humanDelay();
        await sendText(jid, '✨ No tienes flashcards todavía.\n\nCrea una con:\n`!flashcard pregunta | respuesta`');
        return;
      }

      startQuiz(jid, cards);
      const q = nextQuestion(jid);

      await humanDelay();
      await sendText(
        jid,
        `📚 *Quiz iniciado — ${cards.length} preguntas*\n\n` +
        `📝 *Pregunta ${q.index}/${q.total}:*\n${q.flashcard.question}\n\n` +
        `_Responde cuando quieras. Escribe "pista" si necesitas ayuda o "saltar" para pasar._`
      );
    } catch (err) {
      console.error('Error iniciando quiz:', err.message);
      await sendText(jid, '❌ No pude iniciar el quiz.');
    }
    return;
  }

  if (lower === '!quiz-stop' || lower === '!cancelar-quiz') {
    if (!hasActiveQuiz(jid)) {
      await sendText(jid, '✨ No hay quiz activo.');
      return;
    }
    endQuiz(jid);
    await humanDelay();
    await sendText(jid, '🛑 Quiz cancelado.');
    return;
  }

  if (lower.startsWith('!borrar-flashcard ') || lower.startsWith('!del-fc ')) {
    const start = lower.startsWith('!borrar-flashcard ') ? 18 : 8;
    const idStr = text.slice(start).trim();
    const id = parseInt(idStr, 10);

    if (isNaN(id)) {
      await sendText(jid, '❌ Uso: `!borrar-flashcard <id>`');
      return;
    }

    const ok = await deleteFlashcard(id);
    await humanDelay();
    if (ok) {
      await sendText(jid, `🗑️ Flashcard #${id} eliminada.`);
    } else {
      await sendText(jid, `❌ No encontré la flashcard #${id}.`);
    }
    return;
  }

  // ==================== GASTOS ====================
  if (lower.startsWith('!gasto ') || lower.startsWith('!g ')) {
    const start = lower.startsWith('!gasto ') ? 7 : 3;
    const input = text.slice(start).trim();

    const parsed = parseExpense(input);
    if (parsed.error) {
      await sendText(
        jid,
        `❌ ${parsed.error}\n\n*Ejemplos:*\n• \`!gasto 25 almuerzo\`\n• \`!gasto 15.50 taxi\`\n• \`!gasto 30 libro | estudio\``
      );
      return;
    }

    const id = await createExpense(jid, parsed);
    if (!id) {
      await sendText(jid, '❌ No pude guardar el gasto.');
      return;
    }

    await humanDelay();
    await sendText(
      jid,
      `💰 Gasto #${id} registrado\n\n` +
      `💵 *${formatAmount(parsed.amount)}*\n` +
      `📝 ${parsed.description}\n` +
      `${formatCategory(parsed.category)}`
    );
    return;
  }

  if (lower === '!gastos' || lower === '!gastos-hoy' || lower === '!gastos-dia') {
    const today = new Date().toISOString().slice(0, 10);
    const data = await getExpensesSum(jid, { date: today });

    await humanDelay();

    if (data.count === 0) {
      await sendText(jid, '✨ No has registrado gastos hoy, mi amor.');
      return;
    }

    const lines = [`💰 *Gastos de hoy*\n`];
    for (const e of data.expenses.slice(0, 15)) {
      lines.push(`• *${formatAmount(e.amount)}* — ${e.description} ${formatCategory(e.category)}`);
    }
    lines.push(`\n💵 *Total: ${formatAmount(data.total)}* (${data.count} gasto${data.count !== 1 ? 's' : ''})`);

    await sendText(jid, lines.join('\n'));
    return;
  }

  if (lower === '!gastos-semana') {
    const today = new Date();
    const from = new Date(today);
    from.setDate(today.getDate() - 6);

    const data = await getExpensesSum(jid, {
      fromDate: from.toISOString().slice(0, 10),
      toDate: today.toISOString().slice(0, 10),
    });

    await humanDelay();

    if (data.count === 0) {
      await sendText(jid, '✨ No has registrado gastos esta semana.');
      return;
    }

    const lines = [`💰 *Gastos de la semana*\n`];
    lines.push(`💵 *Total: ${formatAmount(data.total)}* (${data.count} gastos)\n`);
    lines.push(`*Por categoría:*`);
    for (const [cat, sum] of Object.entries(data.byCategory).sort((a, b) => b[1] - a[1])) {
      lines.push(`${formatCategory(cat)}: ${formatAmount(sum)}`);
    }

    await sendText(jid, lines.join('\n'));
    return;
  }

  if (lower === '!gastos-mes' || lower === '!gastos-mensual') {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

    const data = await getExpensesSum(jid, {
      fromDate: firstDay.toISOString().slice(0, 10),
      toDate: today.toISOString().slice(0, 10),
    });

    await humanDelay();

    if (data.count === 0) {
      await sendText(jid, '✨ No has registrado gastos este mes.');
      return;
    }

    const monthName = today.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });

    const lines = [`💰 *Gastos de ${monthName}*\n`];
    lines.push(`💵 *Total: ${formatAmount(data.total)}* (${data.count} gastos)\n`);
    lines.push(`*Por categoría:*`);

    const sorted = Object.entries(data.byCategory).sort((a, b) => b[1] - a[1]);
    for (const [cat, sum] of sorted) {
      const pct = Math.round((sum / data.total) * 100);
      lines.push(`${formatCategory(cat)}: ${formatAmount(sum)} (${pct}%)`);
    }

    await sendText(jid, lines.join('\n'));
    return;
  }

  if (lower.startsWith('!borrar-gasto ') || lower.startsWith('!del-g ')) {
    const start = lower.startsWith('!borrar-gasto ') ? 14 : 7;
    const idStr = text.slice(start).trim();
    const id = parseInt(idStr, 10);

    if (isNaN(id)) {
      await sendText(jid, '❌ Uso: `!borrar-gasto <id>`');
      return;
    }

    const ok = await deleteExpense(id);
    await humanDelay();
    await sendText(jid, ok ? `🗑️ Gasto #${id} eliminado.` : `❌ No encontré el gasto #${id}.`);
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
    const fcStats = await getFlashcardStats(jid);

    await sendText(jid, `📊 *Estadísticas*

💬 Mensajes: ${s.messages}
🧠 Hechos: ${s.facts}
📝 Tareas pendientes: ${tasks.length}
📚 Estudio (30d): ${study.studied}/${study.total}
🎴 Flashcards: ${fcStats.total} (✅ ${fcStats.mastered})`);
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
    await sendText(jid, '⏳ Simulando resumen semanal...');
    const { reminderWeeklyPreview } = await import('./cron/reminders.js');
    await reminderWeeklyPreview();
    return;
  }

  if (lower === '!resumen-semana' || lower === '!reporte') {
    await humanDelay();
    await sendText(jid, '⏳ Generando resumen semanal...');
    const { reminderWeeklyPreview } = await import('./cron/reminders.js');
    await reminderWeeklyPreview();
    return;
  }

  // ==================== MANEJO DE RESPUESTAS DE QUIZ ====================
  if (hasActiveQuiz(jid) && !lower.startsWith('!')) {
    const q = nextQuestion(jid);

    if (!q) {
      endQuiz(jid);
    } else {
      if (lower === 'pista' || lower === 'hint' || lower === '?') {
        const expected = q.flashcard.answer;
        const firstWords = expected.split(/\s+/).slice(0, 3).join(' ');
        await humanDelay();
        await sendText(jid, `💡 Pista: _${firstWords}..._`);
        return;
      }

      if (lower === 'saltar' || lower === 'skip' || lower === 'no sé' || lower === 'no se') {
        recordAnswer(jid, false);
        await updateFlashcardStats(q.flashcard.id, false);

        const nextQ = nextQuestion(jid);
        if (!nextQ) {
          const summary = getQuizSummary(jid);
          endQuiz(jid);
          await humanDelay();
          await sendText(
            jid,
            `📊 *Quiz completado*\n\n` +
            `✅ Correctas: ${summary.correct}/${summary.total}\n` +
            `📈 Precisión: ${summary.percentage}%\n\n` +
            (summary.percentage >= 80 ? '🔥 ¡Excelente, mi amor! 💪' :
             summary.percentage >= 50 ? '👍 Buen intento. Sigue practicando.' :
             '📚 Necesitas repasar más. ¡Vamos!')
          );
        } else {
          await humanDelay();
          await sendText(
            jid,
            `❌ La respuesta era:\n*${q.flashcard.answer}*\n\n` +
            `📝 *Pregunta ${nextQ.index}/${nextQ.total}:*\n${nextQ.flashcard.question}`
          );
        }
        return;
      }

      const result = checkAnswer(text, q.flashcard.answer);
      recordAnswer(jid, result.correct);
      await updateFlashcardStats(q.flashcard.id, result.correct);

      const nextQ = nextQuestion(jid);
      if (!nextQ) {
        const summary = getQuizSummary(jid);
        endQuiz(jid);
        await humanDelay();
        const emoji = result.correct ? '✅' : '❌';
        const feedback = result.correct
          ? '¡Correcto!'
          : `La respuesta era:\n*${q.flashcard.answer}*`;

        await sendText(
          jid,
          `${emoji} ${feedback}\n\n` +
          `📊 *Quiz completado*\n` +
          `✅ Correctas: ${summary.correct}/${summary.total}\n` +
          `📈 Precisión: ${summary.percentage}%\n\n` +
          (summary.percentage >= 80 ? '🔥 ¡Excelente, mi amor! 💪' :
           summary.percentage >= 50 ? '👍 Buen intento. Sigue practicando.' :
           '📚 Necesitas repasar más. ¡Vamos!')
        );
      } else {
        await humanDelay();
        const feedback = result.correct
          ? '✅ ¡Correcto!'
          : `❌ La respuesta era:\n*${q.flashcard.answer}*`;

        await sendText(
          jid,
          `${feedback}\n\n` +
          `📝 *Pregunta ${nextQ.index}/${nextQ.total}:*\n${nextQ.flashcard.question}`
        );
      }
      return;
    }
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