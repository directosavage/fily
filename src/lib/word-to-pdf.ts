import mammoth from 'mammoth';
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';

const pageWidth = 595.28;
const pageHeight = 841.89;
const margin = 48;

function wrapText(text: string, font: Awaited<ReturnType<PDFDocument['embedFont']>>, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > width) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

export async function wordToPdf(input: Uint8Array): Promise<Uint8Array> {
  const arrayBuffer = new Uint8Array(input).buffer;
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer });
  return wordHtmlToPdf(html);
}

export async function wordHtmlToPdf(html: string): Promise<Uint8Array> {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const output = await PDFDocument.create();
  const regular = await output.embedFont(StandardFonts.TimesRoman);
  const bold = await output.embedFont(StandardFonts.TimesRomanBold);
  const italic = await output.embedFont(StandardFonts.TimesRomanItalic);
  let page = output.addPage([pageWidth, pageHeight]);
  let cursor = pageHeight - margin;
  const newPage = () => {
    page = output.addPage([pageWidth, pageHeight]);
    cursor = pageHeight - margin;
  };
  const ensureSpace = (height: number) => {
    if (cursor - height < margin) newPage();
  };
  const addParagraph = (text: string, size: number, font = regular, indent = 0, color = rgb(0.12, 0.14, 0.19)) => {
    const lines = wrapText(text, font, size, pageWidth - margin * 2 - indent);
    const lineHeight = size * 1.38;
    ensureSpace(lines.length * lineHeight + 7);
    lines.forEach((line) => {
      page.drawText(line, { x: margin + indent, y: cursor - size, size, font, color });
      cursor -= lineHeight;
    });
    cursor -= 7;
  };
  const elements = Array.from(parsed.body.children);
  let listNumber = 1;
  for (const element of elements) {
    if (/^H[1-6]$/.test(element.tagName)) {
      const size = Math.max(13, 24 - Number(element.tagName.slice(1)) * 1.7);
      addParagraph(element.textContent ?? '', size, bold);
    } else if (element.tagName === 'P') {
      const text = element.textContent?.trim() ?? '';
      if (text) addParagraph(text, 11, element.querySelector('em,i') ? italic : regular);
      for (const imageElement of Array.from(element.querySelectorAll('img'))) {
        const source = imageElement.getAttribute('src') ?? '';
        const match = source.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/);
        if (!match) continue;
        const binary = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
        const image = match[1] === 'image/png' ? await output.embedPng(binary) : await output.embedJpg(binary);
        const scale = Math.min(1, 480 / image.width, 300 / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        ensureSpace(height + 10);
        page.drawImage(image, { x: margin, y: cursor - height, width, height });
        cursor -= height + 10;
      }
    } else if (element.tagName === 'UL' || element.tagName === 'OL') {
      for (const item of Array.from(element.querySelectorAll(':scope > li'))) {
        const prefix = element.tagName === 'UL' ? '-' : `${listNumber}.`;
        addParagraph(`${prefix}  ${item.textContent?.trim() ?? ''}`, 10.5, regular, 14);
        listNumber += 1;
      }
    } else if (element.tagName === 'TABLE') {
      const rows = Array.from(element.querySelectorAll('tr')).map((row) =>
        Array.from(row.querySelectorAll(':scope > th,:scope > td')).map((cell) => cell.textContent?.trim() ?? ''),
      );
      const columns = Math.max(1, ...rows.map((row) => row.length));
      const cellWidth = (pageWidth - margin * 2) / columns;
      for (const row of rows) {
        const wrapped = row.map((cell) => wrapText(cell, regular, 9.5, cellWidth - 12));
        const rowHeight = Math.max(22, ...wrapped.map((lines) => lines.length * 12 + 10));
        ensureSpace(rowHeight);
        row.forEach((_, column) => {
          const x = margin + column * cellWidth;
          const y = cursor - rowHeight;
          page.drawRectangle({ x, y, width: cellWidth, height: rowHeight, borderColor: rgb(0.7, 0.72, 0.77), borderWidth: 0.5 });
          (wrapped[column] ?? []).forEach((line, lineIndex) => page.drawText(line, { x: x + 6, y: cursor - 16 - lineIndex * 12, size: 9.5, font: regular }));
        });
        cursor -= rowHeight;
      }
      cursor -= 8;
    }
  }
  return output.save();
}
