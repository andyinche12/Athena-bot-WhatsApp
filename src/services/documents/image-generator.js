/**
 * Image Generator v5 — Genera imágenes usando Cloudflare Workers AI (gratis).
 *
 * Modelo principal: @cf/black-forest-labs/flux-1-schnell
 *  - Rápido, buena calidad, sin marca de agua.
 *  - Incluido en el tier gratuito de Cloudflare (10,000 neuronas/día).
 *
 * La API de Cloudflare devuelve un JSON con la imagen en Base64:
 *   { "result": { "image": "<base64_string>" } }
 */

import axios from 'axios';

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4/accounts';
const MODEL = '@cf/black-forest-labs/flux-1-schnell';

/**
 * Genera una imagen a partir de un prompt de texto.
 * @param {string} prompt - La descripción de la imagen a generar.
 * @returns {Promise<Buffer>} El buffer de la imagen generada (JPEG).
 */
export async function generateAIImage(prompt) {
  if (!prompt || !prompt.trim()) {
    throw new Error('El prompt está vacío');
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    throw new Error(
      'Faltan las credenciales de Cloudflare. ' +
      'Agrega CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_API_TOKEN a tu .env'
    );
  }

  const url = `${CLOUDFLARE_API_BASE}/${accountId}/ai/run/${MODEL}`;

  console.log(`   🎨 Generando imagen con Cloudflare Workers AI...`);
  console.log(`      Modelo: ${MODEL}`);
  console.log(`      Prompt: "${prompt}"`);

  try {
    const response = await axios.post(
      url,
      { prompt: prompt.trim().slice(0, 500) },
      {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );

    // Cloudflare anida la respuesta: { result: { image: "<base64>" } }
    // Soportamos también la variante plana { image: "<base64>" } por si cambia.
    const base64Image =
      response.data?.result?.image ||
      response.data?.image;

    if (!base64Image || typeof base64Image !== 'string') {
      console.error('   ❌ Respuesta inesperada de Cloudflare:', JSON.stringify(response.data).slice(0, 200));
      throw new Error('La API no devolvió una imagen válida');
    }

    // Convertir Base64 a Buffer binario
    const buffer = Buffer.from(base64Image, 'base64');

    if (!buffer || buffer.length < 500) {
      throw new Error('La imagen decodificada es demasiado pequeña o está vacía');
    }

    console.log(`   ✅ Imagen generada (${(buffer.length / 1024).toFixed(1)} KB)`);
    return buffer;
  } catch (err) {
    const msg = err?.response?.status
      ? `HTTP ${err.response.status} - ${err.response.statusText}`
      : err.message;
    console.error(`   ❌ Error generando imagen con Cloudflare: ${msg}`);

    if (err.response?.data) {
      try {
        const errorData = typeof err.response.data === 'string'
          ? JSON.parse(err.response.data)
          : err.response.data;
        console.error('   Detalle de Cloudflare:', JSON.stringify(errorData, null, 2).slice(0, 500));
      } catch (e) {
        // No se pudo parsear, ignorar
      }
    }

    throw new Error(`No se pudo generar la imagen: ${msg}`);
  }
}

/**
 * Generador de gráficos SVG simples (comando !imagen).
 * Se mantiene como fallback cuando no se necesita una imagen artística.
 */
export async function generateTextImage(title, content) {
  const width = 800;
  const padding = 40;
  const lineHeight = 28;
  const titleSize = 32;
  const bodySize = 18;

  const cleanTitle = String(title || 'Sin título').slice(0, 80);
  const cleanContent = String(content || '').slice(0, 2000);

  const words = cleanContent.split(/\s+/);
  const lines = [];
  let currentLine = '';
  const maxChars = 80;
  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length > maxChars) {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = (currentLine + ' ' + word).trim();
    }
  }
  if (currentLine) lines.push(currentLine);

  const height = Math.max(200, padding * 2 + titleSize + 30 + lines.length * lineHeight);

  const esc = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const linesSvg = lines.map((line, i) =>
    `<text x="${padding}" y="${padding + titleSize + 50 + i * lineHeight}" font-family="Arial, sans-serif" font-size="${bodySize}" fill="#333">${esc(line)}</text>`
  ).join('\n');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#fafafa"/>
  <rect x="0" y="0" width="${width}" height="6" fill="#1a365d"/>
  <text x="${padding}" y="${padding + titleSize}" font-family="Arial, sans-serif" font-size="${titleSize}" font-weight="bold" fill="#1a365d">${esc(cleanTitle)}</text>
  <line x1="${padding}" y1="${padding + titleSize + 12}" x2="${width - padding}" y2="${padding + titleSize + 12}" stroke="#ddd" stroke-width="1"/>
  ${linesSvg}
</svg>`;

  const sharp = (await import('sharp')).default;
  return sharp(Buffer.from(svg)).png().toBuffer();
}