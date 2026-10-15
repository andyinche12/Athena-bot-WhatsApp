/**
 * Mermaid Generator v2 — Genera diagramas ricos con jerarquía y estilos.
 *
 * Mejoras v2:
 *   - System prompt más exigente: exige 3+ niveles de jerarquía
 *   - Hasta 25 nodos con subcategorías
 *   - Estilos con colores por nivel
 *   - Elige automáticamente mindmap vs flowchart según el caso
 *   - Mayor resolución en mermaid.ink
 */

import axios from 'axios';
import { askLLM } from '../llm/router.js';

const MERMAID_INK_BASE = 'https://mermaid.ink/img/';

const SYSTEM_PROMPT = `Eres un experto en Mermaid.js especializado en crear MAPAS CONCEPTUALES RICOS Y PROFUNDOS para estudiantes universitarios.

Tu tarea: convertir una descripción en un diagrama Mermaid DETALLADO, con jerarquía real de al menos 3 niveles, no una simple lista radial.

## Reglas de formato

1. Responde SOLO con el código Mermaid. Sin \`\`\`mermaid, sin \`\`\`, sin explicaciones.
2. Etiquetas en ESPAÑOL, claras y específicas (2-6 palabras).
3. NO uses paréntesis, comillas dobles ni caracteres especiales dentro de las etiquetas de nodos. Para evitar errores, evita también tildes en las etiquetas (usa "razon" en vez de "razón", "formula" en vez de "fórmula").
4. Para flowchart: \`A[Texto del nodo]\` para rectángulos, \`A((Texto))\` para círculos.

## Reglas de ESTRUCTURA (lo más importante)

Un buen mapa conceptual tiene:
- 1 nodo central (el tema principal)
- 4-6 ramas principales (categorías)
- Cada rama con 2-4 sub-nodos (detalles concretos)
- Algunos sub-nodos con nodos terciarios (ejemplos, fórmulas, clasificaciones)
- TOTAL: entre 18 y 25 nodos

NUNCA hagas un diagrama plano con solo flechas del centro. SIEMPRE profundiza.

## Tipos de diagrama (elige según la petición)

- "mapa conceptual" o "mapa mental" → \`mindmap\` con jerarquía natural por indentación
- "diagrama de flujo" o "proceso" o "flujograma" → \`flowchart TD\` con pasos secuenciales
- "organigrama" → \`flowchart TD\` con estructura jerárquica
- "cuadro sinóptico" → \`flowchart LR\` con llaves laterales

## ESTILOS OBLIGATORIOS

Antes de la definición del diagrama, incluye esta línea para colorear por nivel:

%%{init: {'theme':'base', 'themeVariables': {'primaryColor':'#e3f2fd','primaryTextColor':'#0d47a1','primaryBorderColor':'#1976d2','lineColor':'#546e7a','fontSize':'16px'}}}%%

Y al final del diagrama, agrega estilos por nivel:

classDef nivel1 fill:#0d47a1,stroke:#062b63,color:#ffffff,font-weight:bold
classDef nivel2 fill:#1976d2,stroke:#0d47a1,color:#ffffff
classDef nivel3 fill:#bbdefb,stroke:#1976d2,color:#0d47a1
classDef nivel4 fill:#e3f2fd,stroke:#90caf9,color:#0d47a1

Luego aplica las clases a los nodos:
class A nivel1
class B,C,D,E nivel2
class B1,B2,C1,C2 nivel3
class B1a,C1a nivel4

## Ejemplo de ALTA CALIDAD (imita este nivel de detalle)

%%{init: {'theme':'base', 'themeVariables': {'primaryColor':'#e3f2fd','lineColor':'#546e7a','fontSize':'16px'}}}%%
flowchart TD
    RAZON[RAZON DE SOLVENCIA]:::nivel1
    RAZON --> CONCEPTO[Concepto]:::nivel2
    RAZON --> FORMULA[Formula]:::nivel2
    RAZON --> INTERP[Interpretacion]:::nivel2
    RAZON --> IMPORT[Importancia]:::nivel2

    CONCEPTO --> C1[Capacidad de pago]:::nivel3
    CONCEPTO --> C2[Respaldo de activos]:::nivel3
    CONCEPTO --> C3[Indicador de riesgo]:::nivel3

    FORMULA --> F1[Activo Total / Pasivo Total]:::nivel3
    FORMULA --> F2[Datos del Estado de Situacion Financiera]:::nivel3

    INTERP --> I1[Mayor a 1 = Solvente]:::nivel3
    INTERP --> I2[Menor a 1 = Riesgo]:::nivel3
    I1 --> I1a[Ejemplo: 2.05]:::nivel4
    I2 --> I2a[Ejemplo: 0.85]:::nivel4

    IMPORT --> IM1[Decisiones de credito]:::nivel3
    IMPORT --> IM2[Analisis para inversionistas]:::nivel3

    classDef nivel1 fill:#0d47a1,stroke:#062b63,color:#ffffff,font-weight:bold
    classDef nivel2 fill:#1976d2,stroke:#0d47a1,color:#ffffff
    classDef nivel3 fill:#bbdefb,stroke:#1976d2,color:#0d47a1
    classDef nivel4 fill:#e3f2fd,stroke:#90caf9,color:#0d47a1

## Regla final

Si el tema es simple, igual profundiza. Es mejor un mapa con detalle que uno plano. Si tienes dudas sobre la sintaxis Mermaid, simplifica la estructura PERO mantén la jerarquía de 3 niveles y los estilos.`;

/**
 * Convierte la petición del usuario en código Mermaid usando el LLM.
 */
async function generateMermaidSyntax(userRequest, contextText) {
  const userContent = contextText
    ? `Genera un diagrama Mermaid COMPLETO Y DETALLADO para: "${userRequest}"\n\nBasate en el siguiente contenido del documento:\n\n${contextText.slice(0, 4000)}`
    : `Genera un diagrama Mermaid COMPLETO Y DETALLADO para: "${userRequest}"`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  console.log(`   🧠 Generando sintaxis Mermaid con el LLM...`);
  const result = await askLLM(messages, {
    preferred: 'groq',
    maxTokens: 2500,
    temperature: 0.4,
  });

  // Limpiar la respuesta
  let code = result.text.trim();
  code = code.replace(/^```mermaid\s*/i, '');
  code = code.replace(/^```\s*/, '');
  code = code.replace(/```\s*$/, '');
  code = code.trim();

  if (!code || code.length < 20) {
    throw new Error('El LLM no devolvió una sintaxis Mermaid válida');
  }

  console.log(`   ✅ Sintaxis generada (${code.length} chars, ${result.provider})`);
  return code;
}

/**
 * Renderiza código Mermaid a PNG usando mermaid.ink
 */
async function renderMermaidToImage(mermaidCode) {
  const utf8Bytes = Buffer.from(mermaidCode, 'utf8');
  const base64 = utf8Bytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  // Más ancho y mayor escala para diagramas con jerarquía profunda
  const params = new URLSearchParams({
    type: 'png',
    bgColor: 'FFFFFF',
    width: '2000',
    scale: '2',
  });

  const url = `${MERMAID_INK_BASE}${base64}?${params.toString()}`;

  console.log(`   🎨 Renderizando diagrama con mermaid.ink...`);
  console.log(`      URL: ${url.slice(0, 120)}...`);

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
    headers: { 'User-Agent': 'AthenaBot/1.0' },
  });

  const buffer = Buffer.from(response.data);

  if (!buffer || buffer.length < 500) {
    throw new Error('El diagrama renderizado está vacío o es demasiado pequeño');
  }

  console.log(`   ✅ Diagrama renderizado (${(buffer.length / 1024).toFixed(1)} KB)`);
  return buffer;
}

/**
 * Función principal.
 *
 * @param {string} userRequest - Petición del usuario
 * @param {string} contextText - (Opcional) Texto del documento de contexto
 * @returns {Promise<{buffer: Buffer, code: string}>}
 */
export async function generateMermaidDiagram(userRequest, contextText = '') {
  if (!userRequest || !userRequest.trim()) {
    throw new Error('La petición está vacía');
  }

  const code = await generateMermaidSyntax(userRequest, contextText);

  try {
    const buffer = await renderMermaidToImage(code);
    return { buffer, code };
  } catch (err) {
    console.error(`   ❌ Error renderizando Mermaid: ${err.message}`);
    console.error(`   Sintaxis problemática:\n${code}`);
    throw new Error(
      `No se pudo renderizar el diagrama. Sintaxis generada:\n${code.slice(0, 300)}`
    );
  }
}