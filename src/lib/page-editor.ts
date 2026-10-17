import { PDFDocument } from '@cantoo/pdf-lib';

export type PageItemKind = 'text' | 'rectangle' | 'highlight' | 'pen' | 'image' | 'redact';

export interface PageEditorItem {
  id: string;
  page: number;
  kind: PageItemKind;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  opacity?: number;
  imageDataUrl?: string;
  points?: Array<{ x: number; y: number }>;
}

export interface PageGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface FractionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function normalizedRotation(rotation: number): number {
  const normalized = ((rotation % 360) + 360) % 360;
  if (normalized % 90 !== 0) throw new Error('PDF page rotation must be a multiple of 90 degrees.');
  return normalized;
}

export function fractionPointToPdfPoint(
  point: { x: number; y: number },
  geometry: PageGeometry,
): { x: number; y: number } {
  const rotation = normalizedRotation(geometry.rotation);
  const { x, y, width, height } = geometry;
  if (rotation === 90) return { x: x + point.y * width, y: y + point.x * height };
  if (rotation === 180) return { x: x + (1 - point.x) * width, y: y + point.y * height };
  if (rotation === 270) return { x: x + (1 - point.y) * width, y: y + (1 - point.x) * height };
  return { x: x + point.x * width, y: y + (1 - point.y) * height };
}

export function fractionRectToPdfRect(rect: FractionRect, geometry: PageGeometry): PdfRect {
  const points = [
    fractionPointToPdfPoint({ x: rect.x, y: rect.y }, geometry),
    fractionPointToPdfPoint({ x: rect.x + rect.width, y: rect.y }, geometry),
    fractionPointToPdfPoint({ x: rect.x, y: rect.y + rect.height }, geometry),
    fractionPointToPdfPoint({ x: rect.x + rect.width, y: rect.y + rect.height }, geometry),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const bottom = Math.min(...ys);
  return { x: left, y: bottom, width: Math.max(...xs) - left, height: Math.max(...ys) - bottom };
}

function canvasPoint(point: { x: number; y: number }, geometry: PageGeometry, scale: number) {
  const pdfPoint = fractionPointToPdfPoint(point, geometry);
  return {
    x: (pdfPoint.x - geometry.x) * scale,
    y: (geometry.y + geometry.height - pdfPoint.y) * scale,
  };
}

function imageFromDataUrl(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This image could not be opened.'));
    image.src = source;
  });
}

async function drawItems(
  context: CanvasRenderingContext2D,
  items: readonly PageEditorItem[],
  geometry: PageGeometry,
  scale: number,
): Promise<void> {
  const rotation = normalizedRotation(geometry.rotation);
  const displayWidth = rotation % 180 ? geometry.height : geometry.width;
  const displayHeight = rotation % 180 ? geometry.width : geometry.height;
  for (const item of items) {
    const bounds = fractionRectToPdfRect(item, geometry);
    const left = (bounds.x - geometry.x) * scale;
    const top = (geometry.y + geometry.height - bounds.y - bounds.height) * scale;
    const width = bounds.width * scale;
    const height = bounds.height * scale;
    if (item.kind === 'rectangle' || item.kind === 'highlight' || item.kind === 'redact') {
      context.save();
      if (item.kind === 'rectangle') {
        context.strokeStyle = item.color ?? '#3730a3';
        context.lineWidth = 2.5 * scale;
        context.strokeRect(left, top, width, height);
      } else {
        context.fillStyle = item.kind === 'redact' ? '#000' : item.color ?? '#fde047';
        context.globalAlpha = item.kind === 'redact' ? 1 : item.opacity ?? 0.38;
        context.fillRect(left, top, width, height);
      }
      context.restore();
      continue;
    }
    if (item.kind === 'pen') {
      const points = (item.points ?? []).map((point) => canvasPoint(point, geometry, scale));
      if (points.length < 2) continue;
      context.save();
      context.strokeStyle = item.color ?? '#1e3a8a';
      context.lineWidth = Math.max(1.25, item.fontSize ?? 2.5) * scale;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.stroke();
      context.restore();
      continue;
    }
    if (item.kind === 'text') {
      const displayItemWidth = item.width * displayWidth;
      const displayItemHeight = item.height * displayHeight;
      const centerX = left + width / 2;
      const centerY = top + height / 2;
      const fontSize = Math.max(6, item.fontSize ?? 18) * scale;
      const lines = (item.text ?? '').split('\n');
      context.save();
      context.translate(centerX, centerY);
      context.rotate((-rotation * Math.PI) / 180);
      context.fillStyle = item.color ?? '#1f2937';
      context.font = `${fontSize}px "${item.fontFamily ?? 'Arial'}"`;
      context.textBaseline = 'middle';
      const lineHeight = fontSize * 1.2;
      const firstY = -((lines.length - 1) * lineHeight) / 2;
      lines.forEach((line, index) => context.fillText(line, -displayItemWidth * scale / 2, firstY + index * lineHeight, displayItemWidth * scale));
      context.restore();
      void displayItemHeight;
      continue;
    }
    if (item.kind === 'image' && item.imageDataUrl) {
      const image = await imageFromDataUrl(item.imageDataUrl);
      const displayItemWidth = item.width * displayWidth * scale;
      const displayItemHeight = item.height * displayHeight * scale;
      context.save();
      context.translate(left + width / 2, top + height / 2);
      context.rotate((-rotation * Math.PI) / 180);
      context.drawImage(image, -displayItemWidth / 2, -displayItemHeight / 2, displayItemWidth, displayItemHeight);
      context.restore();
    }
  }
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not flatten the page edits.'))), 'image/png');
  });
}

export async function flattenPageItems(
  bytes: Uint8Array,
  items: readonly PageEditorItem[],
  scale = 2,
): Promise<Uint8Array> {
  if (items.some((item) => item.kind === 'redact')) {
    throw new Error('Redactions must use the secure rasterized redaction workflow.');
  }
  const document = await PDFDocument.load(bytes);
  const byPage = new Map<number, PageEditorItem[]>();
  items.forEach((item) => byPage.set(item.page, [...(byPage.get(item.page) ?? []), item]));
  for (const [pageIndex, pageItems] of byPage) {
    const page = document.getPage(pageIndex);
    const crop = page.getCropBox();
    const geometry = { ...crop, rotation: page.getRotation().angle };
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(crop.width * scale));
    canvas.height = Math.max(1, Math.ceil(crop.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare the page edits.');
    await globalThis.document.fonts?.load(`${18 * scale}px "Dancing Script"`);
    await drawItems(context, pageItems, geometry, scale);
    const png = new Uint8Array(await (await canvasBlob(canvas)).arrayBuffer());
    const image = await document.embedPng(png);
    page.drawImage(image, { x: crop.x, y: crop.y, width: crop.width, height: crop.height });
  }
  return document.save();
}
