/**
 * Generador de documentos — Excel, Word, PowerPoint y PDF.
 * Recibe estructuras YA redactadas por el LLM y las convierte en archivos.
 */

import XLSX from 'xlsx';
import PptxGenJS from 'pptxgenjs';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, Table, TableRow, TableCell, WidthType,
} from 'docx';
import PDFDocument from 'pdfkit';

/* ============================================================
 *  EXCEL (.xlsx)
 * ============================================================ */
export async function generateExcel(title, rows) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Ancho de columnas automático
  const colWidths = [];
  for (let c = 0; c < (rows[0]?.length || 1); c++) {
    let maxLen = 10;
    for (const row of rows) {
      const cell = String(row[c] || '');
      if (cell.length > maxLen) maxLen = Math.min(cell.length, 50);
    }
    colWidths.push({ wch: maxLen + 2 });
  }
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/* ============================================================
 *  POWERPOINT (.pptx)
 *  Estructura: [{ title, bullets: [str] }, ...]
 * ============================================================ */
export async function generatePowerPoint(title, slides) {
  const pptx = new PptxGenJS();
  pptx.author = 'Athena';
  pptx.title = title;

  // Slide de portada
  const cover = pptx.addSlide();
  cover.background = { color: '1a365d' };
  cover.addText(title, {
    x: 0.5, y: 2, w: 9, h: 1.5,
    fontSize: 40, bold: true, color: 'FFFFFF',
    align: 'center', valign: 'middle',
  });

  // Slides de contenido
  for (const slide of slides) {
    const s = pptx.addSlide();
    s.addText(slide.title || title, {
      x: 0.5, y: 0.3, w: 9, h: 0.8,
      fontSize: 26, bold: true, color: '1a365d',
    });

    const bullets = slide.bullets || (slide.content ? [slide.content] : []);
    if (bullets.length > 0) {
      s.addText(
        bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        {
          x: 0.7, y: 1.3, w: 8.6, h: 4,
          fontSize: 16, color: '333333',
          lineSpacingMultiple: 1.3,
        }
      );
    }
  }

  return await pptx.write({ outputType: 'nodebuffer' });
}

/* ============================================================
 *  WORD (.docx)
 *  Estructura: { sections: [{ heading, paragraphs: [] }] }
 * ============================================================ */
export async function generateWord(title, sections) {
  const children = [
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
  ];

  for (const sec of sections) {
    if (sec.heading) {
      children.push(
        new Paragraph({
          text: sec.heading,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 300, after: 200 },
        })
      );
    }
    for (const p of sec.paragraphs || []) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: p, size: 24 })],
          spacing: { after: 200 },
          alignment: AlignmentType.JUSTIFIED,
        })
      );
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return await Packer.toBuffer(doc);
}

/* ============================================================
 *  PDF
 *  Estructura: { sections: [{ heading, paragraphs: [] }] }
 * ============================================================ */
export async function generatePDF(title, sections) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 60, size: 'A4' });

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Portada
    doc.fontSize(28).fillColor('#1a365d').text(title, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#666')
       .text(new Date().toLocaleDateString('es-PE', { dateStyle: 'long' }), { align: 'center' });
    doc.moveDown(2);

    // Secciones
    for (const sec of sections) {
      if (sec.heading) {
        doc.fontSize(16).fillColor('#1a365d').text(sec.heading);
        doc.moveDown(0.4);
      }
      for (const p of sec.paragraphs || []) {
        doc.fontSize(11).fillColor('#222').text(p, { align: 'justify' });
        doc.moveDown(0.6);
      }
      doc.moveDown(0.5);
    }

    doc.end();
  });
}