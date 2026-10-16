/**
 * Parser de documentos — extrae texto de PDF, Word, Excel, PowerPoint.
 *
 * Estrategia:
 *   1. Intenta con officeparser (CJS vía createRequire)
 *   2. Si falla, usa fallbacks específicos por formato:
 *      - PDF   → pdfjs-dist v3 (nativo, sin worker) + Gemini Vision OCR si falla
 *      - XLSX  → xlsx
 *      - DOCX/PPTX → jszip (extrae el XML interno)
 */

import { createRequire } from 'node:module';
import { downloadMediaMessage } from '@whiskeysockets/baileys';

const require = createRequire(import.meta.url);

// ============================================================
//  Cargar officeparser como CommonJS
// ============================================================
let _officeParser = null;
let _officeParserError = null;
try {
  _officeParser = require('officeparser');
  console.log('🔍 [parser] officeparser cargado. Exports:', Object.keys(_officeParser).join(', '));
} catch (err) {
  _officeParserError = err.message;
  console.error('⚠️  [parser] No se pudo cargar officeparser:', err.message);
}

function getOfficeParserFn() {
  if (!_officeParser) return null;
  const candidates = [
    _officeParser.parseOfficeAsync,
    _officeParser.default?.parseOfficeAsync,
    _officeParser.parseOffice,
    _officeParser.default?.parseOffice,
  ];
  for (const fn of candidates) {
    if (typeof fn === 'function') return fn;
  }
  return null;
}

function normalizeResult(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;

  if (typeof result === 'object') {
    const textKeys = ['text', 'content', 'parsedText', 'extractedText', 'body'];
    for (const k of textKeys) {
      if (typeof result[k] === 'string' && result[k].length > 0) {
        return result[k];
      }
    }
    for (const outer of Object.values(result)) {
      if (outer && typeof outer === 'object') {
        for (const k of textKeys) {
          if (typeof outer[k] === 'string' && outer[k].length > 0) {
            return outer[k];
          }
        }
      }
    }
    return '';
  }

  return String(result);
}

// ============================================================
//  PDF → pdfjs-dist v3 + Gemini Vision OCR fallback
// ============================================================
async function extractPDF(buffer) {
  console.log('   🔍 [parser] Iniciando extracción de PDF...');

  // ============ INTENTO 1: pdfjs v3 ============
  let pdfText = '';
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
    console.log('   ✅ [parser] pdfjs-dist v3 importado');

    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableFontFace: true,
    }).promise;

    console.log(`   📄 [parser] PDF abierto: ${doc.numPages} páginas`);

    const maxPages = Math.min(doc.numPages, 50);
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((it) => it.str || '').join(' ');
      console.log(`   📄 [parser] Página ${i}: ${pageText.length} chars`);
      if (pageText.trim()) pdfText += pageText + '\n\n';
    }

    pdfText = pdfText.trim();
    console.log(`   ✅ [parser] pdfjs extrajo: ${pdfText.length} chars`);
  } catch (err) {
    console.warn('   ⚠️  [parser] pdfjs falló:', err.message);
  }

  // ============ SI HAY SUFICIENTE TEXTO, DEVOLVERLO ============
  if (pdfText.length >= 200) {
    return pdfText;
  }

  // ============ INTENTO 2: OCR con Gemini Vision ============
  console.log(`   🤖 [parser] Poco texto (${pdfText.length} chars). Usando Gemini Vision para OCR...`);

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const { config } = await import('../config/env.js');

    const gemini = new GoogleGenAI({ apiKey: config.geminiApiKey });

    const base64Pdf = buffer.toString('base64');
    const models = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];

    for (const model of models) {
      try {
        console.log(`   🧠 [parser] Probando OCR con ${model}...`);

        const response = await gemini.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                { text: 'Transcribe LITERALMENTE todo el contenido de este PDF. Si tiene tablas, mantén el formato. Si tiene imágenes con texto, transcribe lo que se lea. Responde SOLO con el texto transcrito, sin explicaciones.' },
                { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
              ],
            },
          ],
          config: { temperature: 0.1, maxOutputTokens: 8192 },
        });

        const ocrText = (response.text || '').trim();
        if (ocrText.length > 200) {
          console.log(`   ✅ [parser] Gemini OCR OK (${ocrText.length} chars)`);
          return ocrText;
        }
      } catch (err) {
        console.warn(`   ⚠️  [parser] ${model} falló:`, err.message);
      }
    }
  } catch (err) {
    console.error('   ❌ [parser] Gemini OCR también falló:', err.message);
  }

  // ============ SI NADA FUNCIONÓ ============
  console.error('   ❌ [parser] No se pudo extraer texto del PDF');
  return pdfText;
}

// ============================================================
//  XLSX → xlsx
// ============================================================
async function extractXLSX(buffer) {
  try {
    const XLSX = require('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const parts = [];
    for (const name of wb.SheetNames) {
      parts.push(`--- Hoja: ${name} ---`);
      parts.push(XLSX.utils.sheet_to_csv(wb.Sheets[name]));
    }
    return parts.join('\n').trim();
  } catch (err) {
    console.error('   ⚠️  [parser] XLSX fallback falló:', err.message);
    return '';
  }
}

// ============================================================
//  DOCX/PPTX → jszip
// ============================================================
async function extractZipXml(buffer, mimetype) {
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(buffer);
    const texts = [];

    if (mimetype.includes('wordprocessingml') || mimetype === 'application/msword') {
      const docXml = await zip.file('word/document.xml')?.async('string');
      if (docXml) {
        const matches = docXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
        for (const m of matches) texts.push(m[1]);
      }
    } else if (
      mimetype.includes('presentationml') ||
      mimetype === 'application/vnd.ms-powerpoint'
    ) {
      const slideFiles = Object.keys(zip.files)
        .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
        .sort((a, b) => {
          const na = parseInt(a.match(/slide(\d+)/)[1], 10);
          const nb = parseInt(b.match(/slide(\d+)/)[1], 10);
          return na - nb;
        });

      for (const file of slideFiles) {
        const xml = await zip.file(file).async('string');
        const matches = xml.matchAll(/<a:t>([^<]*)<\/a:t>/g);
        const slideText = [...matches].map((m) => m[1]).join(' ');
        if (slideText.trim()) {
          const num = file.match(/slide(\d+)/)[1];
          texts.push(`--- Diapositiva ${num} ---\n${slideText}`);
        }
      }
    }

    return texts.join('\n').trim();
  } catch (err) {
    console.error('   ⚠️  [parser] ZIP/XML fallback falló:', err.message);
    return '';
  }
}

// ============================================================
//  Mimes soportados
// ============================================================
const SUPPORTED_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/msword',
  'application/vnd.ms-powerpoint',
];

export function isSupportedDocument(mimetype) {
  return SUPPORTED_MIMES.includes(mimetype);
}

// ============================================================
//  Extractor principal
// ============================================================
export async function extractDocumentText(msg, sock) {
  const docMsg = msg.message?.documentMessage;
  if (!docMsg) throw new Error('No es un mensaje de documento');

  const filename = docMsg.fileName || 'documento';
  const mimetype = docMsg.mimetype || '';

  console.log(`   📄 Descargando documento: ${filename} (${mimetype})`);

  const buffer = await downloadMediaMessage(
    msg,
    'buffer',
    {},
    { logger: console, reuploadRequest: sock.updateMediaMessage }
  );

  console.log(`   💾 Tamaño: ${(buffer.length / 1024).toFixed(1)} KB`);

  let text = '';

  // ---- Intento 1: officeparser ----
  const parserFn = getOfficeParserFn();
  if (parserFn) {
    try {
      const raw = await parserFn(buffer);
      text = normalizeResult(raw);
      if (text) {
        console.log(`   ✅ officeparser OK (${text.length} chars)`);
      } else {
        console.log('   ⚠️  officeparser devolvió objeto sin texto, usando fallback...');
      }
    } catch (err) {
      console.error('   ⚠️  officeparser falló:', err.message);
    }
  } else if (_officeParserError) {
    console.log('   ⚠️  officeparser no disponible, usando fallback directo...');
  }

  // ---- Intento 2: fallback por formato ----
  if (!text || text.length < 10) {
    console.log('   🔄 Ejecutando fallback por formato...');

    if (mimetype === 'application/pdf') {
      text = await extractPDF(buffer);
    } else if (
      mimetype.includes('spreadsheetml') ||
      mimetype === 'application/vnd.ms-excel'
    ) {
      text = await extractXLSX(buffer);
    } else if (
      mimetype.includes('wordprocessingml') ||
      mimetype.includes('presentationml') ||
      mimetype === 'application/msword' ||
      mimetype === 'application/vnd.ms-powerpoint'
    ) {
      text = await extractZipXml(buffer, mimetype);
    }
  }

  if (!text || text.length < 10) {
    throw new Error(
      `No se pudo extraer texto de "${filename}". ` +
      `(mimetype: ${mimetype}, tamaño: ${(buffer.length / 1024).toFixed(1)} KB)`
    );
  }

  // Limpiar y truncar
  text = String(text).trim();
  if (text.length > 8000) {
    text = text.slice(0, 8000) + '\n\n[... documento truncado por longitud ...]';
  }

  console.log(`   ✅ Texto extraído: ${text.length} caracteres`);

  return { text, filename, mimetype };
}