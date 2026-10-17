import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { applyImageFilter } from '../src/lib/images';
import {
  addPageNumbers,
  fillForm,
  getFormFields,
  mergePdfs,
  protectPdf,
  removePages,
  rotatePdf,
  splitPdfByRanges,
  extractPages,
  watermarkPdf,
} from '../src/lib/pdf';
import { parsePageRanges } from '../src/lib/ranges';
import { homographyFromPoints, mapPoint } from '../src/lib/warp';
import type { Point } from '../src/lib/warp';

async function makePdf(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) document.addPage([420, 594]);
  return document.save();
}

async function getPageCount(bytes: Uint8Array, password?: string): Promise<number> {
  return (await PDFDocument.load(bytes, password ? { password } : {})).getPageCount();
}

describe('page range parsing', () => {
  it('expands ranges into zero-based ordered page indexes', () => {
    expect(parsePageRanges('1-3,5', 5)).toEqual([0, 1, 2, 4]);
  });

  it('rejects malformed and out-of-range selections', () => {
    expect(() => parsePageRanges('1-a', 5)).toThrow(/Invalid page range/);
    expect(() => parsePageRanges('2-1', 5)).toThrow(/outside/);
    expect(() => parsePageRanges('6', 5)).toThrow(/outside/);
    expect(() => parsePageRanges(' ', 5)).toThrow(/at least one/);
  });
});

describe('PDF page operations', () => {
  it('merges page counts and splits each requested range', async () => {
    const merged = await mergePdfs([await makePdf(2), await makePdf(3)]);
    expect(await getPageCount(merged)).toBe(5);

    const parts = await splitPdfByRanges(merged, '1-3,5');
    expect(await Promise.all(parts.map((part) => getPageCount(part.bytes)))).toEqual([3, 1]);
  });

  it('rotates, removes, and extracts pages', async () => {
    const original = await makePdf(4);
    const rotated = await rotatePdf(original, [1], 90);
    const rotatedDoc = await PDFDocument.load(rotated);
    expect(rotatedDoc.getPages()[1].getRotation().angle).toBe(90);

    const removed = await removePages(original, [1]);
    expect(await getPageCount(removed)).toBe(3);
    const extracted = await extractPages(original, '1-2,4');
    expect(await getPageCount(extracted)).toBe(3);
  });

  it('adds watermarks and page numbers without changing page count', async () => {
    const original = await makePdf(3);
    const watermarked = await watermarkPdf(original, { text: 'Private copy' });
    const numbered = await addPageNumbers(watermarked, { format: 'Page n of N', start: 7 });
    expect(await getPageCount(numbered)).toBe(3);
  });

  it('protects PDFs with an opening password', async () => {
    const protectedBytes = await protectPdf(await makePdf(1), 'local-secret');
    await expect(PDFDocument.load(protectedBytes)).rejects.toThrow();
    const protectedDoc = await PDFDocument.load(protectedBytes, { password: 'local-secret' });
    expect(protectedDoc.getPageCount()).toBe(1);
  });

  it('parses, fills, and flattens common AcroForm fields', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([420, 594]);
    const form = document.getForm();
    form.createTextField('applicant.name').addToPage(page);
    form.createCheckBox('applicant.confirmed').addToPage(page);
    const original = await document.save();

    expect((await getFormFields(original)).map((field) => field.name)).toEqual([
      'applicant.name',
      'applicant.confirmed',
    ]);
    const filled = await fillForm(original, {
      'applicant.name': 'Ivan Kevin',
      'applicant.confirmed': 'true',
    });
    expect(await getFormFields(filled)).toEqual([
      { name: 'applicant.name', type: 'text', value: 'Ivan Kevin' },
      { name: 'applicant.confirmed', type: 'checkbox', value: 'true' },
    ]);
    const flattened = await fillForm(filled, {}, true);
    expect((await PDFDocument.load(flattened)).getForm().getFields()).toHaveLength(0);
  });
});

describe('image geometry and filters', () => {
  it('maps all four source corners to target corners', () => {
    const source: Point[] = [
      { x: 12, y: 8 },
      { x: 214, y: 22 },
      { x: 190, y: 298 },
      { x: 3, y: 270 },
    ];
    const target: Point[] = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 400 },
      { x: 0, y: 400 },
    ];
    const matrix = homographyFromPoints(source, target);
    source.forEach((point, index) => {
      const mapped = mapPoint(matrix, point);
      expect(Math.abs(mapped.x - target[index].x)).toBeLessThan(1e-6);
      expect(Math.abs(mapped.y - target[index].y)).toBeLessThan(1e-6);
    });
  });

  it('makes every black-and-white pixel either 0 or 255', () => {
    const image = {
      width: 3,
      height: 2,
      data: new Uint8ClampedArray([
        0, 0, 0, 255, 40, 40, 40, 255, 96, 96, 96, 255,
        154, 154, 154, 255, 215, 215, 215, 255, 255, 255, 255, 255,
      ]),
    };
    const filtered = applyImageFilter(image, 'bw');
    for (let index = 0; index < filtered.data.length; index += 4) {
      expect([0, 255]).toContain(filtered.data[index]);
      expect(filtered.data[index]).toBe(filtered.data[index + 1]);
      expect(filtered.data[index]).toBe(filtered.data[index + 2]);
    }
  });
});

it('detectDocumentCorners finds a bright skewed sheet on a dark background', async () => {
  const { detectDocumentCorners } = await import('../src/lib/images');
  const width = 400;
  const height = 300;
  const data = new Uint8ClampedArray(width * height * 4);
  const quad = [
    { x: 90, y: 40 },
    { x: 330, y: 70 },
    { x: 300, y: 270 },
    { x: 60, y: 240 },
  ];
  const inside = (px: number, py: number) =>
    quad.every((point, index) => {
      const next = quad[(index + 1) % 4];
      return (next.x - point.x) * (py - point.y) - (next.y - point.y) * (px - point.x) >= 0;
    });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = inside(x, y) ? 235 : 70;
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  const corners = detectDocumentCorners({ width, height, data });
  corners.forEach((corner, index) => {
    expect(Math.abs(corner.x - quad[index].x)).toBeLessThan(6);
    expect(Math.abs(corner.y - quad[index].y)).toBeLessThan(6);
  });
});
