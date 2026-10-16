/**
 * Mermaid Generator v3.2 — flowchart TD + límite de tamaño + retry
 *
 * Fix v3.2:
 *   - v3.1: eliminado mindmap (rompía sintaxis)
 *   - v3.2: límite de 7000 chars (mermaid.ink rechaza URLs muy largas)
 *          + reduce maxTokens a 2500
 *          + si excede, se trunca al último classDef completo
 */

import axios from 'axios';
import { askLLM } from '../llm/router.js';

const MERMAID_INK_BASE = 'https://mermaid.ink/img/';
const MAX_CODE_CHARS = 6500; // límite seguro antes de base64

const SYSTEM_PROMPT = `Eres un experto en Mermaid.js que genera MAPAS CONCEPTUALES PROFUNDOS para estudiantes universitarios peruanos.

## REGLA CRÍTICA

SIEMPRE usa \`flowchart TD\`. NUNCA uses \`mindmap\`, \`graph\`, ni \`graph TD\`.
Razón: \`mindmap\` NO permite node IDs (N0[Texto]) ni classDef, y se rompe al renderizar.

## REGLAS DE FORMATO

1. Responde SOLO con el código Mermaid. Sin \`\`\`mermaid, sin \`\`\`, sin texto extra.
2. Etiquetas en ESPAÑOL (2-5 palabras), SIN tildes, SIN paréntesis, SIN comillas.
3. Cada nodo se ve así: \`A[Texto]:::nivelN\`

## ESTRUCTURA

- 1 nodo raíz (nivel1)
- 4-5 ramas principales (nivel2)
- Cada rama con 3-4 sub-nodos (nivel3)
- Algunos nivel3 con 1-2 hijos (nivel4)
- TOTAL: 30-45 nodos (no más)
- 4 niveles de profundidad

⚠️ IMPORTANTE: NO generes más de 45 nodos. Mapas muy grandes no renderizan.

## EJEMPLO COMPLETO (imita este formato EXACTO)

%%{init: {'theme':'base', 'themeVariables': {'primaryColor':'#e3f2fd','primaryTextColor':'#0d47a1','primaryBorderColor':'#1976d2','lineColor':'#546e7a','fontSize':'16px'}}}%%
flowchart TD
    NIC16[NIC 16 PROPIEDAD PLANTA EQUIPO]:::nivel1

    NIC16 --> ALC[Alcance]:::nivel2
    NIC16 --> REC[Reconocimiento]:::nivel2
    NIC16 --> MED[Medicion]:::nivel2
    NIC16 --> DEP[Depreciacion]:::nivel2

    ALC --> A1[Entidades publicas]:::nivel3
    ALC --> A2[Entidades privadas]:::nivel3
    A1 --> A1a[Gobiernos locales]:::nivel4
    A2 --> A2a[Empresas comerciales]:::nivel4

    REC --> R1[Al costo inicial]:::nivel3
    REC --> R2[Incluye flete]:::nivel3
    R1 --> R1a[Precio de compra]:::nivel4
    R2 --> R2a[Instalacion]:::nivel4

    MED --> M1[Modelo costo]:::nivel3
    MED --> M2[Modelo revaluacion]:::nivel3
    M1 --> M1a[Costo menos depreciacion]:::nivel4
    M2 --> M2a[Valor razonable]:::nivel4

    DEP --> D1[Metodo lineal]:::nivel3
    DEP --> D2[Saldo decreciente]:::nivel3
    D1 --> D1a[Vida util uniforme]:::nivel4
    D2 --> D2a[Mayor al inicio]:::nivel4

    classDef nivel1 fill:#0d47a1,stroke:#062b63,color:#ffffff,font-weight:bold,font-size:18px
    classDef nivel2 fill:#1976d2,stroke:#0d47a1,color:#ffffff,font-size:15px
    classDef nivel3 fill:#bbdefb,stroke:#1976d2,color:#0d47a1,font-size:13px
    classDef nivel4 fill:#e3f2fd,stroke:#90caf9,color:#0d47a1,font-size:11px

## VALIDACIÓN

Antes de responder, verifica:
- ¿Empieza con flowchart TD? ✅
- ¿Tiene entre 30 y 45 nodos? ✅
- ¿Tiene al menos 3 niveles? ✅
- ¿Termina con las 4 líneas classDef? ✅

Si algo falla, ARREGLA antes de responder.`;

function validateMermaid(code) {
  if (!code || code.length < 150) return { ok: false, reason: 'muy corto' };

  if (!/flowchart\s+TD/i.test(code)) {
    return { ok: false, reason: 'no es flowchart TD' };
  }

  if (/^\s*mindmap/im.test(code)) {
    return { ok: false, reason: 'usa mindmap (prohibido)' };
  }

  const nodeCount = (code.match(/:::nivel\d/g) || []).length;
  const levels = new Set((code.match(/nivel\d/g) || [])).size;

  if (nodeCount < 15) return { ok: false, reason: `solo ${nodeCount} nodos` };
  if (levels < 3) return { ok: false, reason: `solo ${levels} niveles` };

  return { ok: true, nodeCount, levels };
}

/* ============================================================
 *  Truncar código si es demasiado largo (evita 414)
 *  Corta en el último nodo completo antes del límite y
 *  siempre preserva los classDef finales.
 * ============================================================ */
function truncateCode(code) {
  if (code.length <= MAX_CODE_CHARS) return code;

  console.log(`   ✂️  Código muy largo (${code.length} chars), truncando a ${MAX_CODE_CHARS}...`);

  // Extraer las líneas classDef (siempre van al final)
  const classDefLines = code.match(/^\s*classDef\s+nivel\d+.*$/gm) || [];
  const initLine = (code.match(/^%%\{init.*%%$/m) || [''])[0];
  const firstLine = 'flowchart TD';

  // Cortar el cuerpo antes del primer classDef
  const bodyEnd = code.search(/\n\s*classDef\s+nivel\d+/);
  let body = bodyEnd > 0 ? code.slice(0, bodyEnd) : code;

  // Si el body ya es corto, dejarlo
  if (body.length > MAX_CODE_CHARS - 800) {
    // Truncar por líneas completas (no cortar a mitad de un nodo)
    const lines = body.split('\n');
    let acc = lines[0] + '\n' + lines[1] + '\n';
    for (let i = 2; i < lines.length; i++) {
      if (acc.length + lines[i].length > MAX_CODE_CHARS - 800) break;
      acc += lines[i] + '\n';
    }
    body = acc;
  }

  return [body.trim(), ...classDefLines].join('\n');
}

async function generateMermaidSyntax(userRequest, contextText, provider = 'groq') {
  const userContent = contextText
    ? `Genera un MAPA CONCEPTUAL (flowchart TD) para: "${userRequest}"

Basate en este contenido:

${contextText.slice(0, 3500)}

Recuerda: flowchart TD, ENTRE 30 y 45 nodos, MINIMO 3 niveles.`
    : `Genera un MAPA CONCEPTUAL (flowchart TD) para: "${userRequest}"

Recuerda: flowchart TD, ENTRE 30 y 45 nodos, MINIMO 3 niveles. NO más de 45 nodos.`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  console.log(`   🧠 Generando sintaxis Mermaid (flowchart TD) con ${provider}...`);
  const result = await askLLM(messages, {
    preferred: provider,
    maxTokens: 2600,  // ← reducido de 4000 a 2600
    temperature: 0.35,
  });

  let code = result.text.trim();
  code = code.replace(/^```mermaid\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  code = truncateCode(code);

  console.log(`   📊 Sintaxis: ${code.length} chars, ${result.provider}`);
  return { code, provider: result.provider };
}

async function renderMermaidToImage(mermaidCode) {
  const utf8Bytes = Buffer.from(mermaidCode, 'utf8');
  const base64 = utf8Bytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const params = new URLSearchParams({
    type: 'png',
    bgColor: 'FFFFFF',
    width: '2400',
    scale: '2',
  });

  const url = `${MERMAID_INK_BASE}${base64}?${params.toString()}`;
  console.log(`   🎨 Renderizando (URL: ${url.length} chars)...`);

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 40000,
    headers: { 'User-Agent': 'AthenaBot/1.0' },
  });

  const buffer = Buffer.from(response.data);
  if (!buffer || buffer.length < 500) {
    throw new Error('Diagrama vacío');
  }

  console.log(`   ✅ Render OK (${(buffer.length / 1024).toFixed(1)} KB)`);
  return buffer;
}

export async function generateMermaidDiagram(userRequest, contextText = '') {
  if (!userRequest || !userRequest.trim()) {
    throw new Error('La petición está vacía');
  }

  let bestCode = null;
  let bestStats = { ok: false, nodeCount: 0, levels: 0 };

  try {
    const { code } = await generateMermaidSyntax(userRequest, contextText, 'groq');
    const v = validateMermaid(code);
    console.log(`   🔍 Validación: ${v.ok ? '✅' : '⚠️'} ${v.reason || ''} (${v.nodeCount} nodos, ${v.levels} niveles)`);
    bestCode = code;
    bestStats = v;
  } catch (err) {
    console.warn('   ⚠️  Groq falló:', err.message);
  }

  if (!bestStats.ok) {
    try {
      console.log(`   🔄 Reintentando con NVIDIA (${bestStats.reason || 'pobre'})...`);
      const { code } = await generateMermaidSyntax(userRequest, contextText, 'nvidia');
      const v = validateMermaid(code);
      console.log(`   🔍 Validación NVIDIA: ${v.ok ? '✅' : '⚠️'} (${v.nodeCount} nodos, ${v.levels} niveles)`);
      if (v.ok || v.nodeCount > bestStats.nodeCount) {
        bestCode = code;
        bestStats = v;
      }
    } catch (err) {
      console.warn('   ⚠️  NVIDIA falló:', err.message);
    }
  }

  if (!bestCode) throw new Error('No se pudo generar código Mermaid');

  const finalCheck = validateMermaid(bestCode);
  if (!finalCheck.ok) {
    throw new Error(`Código inválido: ${finalCheck.reason}`);
  }

  console.log(`   📊 Final: ${bestStats.nodeCount} nodos, ${bestStats.levels} niveles, ${bestCode.length} chars`);

  try {
    const buffer = await renderMermaidToImage(bestCode);
    return { buffer, code: bestCode };
  } catch (err) {
    console.error(`   ❌ Error render: ${err.message}`);
    throw new Error(`No se pudo renderizar. Intenta con otro tema.`);
  }
}