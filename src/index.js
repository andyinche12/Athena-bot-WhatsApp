import { config, isOwner, humanDelay } from './config/env.js';
import { buildSystemPrompt } from './config/persona.js';
import { startWhatsApp, sendText, sendAudio, getSocket } from './services/whatsapp/client.js';
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
import { generateMermaidDiagram } from './services/documents/mermaid-generator.js';
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
 *  HELPERS
 * ============================================================ */

function safeFilename(name, ext) {
  let clean = (name || 'documento')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (clean.length > 50) {
    clean = clean.slice(0, 50);
    const lastUnderscore = clean.lastIndexOf('_');
    if (lastUnderscore > 20) clean = clean.slice(0, lastUnderscore);
  }

  return `${clean}.${ext}`;
}

/* ============================================================
 *  AYUDA
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

📊 *DIAGRAMAS CON TEXTO LEGIBLE (Mermaid)*
Habla natural, sin comandos:
• "crea un mapa conceptual de la razón de solvencia"
• "hazme un mapa mental de las NIA"
• "genera un diagrama de flujo del cierre contable"
• "hazme un mapa conceptual de ESTE documento" (tras enviar un PDF)

📄 *CREAR DOCUMENTOS CON IA*
!crear word <tema> → Informe .docx formal
!crear pdf <tema> → Documento PDF
!crear excel <tema> → Tabla con fórmulas reales
!crear ppt <tema> → Presentación con 3 imágenes IA
!mejorar <feedback> → Regenerar el último doc

Extras:
• "sin imágenes" → PPT sin imágenes (~5s)
• "más imágenes" → PPT con 5 imágenes

Ejemplos:
!crear word NIA 500 evidencia de auditoría
!crear ppt Los negocios más rentables en Perú
!crear ppt Empresas peruanas sin imágenes
!mejorar hazlo más corto y agrega ejemplos

📄 *GENERAR MANUAL*
!generar pdf | Título | Párrafo1 | Párrafo2
!generar excel | Título | A1,B1\\nA2,B2

🎨 *IMÁGENES ARTÍSTICAS (IA)*
!dibujar <descripción> → Imagen con IA (Cloudflare FLUX)
!draw <descripción> → Alias
Ej: !dibujar un gato astronauta flotando en el espacio
También: "crea una imagen de un gatito" (sin !)

🖼️ *GRÁFICOS/TEXTO*
!imagen Título | Contenido → Gráfico simple SVG
!img Título | Contenido (alias)

📎 *LEER DOCUMENTOS*
Envía PDF, Word, Excel o PPT → lo analizo

📊 *SISTEMA*
!stats → Estadísticas + progreso
!resumen-semana → Reporte semanal
!ping → Estado de los 4 LLMs
!modelos-nvidia → Ver modelos NVIDIA
!reset → Borra historial
!help → Esta ayuda
!ayuda-rapida → Solo comandos básicos

🎤 *AUDIO*
Envía una nota de voz → la transcribo
!voz <texto> → Forzar respuesta en audio
!texto <texto> → Forzar respuesta en texto

🖼️ *ANALIZAR IMÁGENES*
Envía una foto (con o sin caption) → la analizo

✅ *ESTUDIO*
"sí estudié" / "no estudié" → Responder al recordatorio

🧪 *DEBUG*
!test-today → Simula recordatorio 07:00
!test-midday → Simula clima mediodía
!test-reminder → Simula recordatorio 19:00
!test-review → Simula repaso nocturno
!test-week → Simula resumen semanal
!test-sunday → Simula "Preparando el lunes"`;

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

📊 *Diagramas*
"hazme un mapa conceptual de X" → Mermaid
"crea un diagrama de flujo de X" → Mermaid

📄 *Documentos*
!crear word NIA 500 → Word con IA
!crear ppt tema → PPT con 3 imágenes IA
!mejorar hazlo más corto → Regenerar
!generar pdf | Título | Contenido

🎨 *Imágenes*
!dibujar un gato en el espacio → IA (Cloudflare)
!imagen Título | Contenido → Gráfico simple

!stats → Tus estadísticas
!help → Ayuda completa

🎤 Manda audio → lo transcribo
🖼️ Manda foto → la analizo
📎 Manda PDF/Word/Excel → lo leo`;

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
 *  Estado en memoria: último documento generado por usuario
 * ============================================================ */
const lastDocument = new Map(); // jid → { tipo, tema, filename, data }

/* ============================================================
 *  Último documento RECIBIDO (para dar contexto a Mermaid)
 * ============================================================ */
const lastReceivedDocument = new Map(); // jid → { text, filename, timestamp }

/* ============================================================
 *  Cola de mensajes por usuario
 * ============================================================ */
const userQueues = new Map(); // jid → Promise de la cola actual

function enqueueForUser(jid, task) {
  const prev = userQueues.get(jid) || Promise.resolve();
  const next = prev.then(task).catch((err) => {
    console.error(`❌ Error en cola de ${jid}:`, err.message);
  });
  userQueues.set(jid, next);
  next.finally(() => {
    if (userQueues.get(jid) === next) {
      userQueues.delete(jid);
    }
  });
  return next;
}

/* ============================================================
 *  Detección de intención de diagrama (Mermaid)
 * ============================================================ */
function detectDiagramIntent(text) {
  if (!text) return false;

  const lower = text.toLowerCase();

  const hasDiagramNoun = /\b(mapa\s+conceptual|mapa\s+mental|mapas\s+conceptuales|mapas\s+mentales|diagrama|diagramas|flujograma|flujogramas|organigrama|organigramas|flowchart|esquema|esquemas|cuadro\s+sin[óo]ptico|mind\s*map|concept\s*map)\b/i.test(lower);

  const hasCreateVerb = /\b(crea|crear|creas|crees|haz|hazme|hacer|genera|generar|generas|realiza|realizar|elabora|elaborar|quiero|quisiera|necesito|me\s+gustar[íi]a|puedes|podr[íi]as|arma|ármame)\b/i.test(lower);

  return hasDiagramNoun && hasCreateVerb;
}

/* ============================================================
 *  Detección natural de imágenes
 * ============================================================ */
function detectImageIntent(text) {
  if (!text) return null;

  const lower = text.toLowerCase();

  const hasCreateVerb = /\b(crea|crear|creas|crees|dibuja|dibujar|dibujas|dib[úu]jame|dibujame|haz|hazme|hacer|genera|generar|generas|gen[ée]rame|generame|realiza|realizar|realizas|elabora|elaborar|elaboras|quiero|quisiera|necesito|me\s+gustar[íi]a|puedes|podr[íi]as)\b/i.test(lower);

  const hasVisualNoun = /\b(imagen|im[áa]genes|foto|fotos|dibujo|dibujos|ilustraci[óo]n|ilustraciones|infograf[íi]a|infograf[íi]as|gr[áa]fico|gr[áa]ficos)\b/i.test(lower);

  if (!hasCreateVerb || !hasVisualNoun) return null;

  if (/^(qu[ée]|cu[áa]l|d[óo]nde|c[óo]mo|por\s+qu[ée])\b/i.test(lower.trim())) {
    return null;
  }

  return { description: text.trim() };
}

/* ============================================================
 *  Helper: genera todas las imágenes IA para un PPT
 *  Retorna: [{ slideIndex: -1|N, buffer: Buffer }, ...]
 * ============================================================ */
async function generatePptImages(jid, data, temaOrigen) {
  const images = [];
  const textoDetector = `${temaOrigen} ${data.title || ''}`.toLowerCase();

  // Si el usuario dice "sin imágenes", no generamos nada
  if (/sin\s+im[aá]genes?|sin\s+fotos?|no\s+quiero\s+im[aá]genes?/.test(textoDetector)) {
    console.log('   🚫 Usuario pidió SIN imágenes, saltando generación');
    await sendText(jid, `🚫 Saltando imágenes (pediste sin imágenes)`);
    return images;
  }

  const quiereMas = /m[aá]s\s+im[aá]genes?|con\s+muchas\s+im[aá]genes?|muchas\s+im[aá]genes?/.test(textoDetector);
  const maxContenido = quiereMas ? 4 : 2;

  const { generateAIImage } = await import('./services/documents/image-generator.js');

  // ---- 1) Portada ----
  if (data.coverImagePrompt) {
    try {
      await sendText(jid, `🎨 Generando imagen de portada...\n_~20 seg_`);
      const buf = await generateAIImage(data.coverImagePrompt);
      images.push({ slideIndex: -1, buffer: buf });
      console.log(`   🎨 Portada generada (${(buf.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.warn('   ⚠️  Portada IA falló:', err.message);
    }
  }

  // ---- 2) Imágenes de contenido ----
  const contentImgs = Array.isArray(data.contentImages) ? data.contentImages : [];
  const toGenerate = contentImgs.slice(0, maxContenido);

  for (let i = 0; i < toGenerate.length; i++) {
    const ci = toGenerate[i];
    if (typeof ci.slideIndex !== 'number' || !ci.prompt) continue;
    try {
      await sendText(jid, `🎨 Generando imagen ${i + 1}/${toGenerate.length}...\n_~20 seg_`);
      const buf = await generateAIImage(ci.prompt);
      images.push({ slideIndex: ci.slideIndex, buffer: buf });
      console.log(`   🎨 Imagen slide #${ci.slideIndex} generada (${(buf.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.warn(`   ⚠️  Imagen ${i + 1} falló:`, err.message);
    }
  }

  console.log(`   ✅ Total imágenes generadas: ${images.length}`);
  return images;
}

/* ============================================================
 *  HANDLER PRINCIPAL
 * ============================================================ */
async function handleMessage(sock, msg) {
  const jid = msg.key.remoteJid;
  const pushName = msg.pushName || 'desconocido';

  const isAudio = !!msg.message?.audioMessage;
  const isImage = !!msg.message?.imageMessage;
  const isDocument = !!msg.message?.documentMessage;

  let replyWithVoice = false;

  let text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    msg.message?.documentMessage?.caption ||
    '';

  console.log(`\n📩 [${pushName}] JID=${jid}`);
  if (isAudio) console.log('   🎤 Es una nota de voz');
  if (isImage) console.log('   🖼️  Es una imagen');
  if (isDocument) console.log('   📄 Es un documento');

  if (!text && !isAudio && !isImage && !isDocument) return;
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

  // ==================== ANÁLISIS DE IMAGEN (adjunta) ====================
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

  // ==================== ANÁLISIS DE DOCUMENTO ====================
  if (isDocument) {
    const { extractDocumentText, isSupportedDocument } = await import('./services/documents/parser.js');

    const docMsg = msg.message.documentMessage;
    const mimetype = docMsg.mimetype || '';
    const filename = docMsg.fileName || 'documento';

    if (!isSupportedDocument(mimetype)) {
      await sendText(jid, `❌ No puedo leer archivos de tipo: ${mimetype}\n\nFormatos soportados: PDF, Word, Excel, PowerPoint`);
      return;
    }

    try {
      await sendText(jid, `📄 Leyendo "${filename}"...`);
      const { text: docText } = await extractDocumentText(msg, sock);

      if (!docText || docText.length < 10) {
        await sendText(jid, '❌ No pude extraer texto del documento. ¿Está escaneado como imagen?');
        return;
      }

      lastReceivedDocument.set(jid, {
        text: docText,
        filename,
        timestamp: Date.now(),
      });
      console.log(`   💾 Documento guardado en memoria (${docText.length} chars)`);

      const caption = docMsg.caption || '';
      text = caption
        ? `${caption}\n\n[Contenido de "${filename}"]:\n${docText}`
        : `[El usuario envió el archivo "${filename}". Contenido extraído:]\n\n${docText}\n\nResponde al contenido de forma útil.`;

      console.log(`   ✅ Documento "${filename}" listo para el LLM`);
    } catch (err) {
      console.error('Error leyendo documento:', err.message);
      await sendText(jid, `❌ No pude leer el documento, mi amor. ${err.message}`);
      return;
    }
  }

  // ==================== VARIABLES BASE ====================
  console.log(`   Texto: "${text.slice(0, 200)}${text.length > 200 ? '...' : ''}"`);
  const lower = text.trim().toLowerCase();

  // ==================== DETECCIÓN DE DIAGRAMAS (Mermaid) ====================
  if (!isAudio && !isImage && !isDocument && detectDiagramIntent(text)) {
    console.log(`   📊 Detectada intención de diagrama (Mermaid)`);
    const preview = text.length > 100 ? text.slice(0, 100) + '...' : text;
    await sendText(jid, `📊 Generando diagrama...\n_"${preview}"_\n_Esto puede tardar 15-25 segundos_`);

    try {
      const mentionsDoc = /\b(documento|archivo|pdf|word|excel|ppt|pptx)\b/i.test(text);
      let contextText = '';
      if (mentionsDoc) {
        const lastDoc = lastReceivedDocument.get(jid);
        if (lastDoc && (Date.now() - lastDoc.timestamp) < 10 * 60 * 1000) {
          contextText = lastDoc.text;
          console.log(`   📎 Usando contexto de "${lastDoc.filename}"`);
        } else {
          console.log(`   ⚠️  Menciona documento pero no hay reciente en memoria`);
        }
      }

      const { buffer, code } = await generateMermaidDiagram(text, contextText);

      await sock.sendMessage(jid, {
        image: buffer,
        caption: `📊 Diagrama generado`,
      });

      console.log(`   ✅ Diagrama enviado (${(buffer.length / 1024).toFixed(1)} KB)`);
      console.log(`   📝 Mermaid code:\n${code}`);
    } catch (err) {
      console.error('Error generando diagrama:', err.message);
      await sendText(jid, `❌ No pude generar el diagrama: ${err.message.slice(0, 200)}`);
    }
    return;
  }

  // ==================== DETECCIÓN NATURAL DE IMÁGENES ARTÍSTICAS ====================
  if (!isAudio && !isImage && !isDocument) {
    const imageIntent = detectImageIntent(text);
    if (imageIntent) {
      const descripcion = imageIntent.description;
      const preview = descripcion.length > 120 ? descripcion.slice(0, 120) + '...' : descripcion;
      console.log(`   🎨 Detectada intención natural de imagen: "${preview}"`);
      await sendText(jid, `🎨 Generando imagen...\n_"${preview}"_\n_Esto puede tardar 20-30 segundos_`);

      try {
        const { generateAIImage } = await import('./services/documents/image-generator.js');
        const buffer = await generateAIImage(descripcion);

        await sock.sendMessage(jid, {
          image: buffer,
          caption: `🎨 ${preview}`,
        });

        console.log(`   ✅ Imagen natural enviada (${(buffer.length / 1024).toFixed(1)} KB)`);
      } catch (err) {
        console.error('Error generando imagen natural:', err.message);
        await sendText(jid, `❌ No pude generar la imagen: ${err.message}`);
      }
      return;
    }
  }

  // ==================== DETECCIÓN DE VOZ ====================
  const userAskedForVoice = VOICE_KEYWORDS.some((kw) => lower.includes(kw));
  if (userAskedForVoice) {
    replyWithVoice = true;
    console.log('   🔊 Usuario pidió respuesta en audio');
  }

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

  // ==================== COMANDO EXPLÍCITO !diagrama / !mermaid ====================
  if (lower.startsWith('!diagrama ') || lower.startsWith('!mermaid ')) {
    const offset = lower.startsWith('!diagrama ') ? 10 : 9;
    const request = text.slice(offset).trim();

    if (!request) {
      await sendText(jid, `📊 *Generar diagramas con texto legible*\n\nFormato: \`!diagrama <descripción>\`\n\n*Ejemplos:*\n\`!diagrama mapa conceptual de la NIC 16\`\n\`!diagrama mapa mental del proceso contable\`\n\`!diagrama flujograma de compras\``);
      return;
    }

    await sendText(jid, `📊 Generando diagrama...\n_"${request.slice(0, 100)}"_`);
    try {
      const { buffer, code } = await generateMermaidDiagram(request);
      await sock.sendMessage(jid, {
        image: buffer,
        caption: `📊 ${request}`,
      });
      console.log(`   ✅ Diagrama enviado (${(buffer.length / 1024).toFixed(1)} KB)`);
      console.log(`   📝 Mermaid code:\n${code}`);
    } catch (err) {
      console.error('Error generando diagrama:', err.message);
      await sendText(jid, `❌ No pude generar el diagrama: ${err.message.slice(0, 200)}`);
    }
    return;
  }

  // ==================== DIBUJAR IMAGEN ARTÍSTICA (Cloudflare) ====================
  if (lower.startsWith('!dibujar ') || lower.startsWith('!draw ')) {
    const offset = lower.startsWith('!dibujar ') ? 9 : 6;
    const prompt = text.slice(offset).trim();

    if (!prompt) {
      await sendText(jid, `🎨 *Generar imágenes artísticas*\n\nFormato: \`!dibujar <descripción>\`\n\n*Ejemplos:*\n\`!dibujar un gato astronauta flotando en el espacio\`\n\`!dibujar un atardecer en los Andes peruanos, estilo acuarela\`\n\`!dibujar un poster minimalista sobre finanzas\``);
      return;
    }

    await sendText(jid, `🎨 Generando imagen con IA...\n_"${prompt}"_\n_Esto puede tardar ~20-30 segundos_`);

    try {
      const { generateAIImage } = await import('./services/documents/image-generator.js');
      const buffer = await generateAIImage(prompt);

      await sock.sendMessage(jid, {
        image: buffer,
        caption: `🎨 ${prompt}`,
      });

      console.log(`   ✅ Imagen artística enviada (${(buffer.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.error('Error generando imagen artística:', err.message);
      await sendText(jid, `❌ No pude generar la imagen: ${err.message}`);
    }
    return;
  }

  // ==================== IMAGEN SIMPLE (SVG) ====================
  if (lower.startsWith('!imagen ') || lower.startsWith('!img ')) {
    const offset = lower.startsWith('!imagen ') ? 8 : 5;
    const rest = text.slice(offset).trim();
    const parts = rest.split('|').map(s => s.trim()).filter(Boolean);

    if (parts.length < 1) {
      await sendText(jid, `🖼️ *Generar gráficos de texto*\n\nFormato: \`!imagen <título> | <contenido>\`\n\n*Ejemplo:*\n\`!imagen Mi Resumen | Contenido del gráfico\`\n\n_Para imágenes artísticas usa \`!dibujar <descripción>\`_`);
      return;
    }

    const [titulo, ...contenidoParts] = parts;
    const contenido = contenidoParts.join(' | ');

    await sendText(jid, '🎨 Generando gráfico...');

    try {
      const { generateTextImage } = await import('./services/documents/image-generator.js');
      const buffer = await generateTextImage(titulo, contenido);

      await sock.sendMessage(jid, {
        image: buffer,
        caption: `🖼️ ${titulo}`,
      });

      console.log(`   ✅ Imagen enviada (${(buffer.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.error('Error generando imagen:', err.message);
      await sendText(jid, `❌ No pude generar la imagen: ${err.message}`);
    }
    return;
  }

  // ==================== GENERAR DOCUMENTOS MANUALES ====================
  if (lower.startsWith('!generar ')) {
    const rest = text.slice(8).trim();
    const parts = rest.split('|').map(s => s.trim()).filter(Boolean);

    if (parts.length < 2) {
      await sendText(jid, `📄 *Generar documentos manualmente*\n\nFormato: \`!generar <tipo> | <titulo> | <contenido>\`\n\n*Tipos:* excel, word, ppt, pdf\n\n*Ejemplos:*\n\`!generar pdf | Resumen Auditoría | Contenido del documento\`\n\`!generar excel | Gastos | Concepto,Monto\\nAlmuerzo,25\``);
      return;
    }

    const [tipo, titulo, ...contenidoParts] = parts;
    const contenido = contenidoParts.join(' | ');

    await sendText(jid, `⏳ Generando ${tipo.toUpperCase()}...`);

    try {
      let buffer, filename, mimetype;
      const gen = await import('./services/documents/generator.js');

      if (tipo === 'excel') {
        const rows = contenido.split('\\n').map(line => line.split(',').map(c => c.trim()));
        buffer = await gen.generateExcel(titulo, rows);
        filename = safeFilename(titulo, 'xlsx');
        mimetype = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      } else if (tipo === 'word') {
        const sections = [{ heading: null, paragraphs: contenido.split('\\n').filter(Boolean) }];
        buffer = await gen.generateWord(titulo, sections);
        filename = safeFilename(titulo, 'docx');
        mimetype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      } else if (tipo === 'ppt') {
        const slides = contenido.split('\\n').filter(Boolean).map((s, i) => ({
          title: `${titulo} — ${i + 1}`,
          bullets: [s],
        }));
        buffer = await gen.generatePowerPoint(titulo, slides, []);
        filename = safeFilename(titulo, 'pptx');
        mimetype = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      } else if (tipo === 'pdf') {
        const sections = [{ heading: null, paragraphs: contenido.split('\\n').filter(Boolean) }];
        buffer = await gen.generatePDF(titulo, sections);
        filename = safeFilename(titulo, 'pdf');
        mimetype = 'application/pdf';
      } else {
        await sendText(jid, `❌ Tipo "${tipo}" no reconocido. Usa: excel, word, ppt, pdf`);
        return;
      }

      await sock.sendMessage(jid, {
        document: buffer,
        mimetype,
        fileName: filename,
      });

      await sendText(jid, `✅ ${filename} · ${(buffer.length / 1024).toFixed(1)} KB`);
      console.log(`   ✅ Documento enviado: ${filename}`);
    } catch (err) {
      console.error('Error generando documento:', err.message);
      await sendText(jid, `❌ No pude generar el documento: ${err.message}`);
    }
    return;
  }

  // ==================== CREAR DOCUMENTOS CON IA ====================
  if (lower.startsWith('!crear ')) {
    const rest = text.slice(7).trim();

    const firstSpace = rest.indexOf(' ');
    let tipo = (firstSpace > 0 ? rest.slice(0, firstSpace) : rest).toLowerCase().trim();

    const TYPOS = {
      exel: 'excel', excell: 'excel', exce: 'excel', exl: 'excel', ecxel: 'excel',
      wor: 'word', worl: 'word', wrd: 'word', wrod: 'word', doc: 'word', docx: 'word',
      pfd: 'pdf', dpf: 'pdf', pf: 'pdf',
      ptt: 'ppt', pt: 'ppt', power: 'ppt', powerpo: 'ppt', pp: 'ppt', pptx: 'ppt',
    };
    if (TYPOS[tipo]) {
      console.log(`   ✏️  Typo corregido: "${tipo}" → "${TYPOS[tipo]}"`);
      tipo = TYPOS[tipo];
    }

    if (!['word', 'pdf', 'excel', 'ppt'].includes(tipo)) {
      await sendText(jid, `❌ Tipo "${tipo}" no válido. Usa: word, pdf, excel, ppt\n\nEjemplo: \`!crear word crianza de pollitos en Junín\``);
      return;
    }

    let tema = firstSpace > 0 ? rest.slice(firstSpace + 1).trim() : '';
    if (tema.startsWith('|')) tema = tema.slice(1).trim();
    tema = tema.replace(/\s*\|\s*/g, ' ').trim();

    if (!tema) {
      await sendText(jid, `🤖 *Crear documentos con IA*\n\nFormato: \`!crear <tipo> <tema>\`\n\n*Tipos:*\n• \`word\` → Informe formal\n• \`pdf\` → Documento PDF\n• \`excel\` → Tabla de datos\n• \`ppt\` → Presentación con imágenes IA\n\n*Ejemplos:*\n\`!crear word crianza de pollitos en Junín\`\n\`!crear ppt Los negocios más rentables en Perú\`\n\`!crear excel presupuesto mensual de una MYPE\``);
      return;
    }

    const t0 = Date.now();
    await sendText(jid, `🧠 Redactando sobre "${tema}"...\n_Esto puede tardar unos segundos_`);

    try {
      const { aiWrite } = await import('./services/documents/ai-writer.js');
      const { data, provider } = await aiWrite(tipo, tema);

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      await sendText(jid, `📄 Contenido listo · Redactado por *${provider}* en ${elapsed}s\nGenerando archivo ${tipo.toUpperCase()}...`);

      const gen = await import('./services/documents/generator.js');
      let buffer, filename, mimetype;

      if (tipo === 'word') {
        buffer = await gen.generateWord(data.title || tema, data.sections || []);
        filename = safeFilename(data.title || tema, 'docx');
        mimetype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      } else if (tipo === 'pdf') {
        buffer = await gen.generatePDF(data.title || tema, data.sections || []);
        filename = safeFilename(data.title || tema, 'pdf');
        mimetype = 'application/pdf';
      } else if (tipo === 'excel') {
        const allRows = [data.headers || [], ...(data.rows || [])];
        buffer = await gen.generateExcel(data.title || tema, allRows);
        filename = safeFilename(data.title || tema, 'xlsx');
        mimetype = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      } else if (tipo === 'ppt') {
        const images = await generatePptImages(jid, data, tema);
        buffer = await gen.generatePowerPoint(data.title || tema, data.slides || [], images);
        filename = safeFilename(data.title || tema, 'pptx');
        mimetype = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      }

      await sock.sendMessage(jid, {
        document: buffer,
        mimetype,
        fileName: filename,
      });

      lastDocument.set(jid, { tipo, tema, filename, data });

      const kb = (buffer.length / 1024).toFixed(1);
      await sendText(jid, `✅ *${filename}* · ${kb} KB\n\n¿Quieres ajustes? Usa \`!mejorar <instrucciones>\``);
      console.log(`   ✅ Documento IA enviado: ${filename} (${provider})`);
    } catch (err) {
      console.error('Error creando documento con IA:', err.message);
      await sendText(jid, `❌ No pude generar el documento: ${err.message}`);
    }
    return;
  }

  // ==================== MEJORAR ÚLTIMO DOCUMENTO ====================
  if (lower.startsWith('!mejorar')) {
    const feedback = text.slice(8).trim();
    const last = lastDocument.get(jid);

    if (!last) {
      await sendText(jid, '❌ No tengo un documento reciente para mejorar.\n\nUsa primero:\n`!crear word | tema`');
      return;
    }

    if (!feedback) {
      await sendText(jid, `🤔 Dime cómo quieres mejorarlo.\n\n*Ejemplos:*\n• \`!mejorar hazlo más corto\`\n• \`!mejorar agrega ejemplos numéricos\`\n• \`!mejorar incluye NIA 500 textual\`\n• \`!mejorar cambia el tono a más formal\`\n\n_Documento actual: ${last.filename}_`);
      return;
    }

    const t0 = Date.now();
    await sendText(jid, `🔧 Regenerando *${last.tipo.toUpperCase()}* sobre "${last.tema}"...\n_Feedback: "${feedback}"_\n_Esto puede tardar unos segundos_`);

    try {
      const { aiWrite } = await import('./services/documents/ai-writer.js');
      const { data, provider } = await aiWrite(last.tipo, last.tema, feedback, last.data);

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      await sendText(jid, `📄 Versión mejorada lista · ${provider} en ${elapsed}s\nGenerando archivo...`);

      const gen = await import('./services/documents/generator.js');
      let buffer, filename, mimetype;

      if (last.tipo === 'word') {
        buffer = await gen.generateWord(data.title || last.tema, data.sections || []);
        filename = safeFilename(data.title || last.tema, 'docx');
        mimetype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      } else if (last.tipo === 'pdf') {
        buffer = await gen.generatePDF(data.title || last.tema, data.sections || []);
        filename = safeFilename(data.title || last.tema, 'pdf');
        mimetype = 'application/pdf';
      } else if (last.tipo === 'excel') {
        const allRows = [data.headers || [], ...(data.rows || [])];
        buffer = await gen.generateExcel(data.title || last.tema, allRows);
        filename = safeFilename(data.title || last.tema, 'xlsx');
        mimetype = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      } else if (last.tipo === 'ppt') {
        const images = await generatePptImages(jid, data, last.tema);
        buffer = await gen.generatePowerPoint(data.title || last.tema, data.slides || [], images);
        filename = safeFilename(data.title || last.tema, 'pptx');
        mimetype = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      }

      await sock.sendMessage(jid, {
        document: buffer,
        mimetype,
        fileName: filename,
      });

      // Preservar data para futuras mejoras
      lastDocument.set(jid, { tipo: last.tipo, tema: last.tema, filename, data });

      const kb = (buffer.length / 1024).toFixed(1);
      await sendText(jid, `✅ *${filename}* · ${kb} KB\n\nOtro ajuste? Usa \`!mejorar ...\``);
      console.log(`   ✅ Documento mejorado: ${filename} (${provider})`);
    } catch (err) {
      console.error('Error mejorando documento:', err.message);
      await sendText(jid, `❌ No pude mejorar el documento: ${err.message}`);
    }
    return;
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
      const id = await createTask(jid, { title: cleanTitle, dueDate });
      const dueText = dueDate ? `\n📅 Vence: *${formatDueDate(dueDate)}*` : '';
      const reminderText = dueDate ? '\nTe aviso el día anterior y el mismo día 💙' : '';

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
      if (tasks.length > 15) lines.push(`\n_(+${tasks.length - 15} más)_`);
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
      await sendText(jid, '❌ Uso: `!flashcard pregunta | respuesta`\n\nEjemplo:\n!flashcard ¿Qué es el encaje bancario? | Reserva obligatoria en el BCRP, 4-6% de depósitos');
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
      await sendText(jid, `🎴 Flashcard #${id} guardada\n\n*P:* ${question.trim()}\n*R:* ${answer}`);
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
        const accuracy = c.times_shown > 0 ? Math.round((c.times_right / c.times_shown) * 100) : 0;
        const badge = c.times_shown === 0 ? '🆕' : accuracy >= 80 ? '✅' : accuracy >= 50 ? '🟡' : '🔴';
        lines.push(`${badge} *#${c.id}* ${c.question}`);
      }
      if (cards.length > 10) lines.push(`\n_(+${cards.length - 10} más)_`);

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
      await sendText(jid, `📚 *Quiz iniciado — ${cards.length} preguntas*\n\n` + `📝 *Pregunta ${q.index}/${q.total}:*\n${q.flashcard.question}\n\n` + `_Responde cuando quieras. Escribe "pista" si necesitas ayuda o "saltar" para pasar._`);
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
      await sendText(jid, `❌ ${parsed.error}\n\n*Ejemplos:*\n• \`!gasto 25 almuerzo\`\n• \`!gasto 15.50 taxi\`\n• \`!gasto 30 libro | estudio\``);
      return;
    }

    const id = await createExpense(jid, parsed);
    if (!id) {
      await sendText(jid, '❌ No pude guardar el gasto.');
      return;
    }

    await humanDelay();
    await sendText(jid, `💰 Gasto #${id} registrado\n\n` + `💵 *${formatAmount(parsed.amount)}*\n` + `📝 ${parsed.description}\n` + `${formatCategory(parsed.category)}`);
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

  if (lower === '!modelos-nvidia' || lower === '!nvidia') {
    await sendText(jid, '🔍 Consultando modelos NVIDIA...');
    try {
      const OpenAI = (await import('openai')).default;
      const client = new OpenAI({
        apiKey: config.nvidiaApiKey,
        baseURL: 'https://integrate.api.nvidia.com/v1',
      });
      const models = await client.models.list();
      const list = models.data.map((m) => m.id).sort();

      const relevantes = list.filter(
        (m) =>
          m.includes('nemotron') ||
          m.includes('llama-3.3') ||
          m.includes('deepseek-v3') ||
          m.includes('qwen')
      );

      const lines = [`🤖 *Modelos NVIDIA disponibles (${list.length})*\n`];
      lines.push('⭐ *Recomendados:*');
      for (const id of relevantes.slice(0, 15)) {
        lines.push(`• \`${id}\``);
      }
      if (relevantes.length > 15) {
        lines.push(`\n_(+${relevantes.length - 15} más)_`);
      }
      lines.push('\n_Usa `!ping` para probar los 4 proveedores_');

      await sendText(jid, lines.join('\n'));
    } catch (err) {
      console.error('Error listando NVIDIA:', err.message);
      await sendText(jid, `❌ Error: ${err.message}`);
    }
    return;
  }

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

  // ==================== PROGRESO / DASHBOARD ====================
  if (lower === '!progreso' || lower === '!dashboard' || lower === '!avance') {
    try {
      await humanDelay();
      const [s, study30, tasks, fcStats, expenseMonth, expenseWeek] = await Promise.all([
        getStats(jid),
        getStudyStats(jid, 30),
        getPendingTasks(jid),
        getFlashcardStats(jid),
        (async () => {
          const today = new Date();
          const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
          return getExpensesSum(jid, {
            fromDate: firstDay.toISOString().slice(0, 10),
            toDate: today.toISOString().slice(0, 10),
          });
        })(),
        (async () => {
          const today = new Date();
          const weekStart = new Date(today);
          weekStart.setDate(today.getDate() - 6);
          return getExpensesSum(jid, {
            fromDate: weekStart.toISOString().slice(0, 10),
            toDate: today.toISOString().slice(0, 10),
          });
        })(),
      ]);

      const pctStudy = study30.total > 0 ? Math.round((study30.studied / study30.total) * 100) : 0;
      const lines = [`📊 *Tu progreso*\n`];

      lines.push(`📚 *Estudio (30 días)*`);
      if (study30.total === 0) {
        lines.push(`• Sin datos todavía`);
      } else {
        const bar = '█'.repeat(Math.round(pctStudy / 10)) + '░'.repeat(10 - Math.round(pctStudy / 10));
        lines.push(`• ${bar} ${pctStudy}%`);
        lines.push(`• Días confirmados: *${study30.studied}/${study30.total}*`);
        if (pctStudy >= 70) lines.push(`🔥 ¡Ritmo excelente!`);
        else if (pctStudy >= 40) lines.push(`👍 Buen ritmo, sigue así.`);
        else lines.push(`💪 A subir ese ritmo, mi amor.`);
      }
      lines.push('');

      lines.push(`📝 *Tareas*`);
      lines.push(`• Pendientes: *${tasks.length}*`);
      if (tasks.length > 0) {
        const next = tasks[0];
        const due = next.due_date ? ` — 📅 ${next.due_date}` : '';
        lines.push(`• Próxima: ${next.title}${due}`);
      }
      lines.push('');

      lines.push(`🎴 *Flashcards*`);
      if (fcStats.total === 0) {
        lines.push(`• Sin tarjetas todavía`);
      } else {
        const pctFc = Math.round((fcStats.mastered / fcStats.total) * 100);
        const barFc = '█'.repeat(Math.round(pctFc / 10)) + '░'.repeat(10 - Math.round(pctFc / 10));
        lines.push(`• ${barFc} ${pctFc}% dominadas`);
        lines.push(`• Total: ${fcStats.total} (✅ ${fcStats.mastered} · 📖 ${fcStats.toReview})`);
      }
      lines.push('');

      lines.push(`💰 *Gastos*`);
      lines.push(`• Este mes: *${formatAmount(expenseMonth.total)}* (${expenseMonth.count})`);
      lines.push(`• Esta semana: *${formatAmount(expenseWeek.total)}* (${expenseWeek.count})`);

      if (expenseMonth.count > 0) {
        const topCat = Object.entries(expenseMonth.byCategory).sort((a, b) => b[1] - a[1])[0];
        if (topCat) {
          lines.push(`• Mayor gasto: ${formatCategory(topCat[0])} → ${formatAmount(topCat[1])}`);
        }
      }
      lines.push('');

      lines.push(`💬 *Conversación*`);
      lines.push(`• Mensajes guardados: ${s.messages}`);
      lines.push('');

      lines.push('_Usa !stats para detalles, !quiz para practicar_');

      await sendText(jid, lines.join('\n'));
    } catch (err) {
      console.error('Error en !progreso:', err.message);
      await sendText(jid, '❌ No pude generar tu progreso, mi amor.');
    }
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

  if (lower === '!test-sunday') {
    await humanDelay();
    await sendText(jid, '⏳ Simulando preparación del lunes...');
    const { sendSundayPrep } = await import('./cron/reminders.js');
    await sendSundayPrep();
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
          await sendText(jid, `📊 *Quiz completado*\n\n` + `✅ Correctas: ${summary.correct}/${summary.total}\n` + `📈 Precisión: ${summary.percentage}%\n\n` + (summary.percentage >= 80 ? '🔥 ¡Excelente, mi amor! 💪' : summary.percentage >= 50 ? '👍 Buen intento. Sigue practicando.' : '📚 Necesitas repasar más. ¡Vamos!'));
        } else {
          await humanDelay();
          await sendText(jid, `❌ La respuesta era:\n*${q.flashcard.answer}*\n\n` + `📝 *Pregunta ${nextQ.index}/${nextQ.total}:*\n${nextQ.flashcard.question}`);
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
        const feedback = result.correct ? '¡Correcto!' : `La respuesta era:\n*${q.flashcard.answer}*`;

        await sendText(jid, `${emoji} ${feedback}\n\n` + `📊 *Quiz completado*\n` + `✅ Correctas: ${summary.correct}/${summary.total}\n` + `📈 Precisión: ${summary.percentage}%\n\n` + (summary.percentage >= 80 ? '🔥 ¡Excelente, mi amor! 💪' : summary.percentage >= 50 ? '👍 Buen intento. Sigue practicando.' : '📚 Necesitas repasar más. ¡Vamos!'));
      } else {
        await humanDelay();
        const feedback = result.correct ? '✅ ¡Correcto!' : `❌ La respuesta era:\n*${q.flashcard.answer}*`;
        await sendText(jid, `${feedback}\n\n` + `📝 *Pregunta ${nextQ.index}/${nextQ.total}:*\n${nextQ.flashcard.question}`);
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
      { role: 'system', content: buildSystemPrompt() },
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
 *  Wrapper con cola de mensajes por usuario
 * ============================================================ */
async function handleMessageQueued(sock, msg) {
  const jid = msg.key?.remoteJid;
  if (!jid) {
    return handleMessage(sock, msg);
  }
  return enqueueForUser(jid, () => handleMessage(sock, msg));
}

/* ============================================================
 *  SERVIDOR HTTP
 * ============================================================ */
const PORT = process.env.PORT || 3000;
const server = createServer((req, res) => {
  if (req.url === '/health') {
    const sock = getSocket();
    const waConnected = !!sock?.user?.id;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'athena-bot-whatsapp',
      whatsapp: waConnected ? 'connected' : 'starting',
      uptime: Math.round(process.uptime()),
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
  console.log('\n🚀 Iniciando Athena Bot...\n');
  try {
    await startWhatsApp(handleMessageQueued);
    console.log('✅ WhatsApp iniciado. Arrancando cron...');
    startCronJobs();
    console.log('✅ Cron arrancado. Bot listo.');
  } catch (err) {
    console.error('❌ Error fatal en startWhatsApp:');
    console.error(err);
    if (err.stack) console.error(err.stack);
    console.error('⏳ Reintentando en 15 segundos...');
    setTimeout(() => {
      startWhatsApp(handleMessageQueued)
        .then(() => startCronJobs())
        .catch((e) => console.error('❌ Falló el reintento:', e));
    }, 15000);
  }
})();

process.on('SIGINT', () => {
  console.log('\n👋 Cerrando Athena Bot...');
  process.exit(0);
});