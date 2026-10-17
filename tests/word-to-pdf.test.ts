import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import { Window } from 'happy-dom';
import mammoth from 'mammoth';
import { PDFDocument } from '@cantoo/pdf-lib';
import { wordHtmlToPdf } from '../src/lib/word-to-pdf';

const imagePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2n0AAAAASUVORK5CYII=', 'base64');

afterEach(() => vi.unstubAllGlobals());

describe('Word to PDF', () => {
  it('paginates a DOCX containing headings, paragraphs, lists, tables, and images', async () => {
    const sample = new Document({
      sections: [{
        children: [
          new Paragraph({ text: 'Sample heading', heading: HeadingLevel.HEADING_1 }),
          new Paragraph('A representative paragraph with readable text.'),
          new Paragraph({ bullet: { level: 0 }, children: [new TextRun('List item')] }),
          new Table({ rows: [new TableRow({ children: [
            new TableCell({ children: [new Paragraph('Table cell one')] }),
            new TableCell({ children: [new Paragraph('Table cell two')] }),
          ] })] }),
          new Paragraph({ children: [new ImageRun({ data: imagePng, type: 'png', transformation: { width: 16, height: 16 } })] }),
        ],
      }],
    });
    const bytes = new Uint8Array(await Packer.toBuffer(sample));
    const html = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
    expect(html.value).toContain('<h1>Sample heading</h1>');
    expect(html.value).toContain('<ul><li>List item</li></ul>');
    expect(html.value).toContain('<table>');
    expect(html.value).toContain('data:image/png;base64,');

    const browser = new Window();
    vi.stubGlobal('DOMParser', browser.DOMParser);
    const pdfBytes = await wordHtmlToPdf(html.value);
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    expect(pdf.getPage(0).getSize().width).toBeGreaterThan(500);
    browser.happyDOM.abort();
  });
});
