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

  const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${msg}`);

  try {
    log('🔍 Paso 1/6: Cargando AuthState de Supabase...');
    const { state, saveCreds } = await useSupabaseAuthState();
    log('✅ Paso 1/6 completo: AuthState cargado');

    log('🔍 Paso 2/6: Consultando versión de Baileys...');
    const { version } = await fetchLatestBaileysVersion();
    log(`✅ Paso 2/6 completo: v${version.join('.')}`);

    log('🔍 Paso 3/6: Creando socket Baileys...');
    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      logger: pino({ level: 'warn' }), // 'warn' para ver errores internos de Baileys
      browser: Browsers.macOS('Desktop'),
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      markOnlineOnConnect: true,
      getMessage: async () => undefined,
    });
    log('✅ Paso 3/6 completo: socket creado');

    log('🔍 Paso 4/6: Registrando creds.update...');
    sock.ev.on('creds.update', () => {
      console.log('\n🔔 [EVENT] creds.update disparado por Baileys');
      saveCreds();
    });
    log('✅ Paso 4/6 completo');

    log('🔍 Paso 5/6: Registrando connection.update...');
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
    log('✅ Paso 5/6 completo');

    log('🔍 Paso 6/6: Registrando messages.upsert...');
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

        if (type === 'append') {
          console.log('   ⏭️  Ignorado (mensaje histórico)');
          continue;
        }

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
    log('✅ Paso 6/6 completo');

    log('🎉 startWhatsApp terminado — retornando socket');
    return sock;
  } catch (err) {
    isStarting = false;
    logger.error({ err }, '❌ Error iniciando WhatsApp');
    console.error('❌ STACK:', err.stack);
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
 */
export async function sendAudio(jid, audioBuffer) {
  if (!sock) throw new Error('Cliente WhatsApp no inicializado');
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error('Buffer de audio vacío');
  }

  return sock.sendMessage(jid, {
    audio: audioBuffer,
    mimetype: 'audio/ogg; codecs=opus',
    ptt: true,
  });
}

export function getSocket() {
  return sock;
}