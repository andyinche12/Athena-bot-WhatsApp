import { GoogleGenAI } from '@google/genai';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { config } from '../../config/env.js';

const gemini = new GoogleGenAI({ apiKey: config.geminiApiKey });

const DEFAULT_PROMPT = `Analiza esta imagen con máximo detalle. Sigue estos pasos:

1. Si contiene texto manuscrito o impreso, transcríbelo LITERALMENTE y completo.
2. Identifica qué tipo de contenido es: tarea, ejercicio, apunte, examen, diapositiva, etc.
3. Si es un ejercicio o tarea: indica la materia, los datos, y qué se pide.
4. Si es un apunte: transcribe y estructura el contenido.
5. Sé conciso pero completo. Responde en español.`;

/**
 * Descarga y analiza una imagen de WhatsApp usando Gemini Vision.
 * @param {Object} msg - Mensaje de Baileys
 * @param {Object} sock - Socket de Baileys
 * @param {string} userCaption - Caption del usuario (opcional)
 * @returns {Promise<string>} Análisis/transcripción de la imagen
 */
export async function analyzeImageMessage(msg, sock, userCaption = '') {
  try {
    // 1. Descargar imagen
    console.log('   🖼️  Descargando imagen...');
    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger: console, reuploadRequest: sock.updateMediaMessage }
    );
    console.log(`   💾 Imagen: ${(buffer.length / 1024).toFixed(1)} KB`);

    // 2. Convertir a base64
    const base64 = buffer.toString('base64');
    const mimeType = msg.message.imageMessage?.mimetype || 'image/jpeg';

    // 3. Prompt: caption del usuario o prompt por defecto
    const prompt = userCaption?.trim() || DEFAULT_PROMPT;

    // 4. Llamar a Gemini Vision
    console.log('   👁️  Analizando con Gemini Vision...');
    const response = await gemini.models.generateContent({
      model: 'gemini-2.5-flash',
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

    console.log(`   ✅ Análisis: ${text.length} chars`);
    return text.trim();
  } catch (err) {
    console.error('❌ Error analizando imagen:', err.message);
    // Fallback: intentar con gemini-2.5-flash-lite si flash falla
    if (err.message?.includes('not found') || err.message?.includes('404')) {
      console.log('   🔄 Reintentando con gemini-2.5-flash-lite...');
      try {
        const base64 = (await downloadMediaMessage(msg, 'buffer', {}, {
          logger: console,
          reuploadRequest: sock.updateMediaMessage,
        })).toString('base64');
        const mimeType = msg.message.imageMessage?.mimetype || 'image/jpeg';
        const prompt = userCaption?.trim() || DEFAULT_PROMPT;

        const response = await gemini.models.generateContent({
          model: 'gemini-2.5-flash-lite',
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: base64 } },
            ],
          }],
          config: { temperature: 0.3, maxOutputTokens: 2048 },
        });

        const text = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || '';
        console.log(`   ✅ Análisis (fallback): ${text.length} chars`);
        return text.trim();
      } catch (err2) {
        console.error('   ❌ Fallback también falló:', err2.message);
        throw err2;
      }
    }
    throw err;
  }
}