import { PDFDocument, PageSizes, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { imagesToPdf } from './images';
import { loadPdf } from './pdf';
import { wordToPdf, wordHtmlToPdf } from './word-to-pdf';

export type AnyFileKind = 'pdf' | 'image' | 'word' | 'html' | 'text' | 'unsupported';

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'csv', 'log', 'rtf']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg']);
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g');

export function detectFileKind(file: File): AnyFileKind {
  const name = file.name.toLowerCase();
  const extension = name.includes('.') ? name.split('.').pop() ?? '' : '';
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'word';
  if (name.endsWith('.html') || name.endsWith('.htm') || file.type === 'text/html') return 'html';
  if (file.type.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (file.type.startsWith('text/') || TEXT_EXTENSIONS.has(extension)) return 'text';
  return 'unsupported';
}

export async function fileToPdfBytes(file: File): Promise<Uint8Array> {
  const kind = detectFileKind(file);
  switch (kind) {
    case 'pdf': {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await loadPdf(bytes);
      return bytes;
    }
    case 'image':
      return imagesToPdf([file], 'fit');
    case 'word':
      return wordToPdf(new Uint8Array(await file.arrayBuffer()));
    case 'html':
      return wordHtmlToPdf(await file.text());
    case 'text':
      return textToPdf(await file.text(), file.name);
    default:
      throw new Error(`Unsupported file type: ${file.name}`);
  }
}

export async function textToPdf(text: string, title?: string): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Courier);
  const bold = await document.embedFont(StandardFonts.CourierBold);
  const [pageWidth, pageHeight] = PageSizes.A4;
  const margin = 50;
  const fontSize = 9.5;
  const lineHeight = fontSize * 1.45;
  const charWidth = font.widthOfTextAtSize('M', fontSize);
  const maxChars = Math.max(20, Math.floor((pageWidth - margin * 2) / charWidth));

  let page = document.addPage([pageWidth, pageHeight]);
  let cursor = pageHeight - margin;
  const newPage = () => {
    page = document.addPage([pageWidth, pageHeight]);
    cursor = pageHeight - margin;
  };
  const ensureSpace = (lines: number) => {
    if (cursor - lines * lineHeight < margin) newPage();
  };

  if (title) {
    const name = title.length > maxChars ? title.slice(0, maxChars) : title;
    page.drawText(name, { x: margin, y: cursor - fontSize, size: fontSize + 2, font: bold, color: rgb(0.2, 0.2, 0.25) });
    cursor -= lineHeight * 2;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '    ').replace(CONTROL_CHARS, '');
    const chunks = line.length === 0 ? [''] : chunkLine(line, maxChars);
    ensureSpace(chunks.length);
    for (const chunk of chunks) {
      page.drawText(chunk, { x: margin, y: cursor - fontSize, size: fontSize, font, color: rgb(0.13, 0.14, 0.18) });
      cursor -= lineHeight;
    }
  }
  if (document.getPageCount() === 0) newPage();
  return document.save();
}

function chunkLine(line: string, maxChars: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += maxChars) {
    chunks.push(line.slice(index, index + maxChars));
  }
  return chunks;
}
