/**
 * Parser de sílabos — Detecta y extrae temas semanales de un PDF.
 *
 * Flujo:
 *   1. Recibe el texto ya extraído del PDF
 *   2. Usa el LLM para detectar si es un sílabo
 *   3. Extrae metadatos (curso, docente, semanas)
 *   4. Devuelve un objeto compatible con syllabus.json
 */

import { askLLM } from '../llm/router.js';

const DETECTION_PROMPT = `Analiza el siguiente texto y determina si es un SÍLABO académico (documento con contenido semanal de un curso).

Responde SOLO con JSON válido con esta estructura:
{
  "esSilabo": true | false,
  "cursoNombre": "nombre completo del curso o null",
  "docente": "nombre del docente o null",
  "periodo": "periodo académico si aparece o null",
  "totalSemanas": número,
  "semanas": [
    { "semana": 1, "tema": "tema de la semana 1" },
    { "semana": 2, "tema": "..." }
  ]
}

REGLAS:
- "esSilabo" es true solo si tiene contenido distribuido por semanas (al menos 10 semanas)
- "cursoNombre" debe ser el nombre oficial del curso (NO la carrera ni la institución)
- "docente" es el profesor que dicta el curso
- Las semanas deben ser 15-18 típicamente
- El "tema" debe ser conciso (máx 200 caracteres)
- Si el texto NO es un sílabo, devuelve { "esSilabo": false } y nada más

TEXTO A ANALIZAR:
`;

function parseJSON(text) {
  let clean = (text || '').trim();
  clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, '');
  clean = clean.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();

  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('El LLM no devolvió JSON válido');

  return JSON.parse(clean.slice(start, end + 1));
}

/**
 * Detecta si un texto es un sílabo y extrae sus temas.
 * @param {string} text - Texto extraído del PDF
 * @returns {Promise<{esSilabo:boolean, cursoNombre?:string, docente?:string, periodo?:string, semanas?:Array}>}
 */
export async function parseSyllabus(text) {
  if (!text || text.length < 200) {
    return { esSilabo: false, reason: 'texto muy corto' };
  }

  // Cortamos el texto para no exceder límites
  const sample = text.slice(0, 12000);

  const messages = [
    { role: 'system', content: 'Eres un analista académico. Respondes SIEMPRE en JSON válido, sin markdown.' },
    { role: 'user', content: DETECTION_PROMPT + sample },
  ];

  try {
    const r = await askLLM(messages, {
      preferred: 'groq',
      jsonMode: true,
      maxTokens: 4000,
      temperature: 0.2,
    });
    const data = parseJSON(r.text);

    if (!data.esSilabo) {
      return { esSilabo: false };
    }

    if (!Array.isArray(data.semanas) || data.semanas.length < 10) {
      return { esSilabo: false, reason: 'pocas semanas detectadas' };
    }

    console.log(`   📚 Sílabo detectado: ${data.cursoNombre}`);
    console.log(`   👨‍🏫 Docente: ${data.docente}`);
    console.log(`   📊 Semanas: ${data.semanas.length}`);

    return {
      esSilabo: true,
      cursoNombre: data.cursoNombre,
      docente: data.docente,
      periodo: data.periodo,
      semanas: data.semanas,
    };
  } catch (err) {
    console.warn('   ⚠️  Error analizando sílabo:', err.message);
    return { esSilabo: false, reason: err.message };
  }
}

/**
 * Convierte el resultado del parser al formato del syllabus.json
 * (courseKey + topics con strings).
 *
 * @param {object} parsed - Resultado de parseSyllabus
 * @param {string} courseKey - Clave del curso en syllabus.json
 * @returns {object} - { name, topics: { "1": { topic }, ... } }
 */
export function convertToSyllabusFormat(parsed, courseKey) {
  const topics = {};
  for (const s of parsed.semanas) {
    topics[String(s.semana)] = { topic: s.tema };
  }
  return {
    name: parsed.cursoNombre || courseKey,
    topics,
  };
}