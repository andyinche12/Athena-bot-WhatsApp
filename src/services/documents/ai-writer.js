/**
 * Mermaid Generator v3.1 — Diagramas SIEMPRE flowchart TD (nunca mindmap).
 *
 * Fix v3.1:
 *   - Eliminado "mindmap" del prompt (rompía la sintaxis)
 *   - SIEMPRE flowchart TD con node IDs + classDef
 *   - Validación estricta antes de renderizar
 */

import axios from 'axios';
import { askLLM } from '../llm/router.js';

const MERMAID_INK_BASE = 'https://mermaid.ink/img/';

const SYSTEM_PROMPT = `Eres un experto en Mermaid.js que genera MAPAS MENTALES Y CONCEPTUALES PROFUNDOS para estudiantes universitarios peruanos.

## REGLA CRÍTICA (LA MÁS IMPORTANTE)

SIEMPRE usa \`flowchart TD\`. NUNCA uses \`mindmap\`, \`graph\`, ni \`graph TD\`.
Razón: \`mindmap\` NO permite node IDs (N0[Texto]) ni classDef. Se rompe al renderizar.
\`flowchart TD\` sí permite todo lo que necesitamos.

## REGLAS DE FORMATO

1. Responde SOLO con el código Mermaid. Sin \`\`\`mermaid, sin \`\`\`, sin texto antes ni después.
2. Etiquetas en ESPAÑOL, claras (2-5 palabras).
3. SIN tildes dentro de etiquetas (usa "razon" no "razón").
4. SIN paréntesis, comillas ni caracteres especiales dentro de las etiquetas.
5. Cada nodo se ve así: \`A[Texto del nodo]:::nivelN\`

## ESTRUCTURA OBLIGATORIA

- Primera línea: \`flowchart TD\`
- 1 nodo raíz con la clase nivel1
- 4-6 ramas principales (nivel2)
- Cada rama con 3-5 sub-nodos (nivel3)
- Algunos nivel3 con 1-2 nodos hijos (nivel4)
- TOTAL: 30-45 nodos
- 4 NIVELES de profundidad mínimos

## EJEMPLO COMPLETO (imita EXACTAMENTE este formato)

%%{init: {'theme':'base', 'themeVariables': {'primaryColor':'#e3f2fd','primaryTextColor':'#0d47a1','primaryBorderColor':'#1976d2','lineColor':'#546e7a','fontSize':'16px'}}}%%
flowchart TD
    ENCAJE[ENCAJE BANCARIO]:::nivel1

    ENCAJE --> DEF[Definicion]:::nivel2
    ENCAJE --> TIPOS[Tipos]:::nivel2
    ENCAJE --> BASE[Base Legal]:::nivel2
    ENCAJE --> CALC[Calculo]:::nivel2

    DEF --> D1[Reserva obligatoria]:::nivel3
    DEF --> D2[Deposito en BCRP]:::nivel3
    DEF --> D3[Porcentaje de depositos]:::nivel3
    D1 --> D1a[No se puede prestar]:::nivel4
    D1 --> D1b[Genera liquidez]:::nivel4
    D3 --> D3a[Minimo 4%]:::nivel4

    TIPOS --> T1[Legal o efectivo]:::nivel3
    TIPOS --> T2[Excedente]:::nivel3
    T1 --> T1a[En cuenta BCRP]:::nivel4
    T2 --> T2a[Deposito adicional]:::nivel4

    BASE --> B1[Ley 26702]:::nivel3
    BASE --> B2[Circular BCRP]:::nivel3
    B1 --> B1a[Articulo 162]:::nivel4

    CALC --> C1[Porcentaje por tipo]:::nivel3
    CALC --> C2[Base de calculo]:::nivel3
    C1 --> C1a[Depositos vista]:::nivel4
    C2 --> C2a[Promedio diario]:::nivel4

    classDef nivel1 fill:#0d47a1,stroke:#062b63,color:#ffffff,font-weight:bold,font-size:18px
    classDef nivel2 fill:#1976d2,stroke:#0d47a1,color:#ffffff,font-size:15px
    classDef nivel3 fill:#bbdefb,stroke:#1976d2,color:#0d47a1,font-size:13px
    classDef nivel4 fill:#e3f2fd,stroke:#90caf9,color:#0d47a1,font-size:11px

## CLASES OBLIGATORIAS AL FINAL

classDef nivel1 fill:#0d47a1,stroke:#062b63,color:#ffffff,font-weight:bold,font-size:18px
classDef nivel2 fill:#1976d2,stroke:#0d47a1,color:#ffffff,font-size:15px
classDef nivel3 fill:#bbdefb,stroke:#1976d2,color:#0d47a1,font-size:13px
classDef nivel4 fill:#e3f2fd,stroke:#90caf9,color:#0d47a1,font-size:11px

## REGLA FINAL

Si tienes dudas de sintaxis, SIMPLIFICA las etiquetas, pero NUNCA cambies flowchart TD.`;

function validateMermaid(code) {
  if (!code || code.length < 150) return { ok: false, reason: 'muy corto' };

  // Debe empezar con %%{init o flowchart
  if (!/flowchart\s+TD/i.test(code)) {
    return { ok: false, reason: 'no es flowchart TD' };
  }

  // No debe contener mindmap
  if (/^\s*mindmap/im.test(code)) {
    return { ok: false, reason: 'usa mindmap (prohibido)' };
  }

  const nodeCount = (code.match(/:::nivel\d/g) || []).length;
  const levels = new Set((code.match(/nivel\d/g) || [])).size;

  if (nodeCount < 15) return { ok: false, reason: `solo ${nodeCount} nodos` };
  if (levels < 3) return { ok: false, reason: `solo ${levels} niveles` };

  return { ok: true, nodeCount, levels };
}

async function generateMermaidSyntax(userRequest, contextText, provider = 'groq') {
  const userContent = contextText
    ? `Genera un diagrama tipo MAPA CONCEPTUAL (flowchart TD) EXCEPCIONALMENTE DETALLADO para: "${userRequest}"

Basate en este contenido:

${contextText.slice(0, 5000)}

Recuerda: flowchart TD, MINIMO 30 nodos, MINIMO 4 niveles, estilos classDef completos.`
    : `Genera un diagrama tipo MAPA CONCEPTUAL (flowchart TD) EXCEPCIONALMENTE DETALLADO para: "${userRequest}"

Recuerda: flowchart TD, MINIMO 30 nodos, MINIMO 4 niveles, estilos classDef completos.`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  console.log(`   🧠 Generando sintaxis Mermaid (flowchart TD) con ${provider}...`);
  const result = await askLLM(messages, {
    preferred: provider,
    maxTokens: 4000,
    temperature: 0.35,
  });

  let code = result.text.trim();
  code = code.replace(/^```mermaid\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();

  console.log(`   📊 Sintaxis generada: ${code.length} chars, ${result.provider}`);
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

  console.log(`   🎨 Renderizando con mermaid.ink...`);
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 40000,
    headers: { 'User-Agent': 'AthenaBot/1.0' },
  });

  const buffer = Buffer.from(response.data);
  if (!buffer || buffer.length < 500) {
    throw new Error('El diagrama renderizado está vacío');
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

  // ---- Intento 1: Groq ----
  try {
    const { code } = await generateMermaidSyntax(userRequest, contextText, 'groq');
    const v = validateMermaid(code);
    console.log(`   🔍 Validación: ${v.ok ? '✅' : '⚠️'} ${v.reason || ''} (${v.nodeCount} nodos, ${v.levels} niveles)`);

    if (v.ok) {
      bestCode = code;
      bestStats = v;
    } else {
      // Guardar de todos modos por si NVIDIA falla
      bestCode = code;
      bestStats = v;
    }
  } catch (err) {
    console.warn('   ⚠️  Groq falló:', err.message);
  }

  // ---- Intento 2: NVIDIA si el primero fue inválido ----
  if (!bestStats.ok) {
    try {
      console.log(`   🔄 Reintentando con NVIDIA (${bestStats.reason || 'mapa pobre'})...`);
      const { code } = await generateMermaidSyntax(userRequest, contextText, 'nvidia');
      const v = validateMermaid(code);
      console.log(`   🔍 Validación NVIDIA: ${v.ok ? '✅' : '⚠️'} ${v.reason || ''} (${v.nodeCount} nodos, ${v.levels} niveles)`);

      if (v.ok || v.nodeCount > bestStats.nodeCount) {
        bestCode = code;
        bestStats = v;
      }
    } catch (err) {
      console.warn('   ⚠️  NVIDIA falló:', err.message);
    }
  }

  if (!bestCode) {
    throw new Error('No se pudo generar el código Mermaid');
  }

  // Validación final antes de renderizar
  const finalCheck = validateMermaid(bestCode);
  if (!finalCheck.ok) {
    throw new Error(`El código generado no es válido: ${finalCheck.reason}. Reintenta con otro tema.`);
  }

  console.log(`   📊 Código final: ${bestStats.nodeCount} nodos, ${bestStats.levels} niveles`);

  try {
    const buffer = await renderMermaidToImage(bestCode);
    return { buffer, code: bestCode };
  } catch (err) {
    console.error(`   ❌ Error render: ${err.message}`);
    throw new Error(`No se pudo renderizar el diagrama. Intenta con otro tema.`);
  }
}