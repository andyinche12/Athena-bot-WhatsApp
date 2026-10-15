import 'dotenv/config';
import makeWASocket, { fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { useSupabaseAuthState } from './src/services/whatsapp/supabase-auth.js';

async function test() {
  console.log('1. Loading auth state...');
  const { state, saveCreds } = await useSupabaseAuthState();
  console.log('   Auth state loaded');
  
  console.log('2. Fetching Baileys version...');
  const { version } = await fetchLatestBaileysVersion();
  console.log('   Version:', version.join('.'));
  
  console.log('3. Creating socket...');
  const sock = makeWASocket({
    version,
    auth: { creds: state.creds, keys: state.keys },
    printQRInTerminal: true,
    logger: { level: 'warn' },
    browser: ['Mac OS', 'Chrome', '1.0'],
    markOnlineOnConnect: true,
  });
  
  console.log('4. Socket created, waiting...');
  
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    console.log('   Event:', { connection, qr: !!qr, statusCode: lastDisconnect?.error?.output?.statusCode });
    if (qr) console.log('   QR CODE GENERATED!');
    if (connection === 'open') console.log('   CONNECTED! JID:', sock.user?.id);
    if (connection === 'close') console.log('   CLOSED:', lastDisconnect?.error);
  });
  
  sock.ev.on('creds.update', () => {
    console.log('   creds.update');
    saveCreds();
  });
  
  await new Promise(r => setTimeout(r, 30000));
  console.log('Done');
}

test();