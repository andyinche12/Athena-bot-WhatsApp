import { config, isOwner, humanDelay } from './config/env.js';
import { SYSTEM_PROMPT } from './config/persona.js';
import { startWhatsApp, sendText } from './services/whatsapp/client.js';
import { askLLM, pingProvider, PROVIDERS_AVAILABLE } from './services/llm/router.js';
import {
  saveMessage,
  getRecentMessages,
  clearHistory,
  getStats,
} from './memory/store.js';
import {
  getToday,
  getTomorrow,
  getWeek,
  getNextClass,
} from './syllabus/schedule.js';

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

// --- Handler de mensajes ---
async function handleMessage(sock, msg) {
  const jid = msg.key.remoteJid;
  const pushName = msg.pushName || 'desconocido';

  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    '';

  console.log(`\n📩 [${pushName}] JID=${jid}`);
  console.log(`   Texto: "${text}"`);

  if (!text) return;
  if (!jid) return;
  if (jid.endsWith('@g.us')) return;
  if (jid === 'status@broadcast') return;

  const isPrivate = jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid');
  if (!isPrivate) return;

  const ownerCheck = isOwner(jid);
  console.log(`   ¿Es owner? ${ownerCheck ? '✅ SÍ' : '❌ NO'}`);

  if (!ownerCheck) return;

  // ---------- Comandos ----------
  const lower = text.trim().toLowerCase();

  if (lower === '!ping') {
    await handlePing(jid);
    return;
  }

  if (lower === '!help' || lower === '!ayuda') {
    await humanDelay();
    await sendText(
      jid,
      `🤖 *Athena Bot* — Comandos:

📅 *Académico*
!hoy → Clases de hoy
!mañana → Clases de mañana
!semana → Semana completa
!próxima → Siguiente clase

📊 *Sistema*
!ping → Estado de los 4 LLMs
!stats → Estadísticas de memoria
!reset → Borra historial
!help → Esta ayuda`
    );
    return;
  }

  if (lower === '!stats') {
    await humanDelay();
    const s = getStats(jid);
    await sendText(
      jid,
      `📊 *Estadísticas*

💬 Mensajes: ${s.messages}
🧠 Hechos guardados: ${s.facts}
📝 Tareas pendientes: ${s.pendingTasks}`
    );
    return;
  }

  if (lower === '!reset') {
    await humanDelay();
    const n = clearHistory(jid);
    await sendText(jid, `🧹 Borrados ${n} mensajes del historial.`);
    return;
  }

  // ---------- Comandos académicos ----------
  if (lower === '!hoy') {
    await humanDelay();
    const classes = getToday();
    if (classes.length === 0) {
      await sendText(jid, '🎉 Hoy no tienes clases. ¡Descansa!');
    } else {
      const lines = classes.map(
        (c) => `⏰ *${c.start} - ${c.end}*\n📚 ${c.course.name}\n👨‍🏫 ${c.course.teacher}`
      );
      await sendText(jid, `📅 *Clases de hoy*\n\n${lines.join('\n\n')}`);
    }
    return;
  }

  if (lower === '!mañana' || lower === '!manana') {
    await humanDelay();
    const classes = getTomorrow();
    if (classes.length === 0) {
      await sendText(jid, '🎉 Mañana no tienes clases.');
    } else {
      const lines = classes.map(
        (c) => `⏰ *${c.start} - ${c.end}*\n📚 ${c.course.name}\n👨‍🏫 ${c.course.teacher}`
      );
      await sendText(jid, `📅 *Clases de mañana*\n\n${lines.join('\n\n')}`);
    }
    return;
  }

  if (lower === '!semana') {
    await humanDelay();
    const week = getWeek();
    const lines = week.map((d) => {
      if (d.classes.length === 0) return `*${d.dayLabel}* — sin clases`;
      const items = d.classes
        .map((c) => `  ${c.start}-${c.end} · ${c.course.short}`)
        .join('\n');
      return `*${d.dayLabel}*\n${items}`;
    });
    await sendText(jid, `📅 *Semana académica*\n\n${lines.join('\n\n')}`);
    return;
  }

  if (lower === '!proxima' || lower === '!próxima') {
    await humanDelay();
    const next = getNextClass();
    if (!next) {
      await sendText(jid, 'No hay clases próximas.');
    } else {
      const when =
        next.when === 'hoy' ? 'Hoy' : next.when === 'mañana' ? 'Mañana' : next.when;
      await sendText(
        jid,
        `📌 *Próxima clase*\n\n${when}\n⏰ ${next.start} - ${next.end}\n📚 ${next.course.name}\n👨‍🏫 ${next.course.teacher}`
      );
    }
    return;
  }

  // ---------- LLM normal ----------
  let preferred;
  let userText = text;
  const m = text.match(/^!(groq|gemini|nvidia|openrouter)\s+(.*)$/i);
  if (m) {
    preferred = m[1].toLowerCase();
    userText = m[2];
  }

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

    saveMessage(jid, 'assistant', result.text, {
      provider: result.provider,
      model: result.model,
    });

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

// --- Arranque ---
(async () => {
  try {
    console.log('\n🚀 Iniciando Athena Bot...\n');
    await startWhatsApp(handleMessage);
  } catch (err) {
    console.error('❌ Error fatal al arrancar:', err);
    process.exit(1);
  }
})();

process.on('SIGINT', () => {
  console.log('\n👋 Cerrando Athena Bot...');
  process.exit(0);
});

// --- Servidor HTTP mínimo para healthcheck (Render + UptimeRobot) ---
import { createServer } from 'http';

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