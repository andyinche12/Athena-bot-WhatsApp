import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { mkdirSync, existsSync, writeFileSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';

ffmpeg.setFfmpegPath(ffmpegPath.path);

// Voz en español de Perú (femenina, neural, natural)
const VOICE = 'es-PE-CamilaNeural';

const TMP_DIR = './data/tmp';
if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

/**
 * Convierte texto a audio OGG/Opus listo para WhatsApp PTT (nota de voz).
 * @param {string} text - Texto a convertir
 * @returns {Promise<Buffer>} Buffer del audio en formato OGG/Opus
 */
export async function textToSpeech(text) {
  const cleanText = (text || '').trim();
  if (!cleanText) {
    throw new Error('Texto vacío para TTS');
  }

  // WhatsApp limita notas de voz a ~15 min, pero nuestro límite es menor
  if (cleanText.length > 3000) {
    throw new Error('Texto demasiado largo para nota de voz (máx 3000 chars)');
  }

  const id = Date.now();
  const mp3Path = join(TMP_DIR, `tts-${id}.mp3`);
  const oggPath = join(TMP_DIR, `tts-${id}.ogg`);

  try {
    // 1. Generar MP3 con Edge TTS
    console.log(`   🎙️  Generando audio (${cleanText.length} chars, voz: ${VOICE})...`);
    const tts = new MsEdgeTTS();
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const { audioStream } = tts.toStream(cleanText);

    // Capturar el stream en un buffer
    const chunks = [];
    for await (const chunk of audioStream) {
      chunks.push(chunk);
    }
    const mp3Buffer = Buffer.concat(chunks);

    if (mp3Buffer.length < 100) {
      throw new Error('Edge TTS devolvió un audio vacío');
    }

    writeFileSync(mp3Path, mp3Buffer);
    console.log(`   💾 MP3 generado: ${(mp3Buffer.length / 1024).toFixed(1)} KB`);

    // 2. Convertir a OGG/Opus con ffmpeg
    console.log('   🔄 Convirtiendo a OGG/Opus...');
    await new Promise((resolve, reject) => {
      ffmpeg(mp3Path)
        .audioCodec('libopus')
        .audioBitrate('24k')
        .audioChannels(1)
        .audioFrequency(48000)
        .toFormat('ogg')
        .on('end', resolve)
        .on('error', reject)
        .save(oggPath);
    });

    const oggBuffer = readFileSync(oggPath);
    console.log(`   ✅ OGG/Opus listo: ${(oggBuffer.length / 1024).toFixed(1)} KB`);

    return oggBuffer;
  } finally {
    // Limpieza
    try { if (existsSync(mp3Path)) unlinkSync(mp3Path); } catch {}
    try { if (existsSync(oggPath)) unlinkSync(oggPath); } catch {}
  }
}