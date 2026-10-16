/**
 * Parser de documentos — extrae texto de PDF, Word, Excel, PowerPoint.
 *
 * Estrategia:
 *   1. Intenta con officeparser (CJS vía createRequire)
 *   2. Si falla, usa fallbacks específicos por formato:
 *      - PDF   → pdfjs-dist
 *      - XLSX  → xlsx
 *      - DOCX/PPTX → jszip (extrae el XML interno)
 *
 * Todas esas librerías YA están instaladas como dependencias.
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

/**
 * Devuelve la función de parseo de officeparser, o null si no existe.
 * IMPORTANTE: preferimos parseOfficeAsync porque devuelve el texto,
 * mientras que parseOffice puede devolver un objeto de config.
 */
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

/**
 * Normaliza lo que devuelve officeparser a un string.
 * Si devuelve un objeto (típicamente el config), devuelve '' para
 * que el caller use el fallback por formato.
 */
function normalizeResult(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;

  if (typeof result === 'object') {
    // Casos típicos de éxito
    const textKeys = ['text', 'content', 'parsedText', 'extractedText', 'body'];
    for (const k of textKeys) {
      if (typeof result[k] === 'string' && result[k].length > 0) {
        return result[k];
      }
    }
    // Algunas versiones envuelven la respuesta en { data: { text } }
    for (const outer of Object.values(result)) {
      if (outer && typeof outer === 'object') {
        for (const k of textKeys) {
          if (typeof outer[k] === 'string' && outer[k].length > 0) {
            return outer[k];
          }
        }
      }
    }

    // ⚠️ NO devolvemos JSON.stringify porque eso produce basura como
    // {"config":{"password":"","newlineDelimiter":"\n",...}}
    // En su lugar, devolvemos '' y dejamos que el fallback actúe.
    return '';
  }

  return String(result);
}

// ============================================================
//  Fallbacks por formato (usan librerías ya instaladas)
// ============================================================

/** PDF → pdfjs-dist (viene con officeparser) */
async function extractPDF(buffer) {
  console.log('   🔍 [parser] Iniciando extracción de PDF...');

  let pdfjs;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    console.log('   ✅ [parser] pdfjs-dist importado');
  } catch (err) {
    console.error('   ❌ [parser] No se pudo importar pdfjs-dist:', err.message);
    return '';
  }

  try {
    // En Node.js, pdfjs v6 necesita disableWorker:true (no hay Web Workers)
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableFontFace: true,
      disableWorker: true,        
      isEvalSupported: false,     
      verbosity: 0,               
    }).promise;

    console.log(`   📄 [parser] PDF abierto: ${doc.numPages} páginas`);

    let text = '';
    const maxPages = Math.min(doc.numPages, 50);
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((it) => it.str).join(' ');
      if (pageText.trim()) text += pageText + '\n\n';
    }

    console.log(`   ✅ [parser] Texto extraído: ${text.length} chars de ${maxPages} páginas`);
    return text.trim();
  } catch (err) {
    console.error('   ❌ [parser] PDF fallback falló:', err.message);
    console.error('   ❌ [parser] Stack:', err.stack?.slice(0, 400));
    return '';
  }
}

/** XLSX → xlsx (ya instalado) */
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

/** DOCX/PPTX → jszip (ya instalado como dep de docx/pptxgenjs) */
async function extractZipXml(buffer, mimetype) {
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(buffer);
    const texts = [];

    if (mimetype.includes('wordprocessingml') || mimetype === 'application/msword') {
      // Word: docx/word/document.xml
      const docXml = await zip.file('word/document.xml')?.async('string');
      if (docXml) {
        // Extraer contenido de <w:t>...</w:t>
        const matches = docXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
        for (const m of matches) texts.push(m[1]);
      }
    } else if (
      mimetype.includes('presentationml') ||
      mimetype === 'application/vnd.ms-powerpoint'
    ) {
      // PPTX: ppt/slides/slide*.xml (ordenados numéricamente)
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

  // Limpiar y truncar (8000 chars para no exceder el límite de Groq)
  text = String(text).trim();
  if (text.length > 8000) {
    text = text.slice(0, 8000) + '\n\n[... documento truncado por longitud ...]';
  }

  console.log(`   ✅ Texto extraído: ${text.length} caracteres`);

  return { text, filename, mimetype };
}