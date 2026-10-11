import { GoogleGenAI } from '@google/genai';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { config } from '../../config/env.js';

const gemini = new GoogleGenAI({ apiKey: config.geminiApiKey });

// Modelos confirmados disponibles en la cuenta (verificado con list-gemini-models.js)
const MODEL_PRIMARY = 'gemini-3.8-flash';
const MODEL_FALLBACK = 'gemini-3.5-flash-lite';

const DEFAULT_PROMPT = `Analiza esta imagen con máximo detalle. Sigue estos pasos:

1. Si contiene texto manuscrito o impreso, transcríbelo LITERALMENTE y completo.
2. Identifica qué tipo de contenido es: tarea, ejercicio, apunte, examen, diapositiva, etc.
3. Si es un ejercicio o tarea: indica la materia, los datos, y qué se pide.
4. Si es un apunte: transcribe y estructura el contenido.
5. Sé conciso pero completo. Responde en español.`;

/**
 * Descarga y analiza una imagen de WhatsApp usando Gemini Vision.
 */
export async function analyzeImageMessage(msg, sock, userCaption = '') {
  // 1. Descargar imagen (una sola vez)
  console.log('   🖼️  Descargando imagen...');
  const buffer = await downloadMediaMessage(
    msg,
    'buffer',
    {},
    { logger: console, reuploadRequest: sock.updateMediaMessage }
  );
  console.log(`   💾 Imagen: ${(buffer.length / 1024).toFixed(1)} KB`);

  const base64 = buffer.toString('base64');
  const mimeType = msg.message.imageMessage?.mimetype || 'image/jpeg';
  const prompt = userCaption?.trim() || DEFAULT_PROMPT;

  // 2. Intentar con modelo principal
  try {
    console.log(`   👁️  Analizando con ${MODEL_PRIMARY}...`);
    const response = await gemini.models.generateContent({
      model: MODEL_PRIMARY,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64 } },
          ],
        },
      ],
      config: {
        temperature: 0.3,
        maxOutputTokens: 2048,
      },
    });

    const text =
      response.text ||
      response.candidates?.[0]?.content?.parts?.[0]?.text ||
      '';

    if (text.trim().length < 5) {
      throw new Error('Respuesta vacía del modelo principal');
    }

    console.log(`   ✅ Análisis (${text.length} chars)`);
    return text.trim();
  } catch (err) {
    console.error(`   ⚠️  ${MODEL_PRIMARY} falló:`, err.message);

    // 3. Fallback al modelo lite
    try {
      console.log(`   🔄 Reintentando con ${MODEL_FALLBACK}...`);
      const response = await gemini.models.generateContent({
        model: MODEL_FALLBACK,
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: base64 } },
            ],
          },
        ],
        config: {
          temperature: 0.3,
          maxOutputTokens: 2048,
        },
      });

      const text =
        response.text ||
        response.candidates?.[0]?.content?.parts?.[0]?.text ||
        '';

      if (text.trim().length < 5) {
        throw new Error('Respuesta vacía del modelo fallback');
      }

      console.log(`   ✅ Análisis fallback (${text.length} chars)`);
      return text.trim();
    } catch (err2) {
      console.error(`   ❌ Fallback también falló:`, err2.message);
      throw new Error('No se pudo analizar la imagen con Gemini');
    }
  }
}