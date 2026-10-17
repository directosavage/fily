import { PDFDocument, PageSizes } from '@cantoo/pdf-lib';
import type { PixelImage, Point } from './warp';
import { homographyFromPoints, warpPerspective } from './warp';

export type ImageFilter = 'original' | 'enhance' | 'grayscale' | 'bw' | 'magic';
export type PageSize = 'fit' | 'a4' | 'letter';

export function applyImageFilter(image: PixelImage, filter: ImageFilter): PixelImage {
  const { width, height } = image;
  const output = new Uint8ClampedArray(image.data);
  const luminance = new Float32Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    luminance[pixel] =
      0.299 * image.data[offset] + 0.587 * image.data[offset + 1] + 0.114 * image.data[offset + 2];
  }

  const sorted = filter === 'enhance' ? [...luminance].sort((a, b) => a - b) : [];
  const low = sorted.length ? sorted[Math.floor(sorted.length * 0.02)] : 0;
  const high = sorted.length ? sorted[Math.floor(sorted.length * 0.98)] : 255;
  const radius = Math.max(4, Math.floor(Math.min(width, height) / 24));
  const integral = filter === 'bw' ? buildIntegralImage(luminance, width, height) : null;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      const red = image.data[offset];
      const green = image.data[offset + 1];
      const blue = image.data[offset + 2];
      const gray = luminance[pixel];
      if (filter === 'grayscale') {
        output[offset] = output[offset + 1] = output[offset + 2] = gray;
      } else if (filter === 'bw') {
        const average = localMean(integral!, width, height, x, y, radius);
        const threshold = average * 0.88 + 8;
        const value = gray > threshold ? 255 : 0;
        output[offset] = output[offset + 1] = output[offset + 2] = value;
      } else if (filter === 'enhance') {
        const value = high === low ? gray : Math.max(0, Math.min(255, ((gray - low) / (high - low)) * 255));
        output[offset] = output[offset + 1] = output[offset + 2] = value;
      } else if (filter === 'magic') {
        const contrast = Math.max(0, Math.min(255, (gray - 128) * 1.28 + 135));
        const saturation = 1.25;
        output[offset] = Math.max(0, Math.min(255, contrast + (red - gray) * saturation));
        output[offset + 1] = Math.max(0, Math.min(255, contrast + (green - gray) * saturation));
        output[offset + 2] = Math.max(0, Math.min(255, contrast + (blue - gray) * saturation));
      }
    }
  }
  return { width, height, data: output };
}

export function rotatePixels(image: PixelImage, quarterTurns = 1): PixelImage {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0) return image;
  const width = turns % 2 === 0 ? image.width : image.height;
  const height = turns % 2 === 0 ? image.height : image.width;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const targetX = turns === 1 ? image.height - y - 1 : turns === 2 ? image.width - x - 1 : y;
      const targetY = turns === 1 ? x : turns === 2 ? image.height - y - 1 : image.width - x - 1;
      const sourceOffset = (y * image.width + x) * 4;
      const targetOffset = (targetY * width + targetX) * 4;
      data.set(image.data.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
  return { width, height, data };
}

function buildIntegralImage(values: Float32Array, width: number, height: number): Float64Array {
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      rowSum += values[(y - 1) * width + x - 1];
      integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + rowSum;
    }
  }
  return integral;
}

function localMean(
  integral: Float64Array,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
): number {
  const left = Math.max(0, x - radius);
  const right = Math.min(width, x + radius + 1);
  const top = Math.max(0, y - radius);
  const bottom = Math.min(height, y + radius + 1);
  const stride = width + 1;
  const sum =
    integral[bottom * stride + right] -
    integral[top * stride + right] -
    integral[bottom * stride + left] +
    integral[top * stride + left];
  return sum / ((right - left) * (bottom - top));
}

export function detectDocumentCorners(image: PixelImage): [Point, Point, Point, Point] {
  const { width, height, data } = image;
  const scale = Math.min(1, 256 / Math.max(width, height));
  const smallWidth = Math.max(4, Math.round(width * scale));
  const smallHeight = Math.max(4, Math.round(height * scale));
  const gray = new Float32Array(smallWidth * smallHeight);
  for (let y = 0; y < smallHeight; y += 1) {
    for (let x = 0; x < smallWidth; x += 1) {
      const sx = Math.min(width - 1, Math.round(x / scale));
      const sy = Math.min(height - 1, Math.round(y / scale));
      const offset = (sy * width + sx) * 4;
      gray[y * smallWidth + x] =
        0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
    }
  }
  const edges: Array<{ x: number; y: number; weight: number }> = [];
  for (let y = 2; y < smallHeight - 2; y += 1) {
    for (let x = 2; x < smallWidth - 2; x += 1) {
      const gx =
        -gray[(y - 1) * smallWidth + x - 1] -
        2 * gray[y * smallWidth + x - 1] -
        gray[(y + 1) * smallWidth + x - 1] +
        gray[(y - 1) * smallWidth + x + 1] +
        2 * gray[y * smallWidth + x + 1] +
        gray[(y + 1) * smallWidth + x + 1];
      const gy =
        -gray[(y - 1) * smallWidth + x - 1] -
        2 * gray[(y - 1) * smallWidth + x] -
        gray[(y - 1) * smallWidth + x + 1] +
        gray[(y + 1) * smallWidth + x - 1] +
        2 * gray[(y + 1) * smallWidth + x] +
        gray[(y + 1) * smallWidth + x + 1];
      const weight = Math.hypot(gx, gy);
      if (weight > 90) edges.push({ x, y, weight });
    }
  }
  const corners: [Point, Point, Point, Point] = [
    { x: width * 0.04, y: height * 0.04 },
    { x: width * 0.96, y: height * 0.04 },
    { x: width * 0.96, y: height * 0.96 },
    { x: width * 0.04, y: height * 0.96 },
  ];
  if (edges.length < 12) return corners;
  const bounds = [
    edges.reduce((best, point) => (point.weight > best.weight ? point : best)),
    ...(['ne', 'se', 'sw'] as const).map((quadrant) =>
      edges
        .filter(({ x, y }) => {
          const right = x > smallWidth / 2;
          const bottom = y > smallHeight / 2;
          return quadrant === 'ne' ? right && !bottom : quadrant === 'se' ? right && bottom : !right && bottom;
        })
        .reduce((best, point) => (point.weight > best.weight ? point : best), { x: 0, y: 0, weight: -1 }),
    ),
  ];
  const [northWest, northEast, southEast, southWest] = bounds;
  if ([northEast, southEast, southWest].some((point) => point.weight < 0)) return corners;
  const mapped: [Point, Point, Point, Point] = [
    { x: northWest.x / scale, y: northWest.y / scale },
    { x: northEast.x / scale, y: northEast.y / scale },
    { x: southEast.x / scale, y: southEast.y / scale },
    { x: southWest.x / scale, y: southWest.y / scale },
  ];
  try {
    homographyFromPoints(mapped, corners);
    return mapped;
  } catch {
    return corners;
  }
}

export function warpAndFilter(
  image: PixelImage,
  corners: [Point, Point, Point, Point],
  filter: ImageFilter,
): PixelImage {
  const top = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
  const bottom = Math.hypot(corners[2].x - corners[3].x, corners[2].y - corners[3].y);
  const left = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
  const right = Math.hypot(corners[2].x - corners[1].x, corners[2].y - corners[1].y);
  const warped = warpPerspective(image, corners, Math.max(1, Math.round(Math.max(top, bottom))), Math.max(1, Math.round(Math.max(left, right))));
  return applyImageFilter(warped, filter);
}

export async function imageFileToPixels(file: File): Promise<PixelImage> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not open this image.');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: image.width, height: image.height, data: image.data };
}

export async function pixelsToBlob(image: PixelImage, type = 'image/jpeg', quality = 0.92): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not export this image.');
  context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image export failed.'))), type, quality);
  });
}

export async function imagesToPdf(
  images: readonly Blob[],
  pageSize: PageSize = 'fit',
  margin = 24,
): Promise<Uint8Array> {
  if (!images.length) throw new Error('Add at least one image.');
  const document = await PDFDocument.create();
  for (const image of images) {
    const bitmap = await createImageBitmap(image);
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not convert this image.');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pngBytes = await new Promise<Uint8Array>((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (!blob) return reject(new Error('Image conversion failed.'));
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, 'image/png');
    });
    const embedded = await document.embedPng(pngBytes);
    let pageWidth: number;
    let pageHeight: number;
    if (pageSize === 'a4') [pageWidth, pageHeight] = PageSizes.A4;
    else if (pageSize === 'letter') [pageWidth, pageHeight] = PageSizes.Letter;
    else {
      const factor = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
      pageWidth = bitmap.width * factor;
      pageHeight = bitmap.height * factor;
    }
    const page = document.addPage([pageWidth, pageHeight]);
    const contentWidth = pageWidth - margin * 2;
    const contentHeight = pageHeight - margin * 2;
    const scale = Math.min(contentWidth / embedded.width, contentHeight / embedded.height);
    const width = embedded.width * scale;
    const height = embedded.height * scale;
    page.drawImage(embedded, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height });
  }
  return document.save();
}

export async function scanBarcode(image: Blob): Promise<Array<{ rawValue: string; format: string }>> {
  const browser = window as Window & {
    BarcodeDetector?: new () => { detect(source: ImageBitmap): Promise<Array<{ rawValue: string; format: string }>> };
  };
  if (!browser.BarcodeDetector) throw new Error('QR scanning is not supported by this browser. Try Chrome on a recent device.');
  const bitmap = await createImageBitmap(image);
  try {
    return await new browser.BarcodeDetector().detect(bitmap);
  } finally {
    bitmap.close();
  }
}
