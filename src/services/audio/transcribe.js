import Groq from 'groq-sdk';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { writeFileSync, unlinkSync, existsSync, mkdirSync, createReadStream } from 'fs';
import { join } from 'path';
import { config } from '../../config/env.js';

const groq = new Groq({ apiKey: config.groqApiKey });

// Crear carpeta temporal si no existe
const TMP_DIR = './data/tmp';
if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

/**
 * Descarga y transcribe un mensaje de audio de WhatsApp.
 * @param {Object} msg - Mensaje de Baileys
 * @param {Object} sock - Socket de Baileys
 * @returns {Promise<string>} Texto transcrito
 */
export async function transcribeAudioMessage(msg, sock) {
  const tmpPath = join(TMP_DIR, `audio-${Date.now()}.ogg`);

  try {
    // 1. Descargar el audio
    console.log('   🎤 Descargando audio...');
    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger: console, reuploadRequest: sock.updateMediaMessage }
    );

    writeFileSync(tmpPath, buffer);
    console.log(`   💾 Audio guardado: ${(buffer.length / 1024).toFixed(1)} KB`);

    // 2. Transcribir con Groq Whisper
    // Usamos createReadStream porque groq-sdk NO acepta Blob directamente
    console.log('   🎙️ Transcribiendo con Whisper...');
    const transcription = await groq.audio.transcriptions.create({
      file: createReadStream(tmpPath),
      model: 'whisper-large-v3-turbo',
      language: 'es',
      response_format: 'json',
      temperature: 0.0,
      // Prompt con contexto académico para mejorar precisión de términos técnicos
      prompt: 'Contenido académico de contabilidad, finanzas, auditoría. Hablante peruano.',
    });

    const text = transcription.text || '';
    console.log(`   ✅ Transcripción (${text.length} chars): "${text}"`);
    return text;
  } catch (err) {
    console.error('❌ Error transcribiendo audio:', err.message);
    // Log extra para debug
    if (err.response) {
      console.error('   Detalle API:', JSON.stringify(err.response, null, 2));
    }
    throw err;
  } finally {
    // Limpieza
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {}
  }
}