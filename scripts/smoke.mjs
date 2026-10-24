#!/usr/bin/env node
/* global caches, console, document, HTMLCanvasElement, Image, navigator */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import process from 'node:process';
import { TextEncoder } from 'node:util';
import { URL } from 'node:url';
import { chromium } from '/home/ubuntu/rea/node_modules/playwright-core/index.mjs';
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import JSZip from 'jszip';

const baseUrl = process.env.DOCUMAX_SMOKE_URL ?? 'http://127.0.0.1:4173';
const screenshotDir = process.env.DOCUMAX_SHOTS_DIR ?? '/home/ubuntu/fily-shots';
const qrValue = 'DOCUMAX-QR-137';
const userPassword = 'smoke-user';
const ownerPassword = 'smoke-owner';
mkdirSync(screenshotDir, { recursive: true });

const catalog = readFileSync(new URL('../src/catalog.ts', import.meta.url), 'utf8');
const slugs = [...catalog.matchAll(/\{\s*slug:\s*'([^']+)'/g)].map((match) => match[1]);

function makePdf(label, pageCount = 2) {
  return (async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    for (let index = 0; index < pageCount; index += 1) {
      const page = document.addPage([595, 842]);
      page.drawText(`${label} - page ${index + 1}`, { x: 58, y: 760, size: 24, font, color: rgb(0.08, 0.12, 0.2) });
      page.drawText('Readable sample document for browser smoke testing.', { x: 58, y: 716, size: 13, font });
      page.drawText(`Unique content: ${label.toUpperCase()}`, { x: 58, y: 680, size: 15, font });
    }
    return Buffer.from(await document.save());
  })();
}

async function makeFormPdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([595, 842]);
  const form = document.getForm();
  form.createTextField('student_name').addToPage(page, { x: 64, y: 710, width: 260, height: 32 });
  return Buffer.from(await document.save());
}

async function makeProtectedPdf() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([595, 842]);
  page.drawText('Protected smoke fixture', { x: 58, y: 760, size: 24, font });
  page.drawText('This PDF has a user password.', { x: 58, y: 716, size: 13, font });
  document.encrypt({ userPassword, ownerPassword });
  return Buffer.from(await document.save());
}

function gfTables() {
  const exponent = new Uint8Array(512);
  const logarithm = new Uint8Array(256);
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    exponent[index] = value;
    logarithm[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let index = 255; index < exponent.length; index += 1) exponent[index] = exponent[index - 255];
  return { exponent, logarithm };
}

function qrMatrix(text) {
  const { exponent, logarithm } = gfTables();
  const multiply = (left, right) => left && right ? exponent[logarithm[left] + logarithm[right]] : 0;
  const appendBits = (bits, value, length) => {
    for (let bit = length - 1; bit >= 0; bit -= 1) bits.push((value >>> bit) & 1);
  };
  const bytes = [...new TextEncoder().encode(text)];
  assert.ok(bytes.length <= 17, 'Smoke QR payload must fit QR version 1-L byte mode');
  const bits = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  bytes.forEach((byte) => appendBits(bits, byte, 8));
  appendBits(bits, 0, Math.min(4, 152 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let index = 0; index < bits.length; index += 8) {
    data.push(bits.slice(index, index + 8).reduce((value, bit) => (value << 1) | bit, 0));
  }
  for (let pad = 0; data.length < 19; pad += 1) data.push(pad % 2 ? 0x11 : 0xec);

  let generator = [1];
  for (let index = 0; index < 7; index += 1) {
    const next = Array(generator.length + 1).fill(0);
    generator.forEach((coefficient, position) => {
      next[position] ^= coefficient;
      next[position + 1] ^= multiply(coefficient, exponent[index]);
    });
    generator = next;
  }
  const remainder = Array(7).fill(0);
  data.forEach((byte) => {
    const factor = byte ^ remainder.shift();
    remainder.push(0);
    for (let index = 0; index < 7; index += 1) remainder[index] ^= multiply(generator[index + 1], factor);
  });
  const codewords = [...data, ...remainder];
  const codeBits = codewords.flatMap((byte) => Array.from({ length: 8 }, (_, index) => (byte >>> (7 - index)) & 1));

  const size = 21;
  const matrix = Array.from({ length: size }, () => Array(size).fill(null));
  const set = (row, column, value) => { matrix[row][column] = value; };
  const finder = (top, left) => {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const row = top + dy;
        const column = left + dx;
        if (row < 0 || row >= size || column < 0 || column >= size) continue;
        const inFinder = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        set(row, column, inFinder && (
          dx === 0 || dx === 6 || dy === 0 || dy === 6 ||
          (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4)
        ));
      }
    }
  };
  finder(0, 0);
  finder(0, 14);
  finder(14, 0);
  for (let index = 8; index < size - 8; index += 1) {
    set(6, index, index % 2 === 0);
    set(index, 6, index % 2 === 0);
  }
  for (let index = 0; index <= 5; index += 1) set(index, 8, false);
  set(7, 8, false);
  set(8, 8, false);
  set(8, 7, false);
  for (let index = 9; index < 15; index += 1) set(8, 14 - index, false);
  for (let index = 0; index < 8; index += 1) set(8, size - 1 - index, false);
  for (let index = 8; index < 15; index += 1) set(size - 15 + index, 8, false);
  set(size - 8, 8, false);

  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let offset = 0; offset < size; offset += 1) {
      const row = upward ? size - 1 - offset : offset;
      for (let column = right; column >= right - 1; column -= 1) {
        if (matrix[row][column] !== null) continue;
        const bit = codeBits[bitIndex++] ?? 0;
        set(row, column, bit ^ Number((row + column) % 2 === 0));
      }
    }
    upward = !upward;
  }
  assert.equal(bitIndex, 208, 'QR version 1 must have exactly 208 data modules');

  const formatData = 0b01000;
  let formatRemainder = formatData << 10;
  for (let bit = 14; bit >= 10; bit -= 1) {
    if (formatRemainder & (1 << bit)) formatRemainder ^= 0x537 << (bit - 10);
  }
  const format = ((formatData << 10) | formatRemainder) ^ 0x5412;
  const formatBit = (index) => Boolean((format >>> index) & 1);
  for (let index = 0; index <= 5; index += 1) set(index, 8, formatBit(index));
  set(7, 8, formatBit(6));
  set(8, 8, formatBit(7));
  set(8, 7, formatBit(8));
  for (let index = 9; index < 15; index += 1) set(8, 14 - index, formatBit(index));
  for (let index = 0; index < 8; index += 1) set(8, size - 1 - index, formatBit(index));
  for (let index = 8; index < 15; index += 1) set(size - 15 + index, 8, formatBit(index));
  set(size - 8, 8, true);
  return matrix;
}

function filePayload(name, mimeType, buffer) {
  return { name, mimeType, buffer };
}

async function createImageFixtures(page) {
  const makePhoto = async (label, accent) => {
    const dataUrl = await page.evaluate(({ label: imageLabel, accent: imageAccent }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 1000;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not create the smoke image canvas.');
      context.fillStyle = '#66717c';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.shadowColor = '#28313a';
      context.shadowBlur = 24;
      context.shadowOffsetX = 8;
      context.shadowOffsetY = 12;
      context.beginPath();
      context.moveTo(116, 90);
      context.lineTo(690, 138);
      context.lineTo(640, 915);
      context.lineTo(84, 855);
      context.closePath();
      context.fillStyle = '#fffef7';
      context.fill();
      context.shadowColor = 'transparent';
      context.strokeStyle = '#f2f1e8';
      context.lineWidth = 5;
      context.stroke();
      context.save();
      context.translate(135, 225);
      context.transform(0.94, 0.05, -0.035, 1, 0, 0);
      context.fillStyle = imageAccent;
      context.font = 'bold 38px Arial, sans-serif';
      context.fillText(imageLabel, 0, 0);
      context.fillStyle = '#253141';
      context.font = 'bold 28px Arial, sans-serif';
      context.fillText('DOCUMAX SMOKE TEST', 0, 95);
      context.font = '24px Arial, sans-serif';
      context.fillText('Student document page', 0, 150);
      context.fillText('Sample text for local processing', 0, 195);
      context.fillText('No files are uploaded', 0, 240);
      context.strokeStyle = '#647182';
      context.lineWidth = 4;
      for (let line = 0; line < 7; line += 1) {
        context.beginPath();
        context.moveTo(0, 310 + line * 48);
        context.lineTo(430 - line * 12, 310 + line * 48);
        context.stroke();
      }
      context.restore();
      return canvas.toDataURL('image/png');
    }, { label, accent });
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  };

  const photo = await makePhoto('SCAN SAMPLE', '#243f77');
  const front = await makePhoto('STUDENT ID FRONT', '#263c6b');
  const back = await makePhoto('STUDENT ID BACK', '#4b4024');
  const toJpegDataUrl = async (pngBytes) => page.evaluate(async (pngBase64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${pngBase64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')?.drawImage(image, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.92);
  }, pngBytes.toString('base64'));
  const photoJpgDataUrl = await toJpegDataUrl(photo);
  const backJpgDataUrl = await toJpegDataUrl(back);
  const qrDataUrl = await page.evaluate((matrix) => {
    const moduleSize = 16;
    const quietZone = 4;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = (matrix.length + quietZone * 2) * moduleSize;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create the QR fixture canvas.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000';
    matrix.forEach((row, rowIndex) => row.forEach((dark, columnIndex) => {
      if (dark) context.fillRect((columnIndex + quietZone) * moduleSize, (rowIndex + quietZone) * moduleSize, moduleSize, moduleSize);
    }));
    return canvas.toDataURL('image/png');
  }, qrMatrix(qrValue));
  const png = (name, data) => filePayload(name, 'image/png', data);
  return {
    photo: png('scan-photo.png', photo),
    front: png('id-front.png', front),
    back: filePayload('id-back.jpg', 'image/jpeg', Buffer.from(backJpgDataUrl.split(',')[1], 'base64')),
    jpg: filePayload('scan-photo.jpg', 'image/jpeg', Buffer.from(photoJpgDataUrl.split(',')[1], 'base64')),
    qr: png('qr-code.png', Buffer.from(qrDataUrl.split(',')[1], 'base64')),
  };
}

async function makeDocx(imageBytes) {
  const document = new Document({
    sections: [{
      children: [
        new Paragraph({ text: 'Smoke test heading', heading: HeadingLevel.HEADING_1 }),
        new Paragraph('A representative paragraph with readable text.'),
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun('A smoke test list item')] }),
        new Table({ rows: [new TableRow({ children: [
          new TableCell({ children: [new Paragraph('Student')] }),
          new TableCell({ children: [new Paragraph('Document')] }),
        ] })] }),
        new Paragraph({ children: [new ImageRun({ data: imageBytes, type: 'png', transformation: { width: 120, height: 80 } })] }),
      ],
    }],
  });
  return Buffer.from(await Packer.toBuffer(document));
}

const expectedPages = {
  'scan-to-pdf': 1,
  'id-card': 1,
  merge: 4,
  split: 1,
  organize: 2,
  rotate: 2,
  'remove-pages': 1,
  'extract-pages': 1,
  compress: 2,
  crop: 2,
  'jpg-to-pdf': 2,
  'watermark': 2,
  'page-numbers': 2,
  'sign': 2,
  'edit-pdf': 2,
  redact: 2,
  'fill-forms': 1,
  protect: 1,
  unlock: 1,
  'word-to-pdf': 1,
};

function buildFixtures(images, pdf, secondPdf, formPdf, protectedPdf, docx) {
  return {
    'scan-to-pdf': [images.photo],
    'id-card': [images.front, images.back],
    ocr: [images.photo],
    'qr-scanner': [images.qr],
    merge: [pdf, secondPdf],
    split: [pdf],
    organize: [pdf],
    rotate: [pdf],
    'remove-pages': [pdf],
    'extract-pages': [pdf],
    compress: [pdf],
    crop: [pdf],
    'jpg-to-pdf': [images.photo, images.jpg],
    'pdf-to-jpg': [pdf],
    'pdf-to-text': [pdf],
    'pdf-to-markdown': [pdf],
    'pdf-to-word': [pdf],
    'word-to-pdf': [docx],
    watermark: [pdf],
    'page-numbers': [pdf],
    sign: [pdf],
    'edit-pdf': [pdf],
    redact: [pdf],
    'fill-forms': [formPdf],
    compare: [pdf, secondPdf],
    protect: [pdf],
    unlock: [protectedPdf],
  };
}

async function validateArtifact(download, slug) {
  const path = await download.path();
  assert.ok(path, `${slug}: browser did not provide the downloaded file path`);
  const stat = statSync(path);
  assert.ok(stat.size > 0, `${slug}: downloaded file is empty`);
  const bytes = readFileSync(path);
  const name = download.suggestedFilename().toLowerCase();

  if (name.endsWith('.pdf')) {
    const options = slug === 'protect' ? { password: userPassword } : {};
    const document = await PDFDocument.load(new Uint8Array(bytes), options);
    assert.equal(document.getPageCount(), expectedPages[slug], `${slug}: unexpected PDF page count`);
  } else if (name.endsWith('.zip')) {
    const archive = await JSZip.loadAsync(bytes);
    const files = Object.values(archive.files).filter((file) => !file.dir);
    assert.ok(files.length > 0, `${slug}: downloaded ZIP is empty`);
    const pdfFiles = files.filter((file) => file.name.toLowerCase().endsWith('.pdf'));
    if (expectedPages[slug] && expectedPages[slug] !== 1 && pdfFiles.length) {
      const output = await PDFDocument.load(await pdfFiles[0].async('uint8array'));
      assert.equal(output.getPageCount(), expectedPages[slug], `${slug}: unexpected PDF page count in ZIP`);
    }
    if (slug === 'pdf-to-jpg') {
      assert.equal(files.filter((file) => /\.jpe?g$/i.test(file.name)).length, 2, 'pdf-to-jpg: expected one JPG per page');
    }
    if (slug === 'pdf-to-word') assert.ok(archive.file('word/document.xml'), 'pdf-to-word: DOCX document XML is missing');
  } else if (expectedPages[slug]) {
    throw new Error(`${slug}: expected a PDF download, received ${name}`);
  }

  if (slug === 'qr-scanner') {
    assert.ok(bytes.toString('utf8').includes(qrValue), 'qr-scanner: decoded text did not match the QR fixture');
  }
  return stat.size;
}

async function uploadFixtures(page, slug, fixtures) {
  const files = fixtures[slug];
  assert.ok(files?.length, `${slug}: no fixture mapping was provided`);
  if (slug === 'scan-to-pdf') {
    await page.locator('input[type="file"]').first().setInputFiles(files);
    await page.getByRole('button', { name: 'Auto detect' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Auto detect' }).click();
    await page.getByRole('button', { name: 'B&W', exact: true }).click();
    return;
  }
  const input = page.locator('input[type="file"][aria-label^="Choose file for"]');
  await input.setInputFiles(files);
  await page.locator('.file-row').first().waitFor({ state: 'visible' });

  if (slug === 'fill-forms') {
    await page.getByLabel('student_name').fill('Smoke Student');
  }
  if (slug === 'protect') {
    await page.getByLabel('Opening password').fill(userPassword);
    await page.getByLabel('Owner password').fill(ownerPassword);
  }
  if (slug === 'unlock') await page.getByLabel('Current PDF password').fill(userPassword);
  if (slug === 'sign') {
    await page.getByLabel('Cursive signature name').fill('Smoke Student');
    await page.getByRole('button', { name: 'Place typed signature' }).click();
    await placeOnPage(page, slug);
  }
  if (slug === 'edit-pdf') {
    await page.getByLabel('Text to place').fill('Smoke annotation');
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await placeOnPage(page, slug);
  }
  if (slug === 'redact') await placeOnPage(page, slug);
}

async function placeOnPage(page, slug) {
  const surface = page.locator('.page-editor-surface');
  await surface.waitFor({ state: 'visible' });
  await page.locator('canvas.page-editor-pdf-canvas').waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas.page-editor-pdf-canvas');
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 500 || canvas.height < 500) return false;
    const context = canvas.getContext('2d');
    if (!context) return false;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 0; index < pixels.length; index += 16) {
      if (pixels[index] < 235 || pixels[index + 1] < 235 || pixels[index + 2] < 235) return true;
    }
    return false;
  }, undefined, { timeout: 30_000 });
  const canvasInfo = await page.locator('canvas.page-editor-pdf-canvas').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) return null;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonWhitePixels = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      if (pixels[index] < 235 || pixels[index + 1] < 235 || pixels[index + 2] < 235) nonWhitePixels += 1;
    }
    return { width: canvas.width, height: canvas.height, nonWhitePixels };
  });
  assert.ok(canvasInfo && canvasInfo.nonWhitePixels > 0, `${slug}: PDF page preview is blank`);
  const bounds = await surface.boundingBox();
  assert.ok(bounds && bounds.width > 0 && bounds.height > 0, `${slug}: page preview has no size`);
  await surface.click({ position: { x: bounds.width * 0.52, y: bounds.height * 0.48 } });
  await page.locator('[data-page-item]').waitFor({ state: 'visible' });
}

async function processAndDownload(page, slug) {
  const timeout = slug === 'ocr' ? 180_000 : 60_000;
  await page.locator('.process-row button').click();
  await page.waitForFunction(
    () => document.querySelector('.error-box') || document.querySelector('.result-panel'),
    undefined,
    { timeout },
  );
  const error = await page.locator('.error-box').textContent().catch(() => null);
  assert.equal(error, null, `${slug}: error banner: ${error}`);
  await page.locator('.download-link').first().waitFor({ state: 'visible', timeout });
  const downloadEvent = page.waitForEvent('download', { timeout });
  await page.locator('.download-link').first().click();
  const download = await downloadEvent;
  const size = await validateArtifact(download, slug);
  return { name: download.suggestedFilename(), size };
}

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:29229');
  const context = browser.contexts()[0];
  assert.ok(context, 'No browser context is available at the requested CDP endpoint');
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 1050 });
  page.setDefaultTimeout(25_000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const images = await createImageFixtures(page);
  const [pdf, secondPdf, formPdf, protectedPdf] = await Promise.all([
    makePdf('first document'),
    makePdf('second document'),
    makeFormPdf(),
    makeProtectedPdf(),
  ]);
  const docx = await makeDocx(images.photo.buffer);
  const fixtures = buildFixtures(
    images,
    filePayload('first.pdf', 'application/pdf', pdf),
    filePayload('second.pdf', 'application/pdf', secondPdf),
    filePayload('forms.pdf', 'application/pdf', formPdf),
    filePayload('protected.pdf', 'application/pdf', protectedPdf),
    filePayload('smoke.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx),
  );
  const missing = slugs.filter((slug) => !fixtures[slug]);
  const extra = Object.keys(fixtures).filter((slug) => !slugs.includes(slug));
  assert.deepEqual(missing, [], `Smoke fixtures are missing catalog routes: ${missing.join(', ')}`);
  assert.deepEqual(extra, [], `Smoke fixture map has unknown routes: ${extra.join(', ')}`);

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    await Promise.all((await navigator.serviceWorker?.getRegistrations() ?? []).map((registration) => registration.unregister()));
    await Promise.all((await caches?.keys() ?? []).map((key) => caches.delete(key)));
  });

  const results = [];
  for (const slug of slugs) {
    const errorsStart = { page: pageErrors.length, console: consoleErrors.length };
    let screenshotTaken = false;
    try {
      await page.goto(`${baseUrl}/tools/${slug}?smoke=${Date.now()}`, { waitUntil: 'domcontentloaded' });
      await page.locator('.tool-heading h1').waitFor({ state: 'visible' });
      await uploadFixtures(page, slug, fixtures);
      const download = await processAndDownload(page, slug);
      const newPageErrors = pageErrors.slice(errorsStart.page);
      const newConsoleErrors = consoleErrors.slice(errorsStart.console);
      assert.deepEqual(newPageErrors, [], `${slug}: browser page errors: ${newPageErrors.join(' | ')}`);
      assert.deepEqual(newConsoleErrors, [], `${slug}: browser console errors: ${newConsoleErrors.join(' | ')}`);
      const screenshot = `${screenshotDir}/${slug}.png`;
      await page.screenshot({ path: screenshot, fullPage: true });
      screenshotTaken = true;
      results.push({ slug, status: 'PASS', download: download.name, bytes: download.size, screenshot });
      console.log(`PASS ${slug}: ${download.name} (${download.size} bytes)`);
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      if (!screenshotTaken) {
        await page.screenshot({ path: `${screenshotDir}/${slug}.png`, fullPage: true }).catch(() => undefined);
      }
      results.push({ slug, status: 'FAIL', error: message, screenshot: `${screenshotDir}/${slug}.png` });
      console.error(`FAIL ${slug}: ${message}`);
    }
  }
  console.log(`\nScreenshots: ${screenshotDir}`);
  console.table(results.map(({ slug, status, download, bytes, error }) => ({ slug, status, download, bytes, error: error?.split('\n')[0] })));
  process.exit(results.some((result) => result.status === 'FAIL') ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
