// diagnostico.mjs
console.log('▶ 1. dotenv');
import 'dotenv/config';

console.log('▶ 2. env.js');
const { config } = await import('./src/config/env.js');
console.log('   SUPABASE_URL:', config.supabaseUrl ? 'OK' : '❌ FALTA');
console.log('   SUPABASE_ANON_KEY:', config.supabaseAnonKey ? 'OK' : '❌ FALTA');

console.log('▶ 3. schedule.json y syllabus.json');
await import('./src/syllabus/schedule.js');
await import('./src/syllabus/topics.js');
console.log('   JSONs cargados OK');

console.log('▶ 4. baileys (esto es lo que sospecho que cuelga)');
const t0 = Date.now();
await import('@whiskeysockets/baileys');
console.log(`   Baileys cargado en ${Date.now() - t0}ms`);

console.log('▶ 5. supabase-auth.js');
const { useSupabaseAuthState } = await import('./src/services/whatsapp/supabase-auth.js');
console.log('   Módulo cargado');

console.log('▶ 6. Llamando useSupabaseAuthState()...');
const t1 = Date.now();
const { state } = await useSupabaseAuthState();
console.log(`   ✅ AuthState OK en ${Date.now() - t1}ms`);
console.log('   creds.registered =', state.creds.registered);

console.log('▶ 7. FIN');
process.exit(0);