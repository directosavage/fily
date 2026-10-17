import {
  PDFDocument,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  PDFTextField,
  PageSizes,
  StandardFonts,
  degrees,
  rgb,
} from '@cantoo/pdf-lib';
import type { SecurityOptions } from '@cantoo/pdf-lib';
import { parsePageRanges } from './ranges';

export interface PdfArtifact {
  name: string;
  bytes: Uint8Array;
}

export async function loadPdf(bytes: Uint8Array, password?: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, password ? { password } : {});
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/password|encrypted/i.test(message)) {
      throw new Error(password ? 'That password did not open this PDF.' : 'This PDF is encrypted. Enter its password to continue.');
    }
    throw new Error('This PDF could not be opened. Check that it is a valid PDF file.');
  }
}

export async function mergePdfs(inputs: readonly Uint8Array[]): Promise<Uint8Array> {
  if (inputs.length < 2) throw new Error('Choose at least two PDF files to merge.');
  const merged = await PDFDocument.create();
  for (const input of inputs) {
    const document = await loadPdf(input);
    const pages = await merged.copyPages(document, document.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return merged.save();
}

export async function splitPdfByRanges(input: Uint8Array, ranges: string): Promise<PdfArtifact[]> {
  const source = await loadPdf(input);
  const pageCount = source.getPageCount();
  const groups = ranges.split(',').map((range) => range.trim());
  if (groups.some((range) => !range)) throw new Error('Enter valid page ranges separated by commas.');
  return Promise.all(
    groups.map(async (group, index) => {
      const pages = parsePageRanges(group, pageCount);
      const output = await PDFDocument.create();
      const copied = await output.copyPages(source, pages);
      copied.forEach((page) => output.addPage(page));
      return { name: `pages-${index + 1}.pdf`, bytes: await output.save() };
    }),
  );
}

export async function extractPages(input: Uint8Array, range: string): Promise<Uint8Array> {
  const source = await loadPdf(input);
  const pageIndices = parsePageRanges(range, source.getPageCount());
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, pageIndices);
  pages.forEach((page) => output.addPage(page));
  return output.save();
}

export async function splitEveryPage(input: Uint8Array): Promise<PdfArtifact[]> {
  const document = await loadPdf(input);
  return Promise.all(
    document.getPageIndices().map(async (index) => {
      const output = await PDFDocument.create();
      const [page] = await output.copyPages(document, [index]);
      output.addPage(page);
      return { name: `page-${index + 1}.pdf`, bytes: await output.save() };
    }),
  );
}

export async function rotatePdf(
  input: Uint8Array,
  pageIndices: readonly number[] | undefined,
  angle: 90 | 180 | 270,
): Promise<Uint8Array> {
  const document = await loadPdf(input);
  const selected = new Set(pageIndices ?? document.getPageIndices());
  document.getPages().forEach((page, index) => {
    if (selected.has(index)) page.setRotation(degrees((page.getRotation().angle + angle) % 360));
  });
  return document.save();
}

export async function removePages(input: Uint8Array, pageIndices: readonly number[]): Promise<Uint8Array> {
  const document = await loadPdf(input);
  if (pageIndices.length >= document.getPageCount()) throw new Error('A PDF must keep at least one page.');
  [...new Set(pageIndices)].sort((a, b) => b - a).forEach((index) => document.removePage(index));
  return document.save();
}

export async function organizePdf(
  input: Uint8Array,
  order: readonly number[],
  deleted: readonly number[] = [],
  rotations: Readonly<Record<number, number>> = {},
  blankAfter: readonly number[] = [],
): Promise<Uint8Array> {
  const source = await loadPdf(input);
  const excluded = new Set(deleted);
  const pageOrder = order.filter((index) => !excluded.has(index));
  if (!pageOrder.length) throw new Error('Keep at least one page in the document.');
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, pageOrder);
  pages.forEach((page, index) => {
    page.setRotation(degrees((page.getRotation().angle + (rotations[pageOrder[index]] ?? 0)) % 360));
    output.addPage(page);
    if (blankAfter.includes(pageOrder[index])) {
      const { width, height } = page.getSize();
      output.addPage([width, height]);
    }
  });
  return output.save();
}

export async function cropPdf(
  input: Uint8Array,
  margin: number,
): Promise<Uint8Array> {
  const document = await loadPdf(input);
  document.getPages().forEach((page) => {
    const { width, height } = page.getSize();
    const inset = Math.max(0, Math.min(margin, Math.floor((Math.min(width, height) - 1) / 2)));
    page.setCropBox(inset, inset, width - inset * 2, height - inset * 2);
  });
  return document.save();
}

function parseHexColor(hex: string): ReturnType<typeof rgb> {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3 ? normalized.split('').map((part) => part + part).join('') : normalized;
  const number = Number.parseInt(value, 16);
  return rgb(((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255);
}

export interface WatermarkOptions {
  text: string;
  fontSize?: number;
  opacity?: number;
  rotation?: number;
  color?: string;
  position?: 'center' | 'top' | 'bottom' | 'tiled';
}

export async function watermarkPdf(input: Uint8Array, options: WatermarkOptions): Promise<Uint8Array> {
  if (!options.text.trim()) throw new Error('Enter watermark text.');
  const document = await loadPdf(input);
  const font = await document.embedFont(StandardFonts.HelveticaBold);
  const color = parseHexColor(options.color ?? '#4f46e5');
  for (const page of document.getPages()) {
    const { width, height } = page.getSize();
    const fontSize = options.fontSize ?? 44;
    const textWidth = font.widthOfTextAtSize(options.text, fontSize);
    const x = (width - textWidth) / 2;
    const y =
      options.position === 'top' ? height - fontSize * 2 :
        options.position === 'bottom' ? fontSize : (height - fontSize) / 2;
    const rotation = degrees(options.rotation ?? -30);
    if (options.position === 'tiled') {
      for (let tileY = fontSize; tileY < height; tileY += fontSize * 3) {
        for (let tileX = -textWidth; tileX < width; tileX += textWidth + fontSize * 2) {
          page.drawText(options.text, { x: tileX, y: tileY, size: fontSize, font, color, opacity: options.opacity ?? 0.18, rotate: rotation });
        }
      }
    } else {
      page.drawText(options.text, { x, y, size: fontSize, font, color, opacity: options.opacity ?? 0.18, rotate: rotation });
    }
  }
  return document.save();
}

export async function addPageNumbers(
  input: Uint8Array,
  options: { start?: number; format?: 'n' | 'Page n of N'; position?: 'top' | 'bottom' },
): Promise<Uint8Array> {
  const document = await loadPdf(input);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const total = document.getPageCount();
  document.getPages().forEach((page, index) => {
    const number = (options.start ?? 1) + index;
    const text = options.format === 'Page n of N' ? `Page ${number} of ${total}` : String(number);
    const { width, height } = page.getSize();
    const size = 11;
    page.drawText(text, {
      x: (width - font.widthOfTextAtSize(text, size)) / 2,
      y: options.position === 'top' ? height - 24 : 16,
      size,
      font,
      color: rgb(0.24, 0.27, 0.35),
    });
  });
  return document.save();
}

export async function protectPdf(
  input: Uint8Array,
  userPassword: string,
  permissions?: SecurityOptions['permissions'],
  ownerPassword?: string,
): Promise<Uint8Array> {
  if (!userPassword) throw new Error('Enter a password to protect this PDF.');
  const document = await loadPdf(input);
  document.encrypt({ userPassword, ownerPassword: ownerPassword || `${userPassword}-${crypto.randomUUID()}`, permissions });
  return document.save();
}

export async function unlockPdf(input: Uint8Array, password: string): Promise<Uint8Array> {
  const document = await loadPdf(input, password);
  return document.save();
}

export interface FormFieldInfo {
  name: string;
  type: 'text' | 'checkbox' | 'dropdown' | 'radio' | 'other';
  value: string;
}

export async function getFormFields(input: Uint8Array): Promise<FormFieldInfo[]> {
  const document = await loadPdf(input);
  return document.getForm().getFields().map((field) => {
    if (field instanceof PDFTextField) return { name: field.getName(), type: 'text', value: field.getText() ?? '' };
    if (field instanceof PDFCheckBox) return { name: field.getName(), type: 'checkbox', value: field.isChecked() ? 'true' : 'false' };
    if (field instanceof PDFDropdown) return { name: field.getName(), type: 'dropdown', value: field.getSelected()[0] ?? '' };
    if (field instanceof PDFRadioGroup) return { name: field.getName(), type: 'radio', value: field.getSelected() ?? '' };
    return { name: field.getName(), type: 'other', value: '' };
  });
}

export async function fillForm(
  input: Uint8Array,
  values: Readonly<Record<string, string>>,
  flatten = false,
): Promise<Uint8Array> {
  const document = await loadPdf(input);
  const form = document.getForm();
  for (const field of form.getFields()) {
    const value = values[field.getName()];
    if (value === undefined) continue;
    if (field instanceof PDFTextField) field.setText(value);
    else if (field instanceof PDFCheckBox) {
      if (value === 'true') field.check();
      else field.uncheck();
    }
    else if (field instanceof PDFDropdown) field.select(value);
    else if (field instanceof PDFRadioGroup) field.select(value);
  }
  form.updateFieldAppearances();
  if (flatten) form.flatten();
  return document.save();
}

export interface Annotation {
  page: number;
  type: 'text' | 'rectangle' | 'highlight';
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  color?: string;
}

export async function annotatePdf(input: Uint8Array, annotations: readonly Annotation[]): Promise<Uint8Array> {
  const document = await loadPdf(input);
  const font = await document.embedFont(StandardFonts.Helvetica);
  annotations.forEach((annotation) => {
    const page = document.getPage(annotation.page);
    const color = parseHexColor(annotation.color ?? '#facc15');
    if (annotation.type === 'text') {
      page.drawText(annotation.text ?? '', { x: annotation.x, y: annotation.y, size: 16, font, color });
    } else {
      page.drawRectangle({
        x: annotation.x,
        y: annotation.y,
        width: annotation.width ?? 120,
        height: annotation.height ?? 48,
        color: annotation.type === 'highlight' ? color : undefined,
        borderColor: annotation.type === 'rectangle' ? color : undefined,
        borderWidth: annotation.type === 'rectangle' ? 2 : undefined,
        opacity: annotation.type === 'highlight' ? 0.35 : 1,
      });
    }
  });
  return document.save();
}

export async function addIdCardPages(front: Blob, back: Blob): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const images = await Promise.all(
    [front, back].map(async (blob) => {
      const bitmap = await createImageBitmap(blob);
      const canvas = globalThis.document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Your browser could not open this image.');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const png = await new Promise<Uint8Array>((resolve, reject) => {
        canvas.toBlob(async (converted) => {
          if (!converted) return reject(new Error('Could not convert this image.'));
          resolve(new Uint8Array(await converted.arrayBuffer()));
        }, 'image/png');
      });
      return document.embedPng(png);
    }),
  );
  const [pageWidth, pageHeight] = [PageSizes.A4[0], PageSizes.A4[1]];
  const page = document.addPage([pageWidth, pageHeight]);
  const boxWidth = pageWidth * 0.8;
  const boxHeight = pageHeight * 0.3;
  images.forEach((image, index) => {
    const scale = Math.min(boxWidth / image.width, boxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    const y = index === 0 ? pageHeight * 0.58 : pageHeight * 0.16;
    page.drawImage(image, { x: (pageWidth - width) / 2, y, width, height });
  });
  return document.save();
}

export async function signPdf(
  input: Uint8Array,
  options: { text?: string; image?: Blob; page?: number; x?: number; y?: number; width?: number },
): Promise<Uint8Array> {
  const document = await loadPdf(input);
  const pageIndex = options.page ?? 0;
  const page = document.getPage(pageIndex);
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const x = options.x ?? pageWidth * 0.58;
  const y = options.y ?? pageHeight * 0.16;
  if (options.image) {
    const bytes = new Uint8Array(await options.image.arrayBuffer());
    let image;
    if (options.image.type === 'image/jpeg') image = await document.embedJpg(bytes);
    else image = await document.embedPng(bytes);
    const scale = Math.min((options.width ?? 170) / image.width, 80 / image.height);
    page.drawImage(image, { x, y, width: image.width * scale, height: image.height * scale });
  } else if (options.text?.trim()) {
    const font = await document.embedFont(StandardFonts.TimesRomanItalic);
    page.drawText(options.text, { x, y, size: 28, font, color: rgb(0.13, 0.16, 0.34) });
  } else {
    throw new Error('Enter a signature or add an image.');
  }
  return document.save();
}

export async function createBlankPagePdf(input: Uint8Array): Promise<Uint8Array> {
  const document = await loadPdf(input);
  const page = document.getPages()[0];
  const size = page.getSize();
  document.insertPage(0, [size.width, size.height]);
  return document.save();
}
