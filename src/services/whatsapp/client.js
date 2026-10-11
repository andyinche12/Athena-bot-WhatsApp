import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { config } from '../../config/env.js';
import { useSupabaseAuthState } from './supabase-auth.js';

const logger = pino({ level: config.logLevel });

let sock = null;
let isStarting = false;

export async function startWhatsApp(onMessage) {
  if (isStarting) {
    logger.warn('⚠️  Ya hay una conexión en curso, ignorando llamada duplicada');
    return sock;
  }
  isStarting = true;

  try {
    // 🔐 Sesión persistente en Supabase
    const { state, saveCreds } = await useSupabaseAuthState();
    const { version } = await fetchLatestBaileysVersion();

    logger.info(`📡 Baileys v${version.join('.')} | Sesión: Supabase`);

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: Browsers.macOS('Desktop'),
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      markOnlineOnConnect: true,
      getMessage: async () => undefined,
    });

    // 🔍 LOG: cuando Baileys dispara creds.update
    sock.ev.on('creds.update', () => {
      console.log('\n🔔 [EVENT] creds.update disparado por Baileys');
      saveCreds();
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n' + '='.repeat(60));
        console.log('  📱  ESCANEA ESTE CÓDIGO QR CON TU WHATSAPP BUSINESS');
        console.log('='.repeat(60) + '\n');
        qrcode.generate(qr, { small: true });
        console.log('\n  WhatsApp > Dispositivos vinculados > Vincular dispositivo');
        console.log('='.repeat(60) + '\n');
      }

      if (connection === 'open') {
        console.log('✅ Athena Bot conectado a WhatsApp');
        console.log(`   👤 Mi JID: ${jidNormalizedUser(sock.user?.id || '')}`);
        console.log(`   📱 Mi número: ${sock.user?.id?.split(':')[0]}`);
        isStarting = false;
      }

      if (connection === 'close') {
        isStarting = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.warn(
          `🔌 Conexión cerrada. Código: ${statusCode}. Reconectar: ${shouldReconnect}`
        );

        if (shouldReconnect) {
          logger.info('🔄 Reintentando en 5 segundos...');
          setTimeout(() => startWhatsApp(onMessage), 5000);
        } else {
          logger.error(
            '❌ Sesión cerrada. Borra la tabla "baileys_auth" en Supabase y reinicia.'
          );
        }
      }
    });

    console.log('🔔 [DEBUG] Listener messages.upsert registrado');

    // 🛡️ Anti-duplicado: Set en memoria de IDs ya procesados
    const processedIds = new Set();
    const MAX_CACHE = 500;

    sock.ev.on('messages.upsert', async (event) => {
      const { messages, type } = event;
      console.log(`\n🔔 [DEBUG] messages.upsert | type=${type} | count=${messages?.length || 0}`);

      if (!messages || messages.length === 0) return;

      for (const msg of messages) {
        const msgId = msg.key?.id;
        const fromJid = msg.key?.remoteJid || 'desconocido';
        const fromMe = msg.key?.fromMe;
        const hasMessage = !!msg.message;
        const msgKeys = msg.message ? Object.keys(msg.message).join(',') : 'nada';

        console.log(`   📨 De: ${fromJid} | fromMe: ${fromMe} | id: ${msgId} | contenido: [${msgKeys}]`);

        if (!hasMessage) continue;

        if (fromMe) {
          console.log('   ⏭️  Ignorado (es propio)');
          continue;
        }

        if (fromJid.endsWith('@g.us')) {
          console.log('   ⏭️  Ignorado (es grupo)');
          continue;
        }

        // 🆕 Ignorar mensajes históricos (type=append) — solo procesar nuevos
        if (type === 'append') {
          console.log('   ⏭️  Ignorado (mensaje histórico)');
          continue;
        }

        // 🛡️ Anti-duplicado
        if (msgId && processedIds.has(msgId)) {
          console.log('   ⏭️  Ignorado (ya procesado antes)');
          continue;
        }

        if (msgId) {
          processedIds.add(msgId);
          if (processedIds.size > MAX_CACHE) {
            const first = processedIds.values().next().value;
            processedIds.delete(first);
          }
        }

        try {
          await onMessage(sock, msg);
        } catch (err) {
          console.error('❌ Error procesando mensaje:', err.message);
          console.error(err.stack);
        }
      }
    });

    return sock;
  } catch (err) {
    isStarting = false;
    logger.error({ err }, '❌ Error iniciando WhatsApp');
    throw err;
  }
}

/**
 * Envía un mensaje de texto a un JID.
 */
export async function sendText(jid, text) {
  if (!sock) throw new Error('Cliente WhatsApp no inicializado');
  return sock.sendMessage(jid, { text });
}

/**
 * Envía una nota de voz (PTT) por WhatsApp.
 * @param {string} jid - Destinatario
 * @param {Buffer} audioBuffer - Buffer del audio en OGG/Opus
 */
export async function sendAudio(jid, audioBuffer) {
  if (!sock) throw new Error('Cliente WhatsApp no inicializado');
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error('Buffer de audio vacío');
  }

  return sock.sendMessage(jid, {
    audio: audioBuffer,
    mimetype: 'audio/ogg; codecs=opus',
    ptt: true, // Push-to-talk = nota de voz
  });
}

export function getSocket() {
  return sock;
}