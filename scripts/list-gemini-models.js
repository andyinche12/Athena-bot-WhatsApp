import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error('❌ GEMINI_API_KEY no está en .env');
  process.exit(1);
}

console.log('🔍 Listando modelos disponibles...\n');

const ai = new GoogleGenAI({ apiKey });

try {
  const response = await ai.models.list();
  const models = [];
  for await (const m of response) {
    models.push(m.name);
  }

  console.log(`✅ ${models.length} modelos disponibles:\n`);
  models.sort().forEach((name) => console.log(`   • ${name}`));
} catch (err) {
  console.error('❌ Error:', err.message);
}