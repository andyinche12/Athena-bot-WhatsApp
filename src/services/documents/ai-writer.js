/**
 * AI Writer v3.2 — Redacción de contenido para Word/PDF/Excel/PPT.
 *
 * v3.2:
 *   - buildImprovePrompt detecta cantidad exacta de slides/páginas/filas
 *   - "15 slides" / "más diapositivas" / "menos páginas" → funciona
 *   - PPT con coverImagePrompt + contentImages (portada + 2 contenido)
 *   - Export aiWrite como named export (fix del bug "aiWrite is not a function")
 */

import { askLLM } from '../llm/router.js';

const BASE_RULES = {
  word: `Reglas generales:
- Español formal y técnico
- Contexto peruano, contable/financiero
- Cita normativa peruana si aplica (NIA, NIIF, SUNAT, SBS)
- Cada párrafo debe tener al menos 4-6 oraciones completas`,

  pdf: `Reglas generales:
- Español formal y técnico
- Contexto peruano, contable/financiero
- Cada párrafo debe tener al menos 4-6 oraciones completas`,

  excel: `Reglas generales:
- Encabezados cortos (2-4 palabras), en español
- Datos realistas con sentido contable/financiero peruano
- Números, montos, porcentajes, fechas verosímiles
- Usa fórmulas reales cuando aplique (=SUM, =PRODUCT, =AVERAGE)`,

  ppt: `Reglas generales:
- 3-5 bullets por slide
- Bullets concisos (máx 15 palabras cada uno)
- Estructura: intro, desarrollo, conclusión
- Prompts de imagen en inglés, visuales, sin texto, máx 100 chars`,
};

function buildStructure(tipo, mode = 'normal') {
  if (tipo === 'word' || tipo === 'pdf') {
    if (mode === 'expand') {
      return `{
  "title": "Título formal del documento",
  "sections": [
    { "heading": "1. Introducción", "paragraphs": ["Párrafo largo 1...", "Párrafo largo 2...", "Párrafo largo 3..."] },
    { "heading": "2. Marco Teórico", "paragraphs": ["...", "...", "..."] },
    { "heading": "3. Desarrollo", "paragraphs": ["...", "...", "..."] },
    { "heading": "4. Análisis", "paragraphs": ["...", "...", "..."] },
    { "heading": "5. Caso Práctico", "paragraphs": ["...", "...", "..."] },
    { "heading": "6. Conclusiones", "paragraphs": ["...", "...", "..."] }
  ]
}`;
    }
    if (mode === 'shrink') {
      return `{
  "title": "Título formal del documento",
  "sections": [
    { "heading": "1. Introducción", "paragraphs": ["Párrafo conciso..."] },
    { "heading": "2. Desarrollo", "paragraphs": ["Párrafo conciso..."] },
    { "heading": "3. Conclusiones", "paragraphs": ["Párrafo conciso..."] }
  ]
}`;
    }
    return `{
  "title": "Título formal del documento",
  "sections": [
    { "heading": "1. Introducción", "paragraphs": ["Párrafo 1...", "Párrafo 2..."] },
    { "heading": "2. Marco Teórico", "paragraphs": ["...", "..."] },
    { "heading": "3. Desarrollo", "paragraphs": ["...", "..."] },
    { "heading": "4. Conclusiones", "paragraphs": ["...", "..."] }
  ]
}`;
  }

  if (tipo === 'excel') {
    if (mode === 'expand') {
      return `{
  "title": "Título de la tabla",
  "headers": ["Concepto", "Cantidad", "Precio S/", "Subtotal S/"],
  "rows": [
    ["Producto 1", 10, 25.50, "=B2*C2"],
    ["Producto 2", 5, 18.00, "=B3*C3"],
    ["Producto 3", 8, 12.75, "=B4*C4"],
    ["TOTAL", "=SUM(B2:B4)", "", "=SUM(D2:D4)"]
  ]
}

⚠️ REGLAS ESTRICTAS PARA EXCEL:
- MÁXIMO 4 columnas. NUNCA más.
- Headers cortos (2-4 palabras)
- 15-25 filas de datos antes de los totales
- Fórmulas REALES: "=B2*C2", "=SUM(B2:B10)", "=AVERAGE(B2:B10)"
- fila 1 = headers, datos desde fila 2. Columna A, B, C, D...
- Montos SIN "S/" dentro del número
- Agrega fila de TOTAL al final con =SUM`;
    }
    return `{
  "title": "Título de la tabla",
  "headers": ["Concepto", "Cantidad", "Precio S/", "Total S/"],
  "rows": [
    ["Item 1", 10, 25.50, "=B2*C2"],
    ["Item 2", 5, 18.00, "=B3*C3"],
    ["Item 3", 8, 12.75, "=B4*C4"],
    ["TOTAL", "=SUM(B2:B4)", "", "=SUM(D2:D4)"]
  ]
}

⚠️ REGLAS ESTRICTAS PARA EXCEL:
- MÁXIMO 4 columnas. NUNCA más.
- Headers cortos (2-4 palabras)
- 8-15 filas de datos antes de los totales
- Fórmulas REALES: "=B2*C2", "=SUM(B2:B10)"
- fila 1 = headers, datos desde fila 2. Columna A, B, C, D...
- Agrega SIEMPRE una fila de TOTAL al final`;
  }

  if (tipo === 'ppt') {
    const slideExample = mode === 'expand'
      ? `"... 12-15 slides en total ..."`
      : `"... 6-10 slides en total ..."`;

    return `{
  "title": "Título de la presentación",
  "coverImagePrompt": "english prompt for the cover image, cinematic, professional, no text",
  "contentImages": [
    { "slideIndex": 1, "prompt": "english prompt for slide index 1" },
    { "slideIndex": 4, "prompt": "english prompt for slide index 4" }
  ],
  "slides": [
    { "title": "Slide 1", "bullets": ["...", "...", "..."] },
    { "title": "Slide 2", "bullets": ["...", "...", "..."] },
    ${slideExample}
  ]
}

⚠️ REGLAS DEL PRESENTATION:
- coverImagePrompt: en INGLÉS, máximo 100 chars, sin texto en la imagen
- contentImages: EXACTAMENTE 2 items con slideIndex que apunten a slides del CONTENIDO
- Cada slide: título corto (2-5 palabras) + 3-5 bullets
- Bullets máximo 15 palabras cada uno`;
  }
}

function detectFeedbackMode(feedback) {
  if (!feedback) return 'normal';
  const f = feedback.toLowerCase();

  const expandKeys = [
    'más largo', 'mas largo', 'amplía', 'amplia', 'ampliar', 'expande', 'expandir',
    'extiende', 'extender', 'más extenso', 'mas extenso', 'más detalle', 'mas detalle',
    'más información', 'mas informacion', 'desarrolla más', 'desarrolla mas',
    'agrega más', 'agrega mas', 'más secciones', 'mas secciones', 'profundiza',
    'más contenido', 'mas contenido', 'más párrafos', 'mas parrafos',
    'alarga', 'extensión', 'extension', 'detállalo más', 'detallalo mas',
    'más completo', 'mas completo', 'completa más', 'completa mas',
  ];

  const shrinkKeys = [
    'más corto', 'mas corto', 'acorta', 'acortar', 'resume', 'resumir',
    'síntesis', 'sintesis', 'breve', 'conciso', 'más breve', 'mas breve',
    'reduce', 'reducir', 'menos páginas', 'menos paginas', 'más simple', 'mas simple',
  ];

  if (expandKeys.some((k) => f.includes(k))) return 'expand';
  if (shrinkKeys.some((k) => f.includes(k))) return 'shrink';
  return 'normal';
}

function detectCantidadFeedback(feedback, tipo) {
  const f = feedback.toLowerCase();

  const matchExacto = f.match(/(\d{1,3})\s*(slides?|diapositivas?|p[áa]ginas?|filas?|secciones?)/i);
  if (matchExacto) {
    const num = parseInt(matchExacto[1], 10);
    if (num >= 1 && num <= 100) {
      return { tipo: 'exacto', valor: num };
    }
  }

  if (/m[áa]s\s+(slides?|diapositivas?|p[áa]ginas?|secciones?|filas?)/i.test(f)) {
    return { tipo: 'mas' };
  }

  if (/menos\s+(slides?|diapositivas?|p[áa]ginas?|secciones?|filas?)/i.test(f)) {
    return { tipo: 'menos' };
  }

  return null;
}

function buildCreatePrompt(tipo, tema, mode = 'normal') {
  const structure = buildStructure(tipo, mode);
  const rules = BASE_RULES[tipo] || '';

  const lengthRule =
    mode === 'expand'
      ? `EXTENSIÓN OBLIGATORIA: El documento debe ser EXTENSO y PROFUNDO.
- Mínimo 6 secciones (o slides/filas según formato).
- Cada sección con AL MENOS 3 párrafos.
- Cada párrafo con AL MENOS 6 oraciones completas.
- Incluye ejemplos numéricos, casos prácticos, tablas conceptuales.
- NO resumas. NO omitas detalles.`
      : mode === 'shrink'
      ? `EXTENSIÓN OBLIGATORIA: El documento debe ser CONCISO pero completo.
- Máximo 3 secciones (o slides/filas según formato).
- Cada sección con UN solo párrafo sustancioso.
- Ve directo al punto, sin relleno.`
      : `EXTENSIÓN:
- 3-5 secciones (o slides/filas según formato).
- 2-4 párrafos por sección.
- Cada párrafo con AL MENOS 4-5 oraciones completas.`;

  const name = {
    word: 'INFORME COMPLETO',
    pdf: 'DOCUMENTO PDF FORMAL',
    excel: 'TABLA EXCEL',
    ppt: 'PRESENTACIÓN',
  }[tipo];

  return `Eres un redactor académico profesional peruano. Crea un ${name} sobre: "${tema}".

Responde SOLO con un JSON válido (sin markdown, sin texto extra) con esta estructura exacta:

${structure}

${rules}

${lengthRule}

NO uses bloques \`\`\`json. NO agregues explicaciones. SOLO el JSON.`;
}

function buildImprovePrompt(tipo, tema, feedback, previousData, mode) {
  const structure = buildStructure(tipo, mode);
  const rules = BASE_RULES[tipo] || '';
  const prevJson = JSON.stringify(previousData, null, 2);

  const cantidad = detectCantidadFeedback(feedback, tipo);

  const modeInstruction =
    mode === 'expand'
      ? `🎯 El usuario pidió EXPANDIR. Documento MÁS LARGO Y DETALLADO que el anterior.
- Aumenta secciones, párrafos y profundidad.
- Agrega ejemplos y casos prácticos que NO estaban.`
      : mode === 'shrink'
      ? `🎯 El usuario pidió ACORTAR. Documento MÁS CORTO que el anterior.
- Reduce secciones y párrafos. Directo al punto.`
      : `🎯 El usuario pidió MODIFICAR. Mantén la extensión similar pero aplica los cambios.`;

  let cantidadInstruction = '';
  if (cantidad && cantidad.tipo === 'exacto') {
    if (tipo === 'ppt') {
      cantidadInstruction = `\n📊 CANTIDAD EXACTA DE SLIDES: El array "slides" debe tener EXACTAMENTE ${cantidad.valor} elementos.`;
    } else if (tipo === 'excel') {
      cantidadInstruction = `\n📊 CANTIDAD EXACTA DE FILAS: El array "rows" debe tener EXACTAMENTE ${cantidad.valor} filas.`;
    } else {
      cantidadInstruction = `\n📄 CANTIDAD EXACTA DE SECCIONES: El array "sections" debe tener EXACTAMENTE ${cantidad.valor} secciones.`;
    }
  } else if (cantidad && cantidad.tipo === 'mas') {
    cantidadInstruction = `\n📊 AUMENTA la cantidad en 4-6 elementos más que el documento actual.`;
  } else if (cantidad && cantidad.tipo === 'menos') {
    cantidadInstruction = `\n📊 REDUCE la cantidad en 3-4 elementos del documento actual.`;
  }

  const name = {
    word: 'INFORME',
    pdf: 'DOCUMENTO PDF',
    excel: 'TABLA EXCEL',
    ppt: 'PRESENTACIÓN',
  }[tipo];

  return `Eres un redactor académico profesional peruano. Tienes un ${name} ya redactado y debes MEJORARLO.

📄 DOCUMENTO ACTUAL (JSON):
${prevJson}

📝 INSTRUCCIONES DEL USUARIO:
"${feedback}"

${modeInstruction}
${cantidadInstruction}

Responde SOLO con el JSON mejorado, con la MISMA estructura:

${structure}

${rules}

NO agregues explicaciones. SOLO el JSON.`;
}

function parseJSON(text) {
  let clean = (text || '').trim();

  clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, '');
  clean = clean.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  clean = clean.replace(/<reflection>[\s\S]*?<\/reflection>/gi, '');

  clean = clean.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '');
  clean = clean.trim();

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

export async function aiWrite(tipo, tema, feedback = null, previousData = null) {
  const mode = detectFeedbackMode(feedback);

  const userPrompt =
    feedback && previousData
      ? buildImprovePrompt(tipo, tema, feedback, previousData, mode)
      : buildCreatePrompt(tipo, tema, mode);

  const systemMsg =
    'Eres un asistente experto en redacción técnica contable peruana. ' +
    'Respondes SIEMPRE en JSON válido, sin explicaciones, sin markdown, ' +
    'sin bloques <think>, sin texto antes ni después del JSON.';

  const messages = [
    { role: 'system', content: systemMsg },
    { role: 'user', content: userPrompt },
  ];

  const maxTokens = mode === 'expand' ? 7000 : 4000;

  try {
    const r1 = await askLLM(messages, { preferred: 'groq', jsonMode: true, maxTokens, temperature: 0.5 });
    console.log(`   🧠 Redactado por ${r1.provider} (${r1.model}) [modo: ${mode}]`);
    return { data: parseJSON(r1.text), provider: r1.provider, model: r1.model };
  } catch (err) {
    console.warn('   ⚠️  Groq falló:', err.message);
  }

  try {
    const r2 = await askLLM(messages, { preferred: 'nvidia', jsonMode: true, maxTokens, temperature: 0.5 });
    console.log(`   🧠 Redactado por ${r2.provider} (${r2.model}) [modo: ${mode}]`);
    return { data: parseJSON(r2.text), provider: r2.provider, model: r2.model };
  } catch (err) {
    console.warn('   ⚠️  NVIDIA falló:', err.message);
  }

  const r3 = await askLLM(messages, { preferred: 'openrouter', jsonMode: true, maxTokens, temperature: 0.5 });
  console.log(`   🧠 Redactado por ${r3.provider} (${r3.model}) [modo: ${mode}]`);
  return { data: parseJSON(r3.text), provider: r3.provider, model: r3.model };
}

// Alias por si algún archivo lo importa como default
export default { aiWrite };