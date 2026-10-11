import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { config } from '../../config/env.js';

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
    // Por ahora usamos sesión LOCAL (archivos) siempre.
    // Más adelante migraremos a Supabase para producción.
    const { state, saveCreds } = await useMultiFileAuthState('./data/session');
    const { version } = await fetchLatestBaileysVersion();

    logger.info(`📡 Baileys v${version.join('.')} | Sesión local: ./data/session`);

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

    sock.ev.on('creds.update', saveCreds);

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
            '❌ Sesión cerrada. Borra ./data/session y reinicia para volver a escanear el QR.'
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

        // Ignorar si no tiene contenido
        if (!hasMessage) continue;

        // Ignorar mensajes propios
        if (fromMe) {
          console.log('   ⏭️  Ignorado (es propio)');
          continue;
        }

        // Ignorar grupos
        if (fromJid.endsWith('@g.us')) {
          console.log('   ⏭️  Ignorado (es grupo)');
          continue;
        }

        // 🛡️ Anti-duplicado: ignorar mensajes ya procesados
        if (msgId && processedIds.has(msgId)) {
          console.log('   ⏭️  Ignorado (ya procesado antes)');
          continue;
        }

        // Marcar como procesado
        if (msgId) {
          processedIds.add(msgId);
          // Limitar tamaño del Set (evitar crecer indefinidamente)
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

export async function sendText(jid, text) {
  if (!sock) throw new Error('Cliente WhatsApp no inicializado');
  return sock.sendMessage(jid, { text });
}

export function getSocket() {
  return sock;
}