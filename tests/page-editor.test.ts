import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { flattenPageItems, fractionPointToPdfPoint, fractionRectToPdfRect } from '../src/lib/page-editor';
import type { PageEditorItem } from '../src/lib/page-editor';

const pngBytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2n0AAAAASUVORK5CYII='), (character) => character.charCodeAt(0));

afterEach(() => vi.unstubAllGlobals());

describe('page editor coordinate mapping', () => {
  it('maps fractions to PDF points with a crop-box origin and 90-degree rotation', () => {
    const geometry = { x: 10, y: 20, width: 200, height: 300, rotation: 90 };
    expect(fractionPointToPdfPoint({ x: 0.25, y: 0.4 }, geometry)).toEqual({ x: 90, y: 95 });
    const rect = fractionRectToPdfRect({ x: 0.2, y: 0.3, width: 0.4, height: 0.2 }, geometry);
    expect(rect.x).toBeCloseTo(70);
    expect(rect.y).toBeCloseTo(80);
    expect(rect.width).toBeCloseTo(40);
    expect(rect.height).toBeCloseTo(120);
    const rotatedBack = { ...geometry, rotation: 270 };
    expect(fractionPointToPdfPoint({ x: 0.25, y: 0.4 }, rotatedBack)).toEqual({ x: 130, y: 245 });
    const rotatedBackRect = fractionRectToPdfRect({ x: 0.2, y: 0.3, width: 0.4, height: 0.2 }, rotatedBack);
    expect(rotatedBackRect.x).toBeCloseTo(110);
    expect(rotatedBackRect.y).toBeCloseTo(140);
    expect(rotatedBackRect.width).toBeCloseTo(40);
    expect(rotatedBackRect.height).toBeCloseTo(120);
  });

  it('flattens multiple items without changing page count and produces a loadable PDF', async () => {
    const source = await PDFDocument.create();
    source.addPage([200, 300]);
    source.addPage([200, 300]);
    const drawCalls: string[] = [];
    const context = {
      save() {}, restore() {}, fillRect() { drawCalls.push('fill'); }, strokeRect() { drawCalls.push('stroke'); },
      beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, translate() {}, rotate() {}, drawImage() {},
      fillText() { drawCalls.push('text'); },
      set fillStyle(_value: string) {}, set strokeStyle(_value: string) {}, set globalAlpha(_value: number) {},
      set lineWidth(_value: number) {}, set lineCap(_value: CanvasLineCap) {}, set lineJoin(_value: CanvasLineJoin) {},
      set font(_value: string) {}, set textBaseline(_value: CanvasTextBaseline) {},
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0, height: 0, getContext: () => context,
      toBlob(callback: BlobCallback) { callback(new Blob([pngBytes], { type: 'image/png' })); },
    };
    vi.stubGlobal('document', { createElement: () => canvas, fonts: { load: async () => [] } });
    const items: PageEditorItem[] = [
      { id: 'text', page: 0, kind: 'text', x: 0.1, y: 0.1, width: 0.4, height: 0.1, text: 'Hello', fontSize: 18 },
      { id: 'rect', page: 0, kind: 'rectangle', x: 0.2, y: 0.3, width: 0.3, height: 0.2 },
      { id: 'highlight', page: 1, kind: 'highlight', x: 0.1, y: 0.5, width: 0.5, height: 0.1 },
    ];
    const result = await flattenPageItems(await source.save(), items);
    const output = await PDFDocument.load(result);
    expect(output.getPageCount()).toBe(2);
    expect(drawCalls).toEqual(expect.arrayContaining(['text', 'stroke', 'fill']));
  });
});
