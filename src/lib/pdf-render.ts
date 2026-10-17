import { PDFDocument } from '@cantoo/pdf-lib';
import { Document, PageBreak, Packer, Paragraph, TextRun } from 'docx';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { loadPdf } from './pdf';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface TextItem {
  str: string;
  dir: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}

export interface TextPage {
  page: number;
  lines: Array<{ text: string; size: number }>;
}

export interface RasterPage {
  page: number;
  width: number;
  height: number;
  blob: Blob;
}

export interface RedactionBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not render this PDF page.'))),
      'image/jpeg',
      quality,
    );
  });
}

async function openPdf(bytes: Uint8Array, password?: string): Promise<pdfjs.PDFDocumentProxy> {
  try {
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      password,
      isEvalSupported: false,
    } as unknown as Parameters<typeof pdfjs.getDocument>[0]);
    return await task.promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/password|encrypted/i.test(message)) {
      throw new Error(password ? 'That password did not open this PDF.' : 'This PDF is encrypted. Enter its password to continue.');
    }
    throw new Error('This PDF could not be opened. Check that it is a valid PDF file.');
  }
}

export async function extractPdfText(bytes: Uint8Array, password?: string): Promise<TextPage[]> {
  const document = await openPdf(bytes, password);
  const pages: TextPage[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items.filter((item): item is TextItem => 'str' in item && 'transform' in item);
    const grouped = new Map<number, TextItem[]>();
    items.forEach((item) => {
      const y = Math.round(item.transform[5]);
      grouped.set(y, [...(grouped.get(y) ?? []), item]);
    });
    const lines = [...grouped.entries()]
      .sort(([first], [second]) => second - first)
      .map(([, lineItems]) => ({
        text: lineItems.map((item) => item.str).join(' ').trim(),
        size: Math.max(...lineItems.map((item) => Math.abs(item.transform[0]))),
      }))
      .filter((line) => line.text);
    pages.push({ page: pageNumber, lines });
  }
  return pages;
}

export async function renderPdfPages(
  bytes: Uint8Array,
  options: { scale?: number; quality?: number; password?: string } = {},
): Promise<RasterPage[]> {
  const document = await openPdf(bytes, options.password);
  const pages: RasterPage[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: options.scale ?? 1.5 });
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Your browser could not render this PDF.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    pages.push({
      page: pageNumber,
      width: canvas.width,
      height: canvas.height,
      blob: await canvasToBlob(canvas, options.quality ?? 0.9),
    });
  }
  return pages;
}

export async function rasterPagesToPdf(pages: readonly RasterPage[]): Promise<Uint8Array> {
  if (!pages.length) throw new Error('There are no pages to export.');
  const output = await PDFDocument.create();
  for (const rendered of pages) {
    const image = await output.embedJpg(new Uint8Array(await rendered.blob.arrayBuffer()));
    const page = output.addPage([rendered.width, rendered.height]);
    page.drawImage(image, { x: 0, y: 0, width: rendered.width, height: rendered.height });
  }
  return output.save();
}

export async function compressPdf(
  bytes: Uint8Array,
  level: 'low' | 'medium' | 'high',
  password?: string,
): Promise<Uint8Array> {
  const configuration = {
    low: { scale: 1.5, quality: 0.78 },
    medium: { scale: 1.1, quality: 0.62 },
    high: { scale: 0.75, quality: 0.45 },
  }[level];
  return rasterPagesToPdf(await renderPdfPages(bytes, { ...configuration, password }));
}

export async function redactPdf(
  bytes: Uint8Array,
  boxes: readonly RedactionBox[],
  password?: string,
): Promise<Uint8Array> {
  const renderedDocument = await openPdf(bytes, password);
  const sourceDocument = await loadPdf(bytes, password);
  const outputDocument = await PDFDocument.create();
  const scale = 2;
  for (let pageNumber = 1; pageNumber <= renderedDocument.numPages; pageNumber += 1) {
    const pageBoxes = boxes.filter((box) => box.page === pageNumber - 1);
    if (!pageBoxes.length) {
      const [page] = await outputDocument.copyPages(sourceDocument, [pageNumber - 1]);
      outputDocument.addPage(page);
      continue;
    }
    const page = await renderedDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Your browser could not render this PDF.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    pageBoxes.forEach((box) => {
      context.fillStyle = '#000';
      context.fillRect(box.x * canvas.width, box.y * canvas.height, box.width * canvas.width, box.height * canvas.height);
    });
    const rendered = await canvasToBlob(canvas, 0.96);
    const image = await outputDocument.embedJpg(new Uint8Array(await rendered.arrayBuffer()));
    const outputPage = outputDocument.addPage([viewport.width / scale, viewport.height / scale]);
    outputPage.drawImage(image, { x: 0, y: 0, width: viewport.width / scale, height: viewport.height / scale });
  }
  return outputDocument.save();
}

export async function pdfToDocx(bytes: Uint8Array, password?: string): Promise<Blob> {
  const pages = await extractPdfText(bytes, password);
  const children: Paragraph[] = [];
  pages.forEach((page, pageIndex) => {
    page.lines.forEach(({ text, size }) => {
      const heading = size >= 16;
      children.push(
        new Paragraph({
          heading: heading ? 'Heading1' : undefined,
          children: [new TextRun({ text, bold: heading, size: Math.round(Math.max(22, size * 2)) })],
        }),
      );
    });
    if (pageIndex < pages.length - 1) children.push(new Paragraph({ children: [new PageBreak()] }));
  });
  const document = new Document({ sections: [{ children }] });
  return Packer.toBlob(document);
}

export function pdfPagesToText(pages: readonly TextPage[]): string {
  return pages.map((page) => page.lines.map((line) => line.text).join('\n')).join('\n\n');
}

export function pdfPagesToMarkdown(pages: readonly TextPage[]): string {
  return pages
    .map((page) =>
      page.lines
        .map(({ text, size }) => (size >= 18 ? `## ${text}` : size >= 14 ? `### ${text}` : text))
        .join('\n'),
    )
    .join('\n\n');
}

export async function unlockPdfByRasterizing(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const rendered = await renderPdfPages(bytes, { scale: 1.5, quality: 0.9, password });
  return rasterPagesToPdf(rendered);
}

export async function ensurePasswordAccepted(bytes: Uint8Array, password: string): Promise<number> {
  return (await loadPdf(bytes, password)).getPageCount();
}
