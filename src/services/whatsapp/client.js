import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { createClient } from '@supabase/supabase-js';
import { config } from '../../config/env.js';

const logger = pino({ level: config.logLevel });

// --- Cliente de Supabase ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --- Implementación de AuthState para Supabase ---
// Esta función reemplaza a 'useMultiFileAuthState' y guarda la sesión en la base de datos.
async function useSupabaseAuthState() {
  const readData = async (key) => {
    const { data, error } = await supabase
      .from('baileys_auth')
      .select('data')
      .eq('id', key)
      .single();
    if (error && error.code !== 'PGRST116') { // Ignorar el error 'no rows found'
      logger.error({ error, key }, 'Error leyendo de Supabase');
    }
    return data ? data.data : null;
  };

  const writeData = async (key, data) => {
    const { error } = await supabase
      .from('baileys_auth')
      .upsert({ id: key, data });
    if (error) {
      logger.error({ error, key }, 'Error escribiendo en Supabase');
    }
  };

  // Cargar credenciales y claves
  const creds = await readData('creds') || {};
  const keys = {
    get: async (type, ids) => {
      const result = {};
      for (const id of ids) {
        const key = `key-${type}-${id}`;
        result[id] = await readData(key);
      }
      return result;
    },
    set: async (data) => {
      for (const category in data) {
        for (const id in data[category]) {
          const value = data[category][id];
          const key = `key-${category}-${id}`;
          await writeData(key, value);
        }
      }
    },
  };

  return {
    state: { creds, keys },
    saveCreds: async () => {
      await writeData('creds', creds);
    },
  };
}

let sock = null;
let isStarting = false;

export async function startWhatsApp(onMessage) {
  if (isStarting) {
    logger.warn('⚠️ Ya hay una conexión en curso, ignorando llamada duplicada');
    return sock;
  }
  isStarting = true;

  try {
    // 👇 USAMOS NUESTRA NUEVA FUNCIÓN DE SUPABASE
    const { state, saveCreds } = await useSupabaseAuthState();
    const { version } = await fetchLatestBaileysVersion();

    logger.info(`📡 Baileys v${version.join('.')} | Usando sesión de Supabase`);

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

    // --- Conexión y QR (igual que antes) ---
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        console.log('\n' + '='.repeat(60));
        console.log('  📱 ESCANEA ESTE CÓDIGO QR CON TU WHATSAPP BUSINESS');
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
        logger.warn(`🔌 Conexión cerrada. Código: ${statusCode}. Reconectar: ${shouldReconnect}`);
        if (shouldReconnect) {
          logger.info('🔄 Reintentando en 5 segundos...');
          setTimeout(() => startWhatsApp(onMessage), 5000);
        } else {
          logger.error('❌ Sesión cerrada. Borra la tabla "baileys_auth" en Supabase y reinicia.');
        }
      }
    });

    console.log('🔔 [DEBUG] Listener messages.upsert registrado');
    sock.ev.on('messages.upsert', async (event) => {
      const { messages, type } = event;
      console.log(`\n🔔 [DEBUG] messages.upsert | type=${type} | count=${messages?.length || 0}`);
      if (!messages || messages.length === 0) return;
      for (const msg of messages) {
        const fromJid = msg.key?.remoteJid || 'desconocido';
        const fromMe = msg.key?.fromMe;
        const hasMessage = !!msg.message;
        const msgKeys = msg.message ? Object.keys(msg.message).join(',') : 'nada';
        console.log(`   📨 De: ${fromJid} | fromMe: ${fromMe} | contenido: [${msgKeys}]`);
        if (!hasMessage) continue;
        if (fromMe) {
          console.log('   ⏭️ Ignorado (es propio)');
          continue;
        }
        if (fromJid.endsWith('@g.us')) {
          console.log('   ⏭️ Ignorado (es grupo)');
          continue;
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