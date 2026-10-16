/**
 * Generador de documentos v4 — Excel, Word, PowerPoint y PDF.
 *
 * v4:
 *   - Excel: colores, formato moneda peruana, fórmulas reales
 *   - PowerPoint: portada IA + imágenes de contenido + autor Werner
 *   - Word: portada formal + índice + encabezados + pie de página
 *   - PDF: portada formal + pie de página + metadata
 *   - Autor unificado: Werner Andy Inche Onofre
 */

import XLSX from 'xlsx';
import PptxGenJS from 'pptxgenjs';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, TableOfContents, PageBreak, Header, Footer,
  PageNumber, BorderStyle,
} from 'docx';
import PDFDocument from 'pdfkit';

const AUTHOR = 'Werner Andy Inche Onofre';
const INSTITUTION = 'IESTP San Ignacio de Loyola — Junín';

/* ============================================================
 *  EXCEL (.xlsx) — con colores, formato moneda y fórmulas
 * ============================================================ */
export async function generateExcel(title, rows) {
  const wb = XLSX.utils.book_new();

  // Detectar fórmulas (=...) y convertirlas al objeto SheetJS
  const converted = rows.map((row) =>
    (row || []).map((cell) => {
      if (typeof cell === 'string' && cell.trim().startsWith('=')) {
        return { f: cell.trim().slice(1) };
      }
      return cell;
    })
  );

  const ws = XLSX.utils.aoa_to_sheet(converted);

  // Detectar tipo de cada columna: moneda, número o texto
  const numCols = rows[0]?.length || 0;
  const colTypes = Array(numCols).fill('text');

  for (let c = 0; c < numCols; c++) {
    let numericCount = 0;
    let totalCount = 0;
    for (let r = 1; r < rows.length; r++) {
      const cell = rows[r]?.[c];
      if (cell === undefined || cell === null || cell === '') continue;
      totalCount++;
      const asNum = typeof cell === 'number' ? cell : parseFloat(String(cell).replace(/[^\d.-]/g, ''));
      if (!isNaN(asNum) && String(cell).trim() !== '' && !String(cell).startsWith('=')) {
        numericCount++;
      }
    }
    if (totalCount > 0 && numericCount / totalCount > 0.7) {
      const header = String(rows[0]?.[c] || '').toLowerCase();
      const isMoney = /monto|precio|total|importe|s\/|sol|ingreso|gasto|costo|pago|valor|venta|salario|sueldo|presupuesto/.test(header);
      colTypes[c] = isMoney ? 'money' : 'number';
    }
  }

  // Aplicar formato a cada celda
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell) continue;

      const isHeader = r === 0;

      if (isHeader) {
        cell.s = {
          fill: { fgColor: { rgb: '1A365D' } },
          font: { color: { rgb: 'FFFFFF' }, bold: true, sz: 12 },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border: {
            top:    { style: 'thin', color: { rgb: '0D47A1' } },
            bottom: { style: 'thin', color: { rgb: '0D47A1' } },
            left:   { style: 'thin', color: { rgb: '0D47A1' } },
            right:  { style: 'thin', color: { rgb: '0D47A1' } },
          },
        };
        continue;
      }

      const evenRow = r % 2 === 0;
      const bgColor = evenRow ? 'F5F8FC' : 'FFFFFF';

      if (cell.t === 'n' || colTypes[c] === 'money' || colTypes[c] === 'number') {
        if (colTypes[c] === 'money') {
          cell.z = '"S/" #,##0.00';
        } else if (cell.t === 'n') {
          cell.z = '#,##0.00';
        }
      }

      cell.s = {
        fill: { fgColor: { rgb: bgColor } },
        alignment: { horizontal: colTypes[c] === 'text' ? 'left' : 'right', vertical: 'center' },
        border: { bottom: { style: 'hair', color: { rgb: 'E0E0E0' } } },
        font: { sz: 11 },
      };

      if (cell.f) {
        cell.s.font = { ...cell.s.font, bold: true, color: { rgb: '0D47A1' } };
      }
    }
  }

  // Ancho de columnas
  const colWidths = [];
  for (let c = 0; c < numCols; c++) {
    let maxLen = 12;
    for (const row of rows) {
      const cell = String(row[c] ?? '');
      if (cell.length > maxLen) maxLen = Math.min(cell.length, 50);
    }
    colWidths.push({ wch: maxLen + 3 });
  }
  ws['!cols'] = colWidths;
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  ws['!rows'] = [{ hpt: 22 }];

  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
}

/* ============================================================
 *  POWERPOINT (.pptx) — portada IA + imágenes de contenido
 *  @param {Array<{slideIndex:number, buffer:Buffer}>} images
 * ============================================================ */
export async function generatePowerPoint(title, slides, images = []) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = AUTHOR;
  pptx.company = INSTITUTION;
  pptx.title = title;

  let coverImage = null;
  const imageMap = new Map();
  for (const img of images || []) {
    if (!img || !img.buffer || img.buffer.length < 1000) continue;
    if (img.slideIndex === -1) coverImage = img.buffer;
    else imageMap.set(img.slideIndex, img.buffer);
  }

  /* ---------- PORTADA ---------- */
  const cover = pptx.addSlide();
  cover.background = { color: '0D47A1' };

  if (coverImage) {
    cover.addImage({
      data: `data:image/jpeg;base64,${coverImage.toString('base64')}`,
      x: 4.8, y: 0, w: 5.2, h: 5.625,
      sizing: { type: 'cover', w: 5.2, h: 5.625 },
    });
    cover.addShape(pptx.ShapeType.rect, {
      x: 4.4, y: 0, w: 0.7, h: 5.625,
      fill: { color: '0D47A1', transparency: 30 },
    });
    cover.addText(title, {
      x: 0.5, y: 1.6, w: 4.2, h: 2.4,
      fontSize: 30, bold: true, color: 'FFFFFF',
      align: 'left', valign: 'middle',
    });
    cover.addText(AUTHOR, {
      x: 0.5, y: 4.6, w: 4.2, h: 0.4,
      fontSize: 11, color: 'B0C4DE', align: 'left',
    });
  } else {
    cover.addText(title, {
      x: 0.5, y: 1.8, w: 9, h: 2,
      fontSize: 40, bold: true, color: 'FFFFFF',
      align: 'center', valign: 'middle',
    });
    cover.addText(AUTHOR, {
      x: 0.5, y: 4.4, w: 9, h: 0.4,
      fontSize: 13, color: 'B0C4DE', align: 'center',
    });
  }

  /* ---------- SLIDES DE CONTENIDO ---------- */
  const totalSlides = slides.length;

  slides.forEach((slide, idx) => {
    const s = pptx.addSlide();
    s.background = { color: 'FFFFFF' };

    s.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.12,
      fill: { color: '0D47A1' },
    });

    s.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0.12, w: 0.55, h: 5.5,
      fill: { color: '1976D2' },
    });

    s.addText(String(idx + 1).padStart(2, '0'), {
      x: 0, y: 2.2, w: 0.55, h: 0.7,
      fontSize: 20, bold: true, color: 'FFFFFF',
      align: 'center', valign: 'middle',
    });

    s.addText(slide.title || `Diapositiva ${idx + 1}`, {
      x: 0.9, y: 0.35, w: 8.7, h: 0.9,
      fontSize: 24, bold: true, color: '0D47A1',
      align: 'left', valign: 'middle',
    });

    s.addShape(pptx.ShapeType.rect, {
      x: 0.9, y: 1.3, w: 1.8, h: 0.045,
      fill: { color: '1976D2' },
    });

    const hasImage = imageMap.has(idx);
    const bullets = slide.bullets || (slide.content ? [slide.content] : []);

    if (bullets.length > 0) {
      s.addText(
        bullets.map((b) => ({
          text: String(b),
          options: { bullet: { code: '25CF' }, breakLine: true },
        })),
        {
          x: 1.1, y: 1.7,
          w: hasImage ? 5.2 : 8.4,
          h: 3.5,
          fontSize: hasImage ? 14 : 15,
          color: '333333',
          lineSpacingMultiple: 1.5,
          paraSpaceAfter: 10,
        }
      );
    }

    if (hasImage) {
      const imgBuf = imageMap.get(idx);
      s.addImage({
        data: `data:image/jpeg;base64,${imgBuf.toString('base64')}`,
        x: 6.55, y: 1.65, w: 3.15, h: 3.2,
        sizing: { type: 'cover', w: 3.15, h: 3.2 },
      });
      s.addShape(pptx.ShapeType.rect, {
        x: 6.55, y: 1.65, w: 3.15, h: 3.2,
        fill: { type: 'none' },
        line: { color: '1976D2', width: 1.5 },
      });
    }

    s.addText(`${idx + 1} / ${totalSlides}`, {
      x: 8.4, y: 5.2, w: 1.4, h: 0.3,
      fontSize: 10, color: '999999',
      align: 'right', valign: 'middle',
    });
  });

  /* ---------- SLIDE FINAL ---------- */
  const end = pptx.addSlide();
  end.background = { color: '0D47A1' };
  end.addText('Gracias', {
    x: 0.5, y: 2, w: 9, h: 1.5,
    fontSize: 48, bold: true, color: 'FFFFFF',
    align: 'center', valign: 'middle',
  });
  end.addText(AUTHOR, {
    x: 0.5, y: 4, w: 9, h: 0.4,
    fontSize: 13, color: 'B0C4DE', align: 'center',
  });

  return await pptx.write({ outputType: 'nodebuffer' });
}

/* ============================================================
 *  WORD (.docx) — portada formal + índice + encabezado + pie
 * ============================================================ */
export async function generateWord(title, sections) {
  const fecha = new Date().toLocaleDateString('es-PE', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const children = [];

  // ---------- PORTADA ----------
  children.push(
    new Paragraph({
      children: [new TextRun({ text: '', size: 48 })],
      spacing: { before: 1200 },
    })
  );
  children.push(
    new Paragraph({
      children: [new TextRun({ text: INSTITUTION, size: 22, color: '666666', italics: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    })
  );
  children.push(
    new Paragraph({
      children: [new TextRun({ text: title, size: 56, bold: true, color: '1A365D' })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 800, after: 400 },
    })
  );
  children.push(
    new Paragraph({
      children: [new TextRun({ text: 'Documento Académico', size: 26, color: '1976D2' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 2000 },
    })
  );
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Autor: ${AUTHOR}`, size: 24, bold: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
    })
  );
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Fecha: ${fecha}`, size: 22, color: '555555' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  // Salto de página → contenido
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ---------- ÍNDICE ----------
  if (sections.filter((s) => s.heading).length >= 2) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: 'Índice', size: 36, bold: true, color: '1A365D' })],
        spacing: { after: 300 },
      })
    );

    sections.forEach((sec) => {
      if (sec.heading) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: sec.heading, size: 24, color: '333333' })],
            spacing: { after: 120 },
            indent: { left: 240 },
          })
        );
      }
    });

    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  // ---------- CONTENIDO ----------
  for (const sec of sections) {
    if (sec.heading) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: sec.heading, size: 32, bold: true, color: '1A365D' })],
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 240 },
          border: {
            bottom: { color: '1976D2', space: 4, style: BorderStyle.SINGLE, size: 8 },
          },
        })
      );
    }
    for (const p of sec.paragraphs || []) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: p, size: 24 })],
          spacing: { after: 200, line: 360 },
          alignment: AlignmentType.JUSTIFIED,
        })
      );
    }
  }

  // ---------- DOCUMENTO CON HEADER/FOOTER ----------
  const doc = new Document({
    creator: AUTHOR,
    title: title,
    description: 'Documento generado por Athena Bot',
    sections: [
      {
        properties: {},
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: 'Athena · Asistente Académico', size: 18, color: '999999' }),
                ],
                alignment: AlignmentType.RIGHT,
                border: {
                  bottom: { color: 'DDDDDD', space: 4, style: BorderStyle.SINGLE, size: 4 },
                },
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: AUTHOR + ' — Página ', size: 18, color: '999999' }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '999999' }),
                  new TextRun({ text: ' de ', size: 18, color: '999999' }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: '999999' }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

/* ============================================================
 *  PDF — portada formal + pie de página con numeración
 * ============================================================ */
export async function generatePDF(title, sections) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      margin: 60,
      size: 'A4',
      info: {
        Title: title,
        Author: AUTHOR,
        Subject: 'Documento Académico',
        Creator: 'Athena Bot',
      },
      bufferPages: true, // permite numerar al final
    });

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fecha = new Date().toLocaleDateString('es-PE', {
      day: 'numeric', month: 'long', year: 'numeric',
    });

    // ============ PORTADA ============
    doc.moveDown(3);
    doc.fontSize(14).fillColor('#666666').font('Helvetica-Oblique')
       .text(INSTITUTION, { align: 'center' });
    doc.moveDown(3);
    doc.fontSize(30).fillColor('#1A365D').font('Helvetica-Bold')
       .text(title, { align: 'center' });
    doc.moveDown(0.8);
    doc.fontSize(14).fillColor('#1976D2').font('Helvetica')
       .text('Documento Académico', { align: 'center' });
    doc.moveDown(4);
    doc.fontSize(13).fillColor('#333333').font('Helvetica-Bold')
       .text(`Autor: ${AUTHOR}`, { align: 'center' });
    doc.moveDown(0.4);
    doc.fontSize(12).fillColor('#555555').font('Helvetica')
       .text(`Fecha: ${fecha}`, { align: 'center' });

    // ============ CONTENIDO ============
    doc.addPage();

    for (const sec of sections) {
      if (sec.heading) {
        doc.fontSize(18).fillColor('#1A365D').font('Helvetica-Bold').text(sec.heading);
        doc.moveDown(0.4);
        // Línea decorativa
        const y = doc.y;
        doc.moveTo(60, y).lineTo(200, y).strokeColor('#1976D2').lineWidth(2).stroke();
        doc.moveDown(0.6);
      }
      for (const p of sec.paragraphs || []) {
        doc.fontSize(11).fillColor('#222222').font('Helvetica')
           .text(p, { align: 'justify', lineGap: 3 });
        doc.moveDown(0.6);
      }
      doc.moveDown(0.5);
    }

    // ============ PIE DE PÁGINA CON NÚMEROS ============
    const range = doc.bufferedPageRange();
    for (let i = 1; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.fontSize(9).fillColor('#999999').font('Helvetica')
         .text(
           `${AUTHOR}  ·  Página ${i + 1} de ${range.count}`,
           60,
           doc.page.height - 40,
           { align: 'center', width: doc.page.width - 120 }
         );
    }

    doc.end();
  });
}