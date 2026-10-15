/**
 * AI Writer — usa el LLM para redactar el contenido de documentos
 * antes de convertirlos en Word/PDF/Excel/PPT.
 *
 * Cadena de intentos: Groq → NVIDIA → OpenRouter
 * (Groq es 15x más rápido; NVIDIA solo como fallback por si Groq falla)
 *
 * Soporta feedback opcional para regenerar con instrucciones del usuario.
 */

import { askLLM } from '../llm/router.js';

/* ============================================================
 *  Prompts por tipo de documento
 * ============================================================ */

const PROMPTS = {
  word: (tema) => `Eres un redactor académico profesional. Redacta un INFORME COMPLETO sobre: "${tema}".

Responde SOLO con un JSON válido (sin markdown, sin texto extra) con esta estructura exacta:

{
  "title": "Título formal del informe",
  "sections": [
    { "heading": "1. Introducción", "paragraphs": ["Párrafo 1...", "Párrafo 2..."] },
    { "heading": "2. Marco Teórico", "paragraphs": ["..."] },
    { "heading": "3. Desarrollo", "paragraphs": ["..."] },
    { "heading": "4. Conclusiones", "paragraphs": ["..."] }
  ]
}

Reglas:
- Español formal y técnico
- 3-5 secciones
- 2-4 párrafos por sección
- Mínimo 150 palabras por sección
- Contexto peruano, contable/financiero
- Cita normativa peruana si aplica (NIA, NIIF, SUNAT, SBS)`,

  pdf: (tema) => `Eres un redactor académico. Crea un DOCUMENTO PDF FORMAL sobre: "${tema}".

Responde SOLO con JSON válido:
{
  "title": "Título",
  "sections": [
    { "heading": "Sección", "paragraphs": ["Párrafo 1...", "Párrafo 2..."] }
  ]
}

Reglas: formal, técnico, contexto peruano, 3-5 secciones, párrafos sustanciosos.`,

  excel: (tema) => `Eres un analista de datos. Diseña una TABLA EXCEL sobre: "${tema}".

Responde SOLO con JSON válido:
{
  "title": "Título de la tabla",
  "headers": ["Columna 1", "Columna 2", "Columna 3"],
  "rows": [
    ["dato", "dato", "dato"],
    ["dato", "dato", "dato"]
  ]
}

Reglas:
- Encabezados claros
- 8-15 filas de datos realistas
- Contexto contable/financiero peruano
- Números con sentido (montos, porcentajes, fechas)
- Si es comparativo, incluir totales al final`,

  ppt: (tema) => `Eres un diseñador de presentaciones. Crea SLIDES sobre: "${tema}".

Responde SOLO con JSON válido:
{
  "title": "Título de la presentación",
  "slides": [
    { "title": "Slide 1", "bullets": ["Punto 1", "Punto 2", "Punto 3"] },
    { "title": "Slide 2", "bullets": ["..."] }
  ]
}

Reglas:
- 6-10 slides
- 3-5 bullets por slide
- Bullets concisos (máx 15 palabras cada uno)
- Estructura: intro, desarrollo, conclusión
- Contexto peruano contable`,
};

/* ============================================================
 *  Parseo robusto de JSON
 *  Los modelos Nemotron emiten <think>...</think> antes del JSON.
 *  Los limpiamos antes de parsear.
 * ============================================================ */
function parseJSON(text) {
  let clean = (text || '').trim();

  // 1. Quitar bloques de razonamiento (Nemotron, DeepSeek-R, etc.)
  clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, '');
  clean = clean.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  clean = clean.replace(/<reflection>[\s\S]*?<\/reflection>/gi, '');

  // 2. Quitar bloques markdown ```json ... ```
  clean = clean.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '');
  clean = clean.trim();

  // 3. Ubicar el primer { y el último }
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) {
    console.error('   ⚠️  LLM sin JSON. Primeros 300 chars:', clean.slice(0, 300));
    throw new Error('El LLM no devolvió JSON válido');
  }

  const jsonStr = clean.slice(start, end + 1);

  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error('   ⚠️  JSON malformado. Primeros 300 chars:', jsonStr.slice(0, 300));
    throw new Error(`JSON malformado: ${err.message}`);
  }
}

/* ============================================================
 *  Writer principal
 *  Cadena: Groq → NVIDIA → OpenRouter
 *
 *  Retorna: { data, provider, model }
 *    - data: el JSON parseado (title + sections/rows/slides)
 *    - provider: 'groq' | 'nvidia' | 'openrouter'
 *    - model: string (el modelo específico que respondió)
 *
 *  @param {string} tipo - 'word' | 'pdf' | 'excel' | 'ppt'
 *  @param {string} tema - el tema del documento
 *  @param {string|null} feedback - instrucciones opcionales de mejora
 * ============================================================ */
export async function aiWrite(tipo, tema, feedback = null) {
  const promptFn = PROMPTS[tipo];
  if (!promptFn) throw new Error(`Tipo no soportado: ${tipo}`);

  const basePrompt = promptFn(tema);
  const userPrompt = feedback
    ? `${basePrompt}\n\n⚠️ INSTRUCCIONES ADICIONALES DEL USUARIO (prioridad alta):\n"${feedback}"\n\nAplica esas instrucciones al contenido, respetando la estructura JSON solicitada.`
    : basePrompt;

  const messages = [
    {
      role: 'system',
      content:
        'Eres un asistente experto en redacción técnica contable peruana. ' +
        'Respondes SIEMPRE en JSON válido, sin explicaciones, sin markdown, ' +
        'sin bloques <think>, sin texto antes ni después del JSON.',
    },
    { role: 'user', content: userPrompt },
  ];

  // ---------- 1º intento: Groq (rápido y confiable) ----------
  try {
    const r1 = await askLLM(messages, {
      preferred: 'groq',
      jsonMode: true,
      maxTokens: 4000,
      temperature: 0.5,
    });
    console.log(`   🧠 Redactado por ${r1.provider} (${r1.model})`);
    return {
      data: parseJSON(r1.text),
      provider: r1.provider,
      model: r1.model,
    };
  } catch (err) {
    console.warn('   ⚠️  Groq falló:', err.message);
  }

  // ---------- 2º intento: NVIDIA (calidad superior, más lento) ----------
  try {
    const r2 = await askLLM(messages, {
      preferred: 'nvidia',
      jsonMode: true,
      maxTokens: 4000,
      temperature: 0.5,
    });
    console.log(`   🧠 Redactado por ${r2.provider} (${r2.model})`);
    return {
      data: parseJSON(r2.text),
      provider: r2.provider,
      model: r2.model,
    };
  } catch (err) {
    console.warn('   ⚠️  NVIDIA falló:', err.message);
  }

  // ---------- 3º intento: OpenRouter (Nemotron Super free) ----------
  const r3 = await askLLM(messages, {
    preferred: 'openrouter',
    jsonMode: true,
    maxTokens: 4000,
    temperature: 0.5,
  });
  console.log(`   🧠 Redactado por ${r3.provider} (${r3.model})`);
  return {
    data: parseJSON(r3.text),
    provider: r3.provider,
    model: r3.model,
  };
}