import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

console.log('🔍 Diagnóstico de Supabase\n');

if (!URL || !KEY) {
  console.log('❌ Faltan SUPABASE_URL o SUPABASE_ANON_KEY en .env');
  process.exit(1);
}

console.log('📋 URL:', URL);
console.log('📋 Key empieza con:', KEY.slice(0, 20) + '...');
console.log(`📋 Key length: ${KEY.length}\n`);

const supabase = createClient(URL, KEY);

// ---------- 1. Leer ----------
console.log('1️⃣  Probando SELECT...');
const { data: readData, error: readErr } = await supabase
  .from('baileys_auth')
  .select('id')
  .limit(5);

if (readErr) {
  console.error('❌ SELECT falló:', readErr.message);
} else {
  console.log(`✅ SELECT ok. Filas actuales: ${readData.length}`);
  if (readData.length > 0) {
    console.log('   IDs:', readData.map(r => r.id).join(', '));
  }
}

// ---------- 2. Escribir UN registro de prueba ----------
console.log('\n2️⃣  Probando INSERT (upsert)...');
const testId = `test-${Date.now()}`;
const testData = { foo: 'bar', n: 42, ts: new Date().toISOString() };

const { error: writeErr } = await supabase
  .from('baileys_auth')
  .upsert(
    { id: testId, data: testData, updated_at: new Date().toISOString() },
    { onConflict: 'id' }
  );

if (writeErr) {
  console.error('❌ INSERT falló:', writeErr.message);
  console.error('   Detalle:', JSON.stringify(writeErr, null, 2));
} else {
  console.log(`✅ INSERT ok. Escribí: ${testId}`);
}

// ---------- 3. Verificar que se guardó ----------
console.log('\n3️⃣  Verificando que el registro existe...');
const { data: verifyData, error: verifyErr } = await supabase
  .from('baileys_auth')
  .select('id, data, updated_at')
  .eq('id', testId)
  .maybeSingle();

if (verifyErr) {
  console.error('❌ SELECT verificación falló:', verifyErr.message);
} else if (!verifyData) {
  console.error('❌ ¡El registro NO se guardó!');
} else {
  console.log(`✅ Confirmado. data = ${JSON.stringify(verifyData.data)}`);
}

// ---------- 4. Limpiar ----------
console.log('\n4️⃣  Limpiando registro de prueba...');
const { error: delErr } = await supabase
  .from('baileys_auth')
  .delete()
  .eq('id', testId);

if (delErr) {
  console.error('❌ DELETE falló:', delErr.message);
} else {
  console.log('✅ Limpieza ok');
}

// ---------- 5. Conteo final ----------
console.log('\n5️⃣  Conteo final:');
const { count } = await supabase
  .from('baileys_auth')
  .select('*', { count: 'exact', head: true });

console.log(`   Total de filas: ${count}`);

console.log('\n🏁 Diagnóstico completo');
process.exit(0);