import 'dotenv/config';
import OpenAI from 'openai';

const key = process.env.GROQ_API_KEY;

console.log('🔍 Diagnóstico de Groq\n');

if (!key) {
  console.log('❌ GROQ_API_KEY no está definida en .env');
  process.exit(1);
}

console.log(`📋 Clave detectada: ${key.slice(0, 12)}...${key.slice(-6)}`);
console.log(`📋 Longitud: ${key.length} caracteres`);
console.log(`📋 Prefijo correcto (gsk_): ${key.startsWith('gsk_') ? '✅' : '❌'}\n`);

const client = new OpenAI({
  apiKey: key,
  baseURL: 'https://api.groq.com/openai/v1',
});

// 1. Listar modelos disponibles
console.log('📡 Consultando modelos disponibles...\n');

try {
  const models = await client.models.list();
  const list = models.data.map((m) => m.id).sort();

  console.log(`✅ ${list.length} modelos disponibles:\n`);
  list.forEach((id) => console.log(`   • ${id}`));

  console.log('\n🎯 Buscando modelos útiles para Athena:');
  const useful = list.filter(
    (m) => m.includes('llama') || m.includes('mixtral') || m.includes('gemma')
  );
  useful.forEach((id) => console.log(`   ⭐ ${id}`));
} catch (err) {
  console.error('❌ Error listando modelos:');
  console.error('   Status:', err.status || 'sin status');
  console.error('   Mensaje:', err.message);
  if (err.status === 401) {
    console.error('\n💡 La clave es inválida o expiró.');
    console.error('   Ve a https://console.groq.com/keys y genera una nueva.');
  }
}