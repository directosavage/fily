import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  Check,
  ChevronRight,
  CircleHelp,
  FileText,
  LoaderCircle,
  LockKeyhole,
  RotateCw,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import JSZip from 'jszip';
import { Link, useParams } from 'react-router';
import { tools } from '../catalog';
import {
  addIdCardPages,
  addPageNumbers,
  annotatePdf,
  cropPdf,
  extractPages,
  fillForm,
  getFormFields,
  loadPdf,
  mergePdfs,
  organizePdf,
  protectPdf,
  removePages,
  rotatePdf,
  signPdf,
  splitEveryPage,
  splitPdfByRanges,
  unlockPdf,
  watermarkPdf,
} from '../lib/pdf';
import type { Annotation, FormFieldInfo } from '../lib/pdf';
import { parsePageRanges } from '../lib/ranges';
import type { PdfArtifact } from '../lib/pdf';

const ScanTool = lazy(() => import('../tools/ScanTool'));

interface LocalFile {
  file: File;
  id: string;
}
interface ResultFile {
  name: string;
  blob: Blob;
}
interface ToolResult {
  files: ResultFile[];
  text?: string;
  note?: string;
}

interface Options {
  range: string;
  angle: '90' | '180' | '270';
  margin: number;
  pageSize: 'fit' | 'a4' | 'letter';
  quality: 'low' | 'medium' | 'high';
  text: string;
  fontSize: number;
  opacity: number;
  rotation: number;
  color: string;
  position: 'center' | 'top' | 'bottom' | 'tiled';
  pageFormat: 'n' | 'Page n of N';
  startNumber: number;
  password: string;
  flatten: boolean;
  everyPage: boolean;
  language: 'eng' | 'fil';
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  redact: boolean;
}

const initialOptions: Options = {
  range: '1',
  angle: '90',
  margin: 24,
  pageSize: 'a4',
  quality: 'medium',
  text: 'DocuMax',
  fontSize: 42,
  opacity: 0.18,
  rotation: -30,
  color: '#4f46e5',
  position: 'center',
  pageFormat: 'n',
  startNumber: 1,
  password: '',
  flatten: false,
  everyPage: false,
  language: 'eng',
  page: 1,
  x: 25,
  y: 35,
  width: 50,
  height: 15,
  redact: false,
};

const toolHelp: Record<string, string> = {
  'scan-to-pdf': 'Take photos with your camera or choose existing images. Reorder pages and adjust the crop before exporting.',
  'id-card': 'Select the front and back photos in that order. Both sides will be centered on one A4 page.',
  ocr: 'OCR uses on-device Tesseract language data. The first recognition may take a moment while the language model loads.',
  'qr-scanner': 'BarcodeDetector availability depends on your browser. This tool does not send photos anywhere.',
  compress: 'Compression rasterizes pages to JPEG images. Text selection and vectors are not preserved; the original is kept if the compressed output is larger.',
  redact: 'Redaction rasterizes every page and paints selected areas black. Text and graphics beneath those areas are removed from the output.',
  'pdf-to-word': 'Text is extracted page by page into editable paragraphs. Original layout and images are not preserved.',
  'fill-forms': 'This tool supports common AcroForm text, checkbox, dropdown, and radio fields. XFA forms are not supported.',
  unlock: 'The Cantoo PDF library opens supported encrypted PDFs with a password, then saves a decrypted copy.',
  'edit-pdf': 'Add a text label, outline, or highlight to the first page. Coordinates are entered in PDF points from the lower-left corner.',
  sign: 'Type your signature or choose a PNG/JPG signature image. The signature is placed on the first page.',
  crop: 'The same margin is removed from the visible content area on every page.',
};

export default function ToolPage() {
  const { slug = '' } = useParams();
  const tool = tools.find((candidate) => candidate.slug === slug);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [signature, setSignature] = useState<File | null>(null);
  const [options, setOptions] = useState<Options>(initialOptions);
  const [formFields, setFormFields] = useState<FormFieldInfo[]>([]);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [deletedPages, setDeletedPages] = useState<number[]>([]);
  const [pageRotations, setPageRotations] = useState<Record<number, number>>({});
  const [pageThumbnails, setPageThumbnails] = useState<string[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ToolResult | null>(null);

  const accept = tool?.accepts === 'pdf' || tool?.accepts === 'two-pdfs' ? '.pdf,application/pdf' :
    tool?.accepts === 'image' || tool?.accepts === 'two-images' ? 'image/*' : '.pdf,application/pdf,image/*';
  const multiple = !!tool && (tool.multiple || tool.accepts === 'two-images' || tool.accepts === 'two-pdfs');

  useEffect(() => {
    setFiles([]);
    setSignature(null);
    setOptions({ ...initialOptions, range: slug === 'rotate' ? '' : initialOptions.range });
    setFormFields([]);
    setFormValues({});
    setPageOrder([]);
    setDeletedPages([]);
    setPageRotations({});
    setPageThumbnails([]);
    setPageCount(0);
    setError('');
    setResult(null);
  }, [slug]);

  useEffect(() => () => pageThumbnails.forEach((url) => URL.revokeObjectURL(url)), [pageThumbnails]);

  const updateOption = <Key extends keyof Options>(key: Key, value: Options[Key]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };

  const prepareFiles = async (selected: FileList | File[]) => {
    if (!tool) return;
    const incoming = Array.from(selected);
    const valid = incoming.filter((file) => {
      if (tool.accepts === 'pdf' || tool.accepts === 'two-pdfs') return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (tool.accepts === 'image' || tool.accepts === 'two-images') return file.type.startsWith('image/');
      return file.type.startsWith('image/') || file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    });
    if (!valid.length) {
      setError(tool.accepts.includes('pdf') ? 'Choose a PDF file to continue.' : 'Choose a supported image file to continue.');
      return;
    }
    if (valid.length !== incoming.length) setError('Some files were skipped because they do not match this tool.');
    else setError('');
    const limited = multiple ? valid : valid.slice(0, 1);
    const mapped = limited.map((file) => ({ file, id: crypto.randomUUID() }));
    setFiles((current) => multiple ? [...current, ...mapped] : mapped);
    setResult(null);
    if (tool.slug === 'organize' || tool.slug === 'fill-forms') {
      try {
        const bytes = new Uint8Array(await limited[0].arrayBuffer());
        const document = await loadPdf(bytes);
        if (tool.slug === 'organize') {
          setPageCount(document.getPageCount());
          setPageOrder(document.getPageIndices());
          const { renderPdfPages } = await import('../lib/pdf-render');
          const previews = await renderPdfPages(bytes, { scale: 0.28, quality: 0.48 });
          setPageThumbnails(previews.map((page) => URL.createObjectURL(page.blob)));
        } else {
          const fields = await getFormFields(bytes);
          setFormFields(fields);
          setFormValues(Object.fromEntries(fields.map((field) => [field.name, field.value])));
          setPageCount(document.getPageCount());
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'This PDF could not be opened.');
      }
    }
  };

  const removeFile = (id: string) => {
    setFiles((current) => current.filter((item) => item.id !== id));
    setResult(null);
  };

  const moveFile = (index: number, by: -1 | 1) => {
    setFiles((current) => {
      const target = index + by;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const process = async () => {
    if (!tool || !files.length) return;
    setBusy(true);
    setProgress(4);
    setError('');
    setResult(null);
    try {
      const bytes = await Promise.all(files.map(async ({ file }) => new Uint8Array(await file.arrayBuffer())));
      const output: ResultFile[] = [];
      let text: string | undefined;
      let note: string | undefined;
      const primary = bytes[0];
      const pdfBlob = (data: Uint8Array, name = 'documax-output.pdf') =>
        output.push({ name, blob: new Blob([data], { type: 'application/pdf' }) });
      const textBlob = (data: string, name = 'documax-output.txt') =>
        output.push({ name, blob: new Blob([data], { type: 'text/plain' }) });

      if (slug === 'merge') {
        pdfBlob(await mergePdfs(bytes), 'merged-document.pdf');
      } else if (slug === 'split') {
        const parts: PdfArtifact[] = options.everyPage ? await splitEveryPage(primary) : await splitPdfByRanges(primary, options.range);
        for (const part of parts) output.push({ name: part.name, blob: new Blob([part.bytes], { type: 'application/pdf' }) });
      } else if (slug === 'organize') {
        let organized = await organizePdf(primary, pageOrder, deletedPages, pageRotations);
        if (options.redact) organized = await (await import('../lib/pdf')).createBlankPagePdf(organized);
        pdfBlob(organized, 'organized-document.pdf');
      } else if (slug === 'rotate') {
        const document = await loadPdf(primary);
        const selection = options.range.trim() ? parsePageRanges(options.range, document.getPageCount()) : undefined;
        pdfBlob(await rotatePdf(primary, selection, Number(options.angle) as 90 | 180 | 270), 'rotated-document.pdf');
      } else if (slug === 'remove-pages') {
        const document = await loadPdf(primary);
        pdfBlob(await removePages(primary, parsePageRanges(options.range, document.getPageCount())), 'pages-removed.pdf');
      } else if (slug === 'extract-pages') {
        pdfBlob(await extractPages(primary, options.range), 'extracted-pages.pdf');
      } else if (slug === 'crop') {
        pdfBlob(await cropPdf(primary, options.margin), 'cropped-document.pdf');
      } else if (slug === 'compress') {
        const { compressPdf } = await import('../lib/pdf-render');
        const compressed = await compressPdf(primary, options.quality);
        const keptOriginal = compressed.byteLength >= primary.byteLength;
        pdfBlob(keptOriginal ? primary : compressed, keptOriginal ? 'original-kept.pdf' : 'compressed-document.pdf');
        note = `Original: ${formatBytes(primary.byteLength)} · Result: ${formatBytes(keptOriginal ? primary.byteLength : compressed.byteLength)}${keptOriginal ? ' (the original was smaller, so it was kept).' : ''}`;
      } else if (slug === 'jpg-to-pdf') {
        const { imagesToPdf } = await import('../lib/images');
        pdfBlob(await imagesToPdf(files.map(({ file }) => file), options.pageSize, options.margin), 'images.pdf');
      } else if (slug === 'id-card') {
        if (files.length < 2) throw new Error('Choose the front image and back image of the card.');
        pdfBlob(await addIdCardPages(files[0].file, files[1].file), 'id-card.pdf');
      } else if (slug === 'pdf-to-jpg') {
        const { renderPdfPages } = await import('../lib/pdf-render');
        const pages = await renderPdfPages(primary, { scale: options.quality === 'high' ? 2 : options.quality === 'low' ? 0.9 : 1.4 });
        if (pages.length === 1) output.push({ name: 'page-1.jpg', blob: pages[0].blob });
        else {
          const zip = new JSZip();
          pages.forEach((page) => zip.file(`page-${page.page}.jpg`, page.blob));
          output.push({ name: 'pdf-pages.zip', blob: await zip.generateAsync({ type: 'blob' }) });
        }
      } else if (slug === 'pdf-to-text' || slug === 'pdf-to-markdown') {
        const { extractPdfText, pdfPagesToMarkdown, pdfPagesToText } = await import('../lib/pdf-render');
        const pages = await extractPdfText(primary);
        text = slug === 'pdf-to-markdown' ? pdfPagesToMarkdown(pages) : pdfPagesToText(pages);
        textBlob(text, slug === 'pdf-to-markdown' ? 'document.md' : 'document.txt');
      } else if (slug === 'pdf-to-word') {
        const { pdfToDocx } = await import('../lib/pdf-render');
        output.push({ name: 'document.docx', blob: await pdfToDocx(primary) });
      } else if (slug === 'watermark') {
        pdfBlob(await watermarkPdf(primary, {
          text: options.text,
          fontSize: options.fontSize,
          opacity: options.opacity,
          rotation: options.rotation,
          color: options.color,
          position: options.position,
        }), 'watermarked.pdf');
      } else if (slug === 'page-numbers') {
        pdfBlob(await addPageNumbers(primary, { start: options.startNumber, format: options.pageFormat, position: options.position === 'top' ? 'top' : 'bottom' }), 'numbered-pages.pdf');
      } else if (slug === 'protect') {
        pdfBlob(await protectPdf(primary, options.password), 'protected.pdf');
      } else if (slug === 'unlock') {
        pdfBlob(await unlockPdf(primary, options.password), 'unlocked.pdf');
      } else if (slug === 'fill-forms') {
        pdfBlob(await fillForm(primary, formValues, options.flatten), 'filled-form.pdf');
      } else if (slug === 'edit-pdf') {
        const annotationType = options.position === 'top' ? 'rectangle' : options.position === 'tiled' ? 'highlight' : 'text';
        const annotation: Annotation = {
          page: Math.max(0, options.page - 1),
          type: annotationType,
          x: options.x,
          y: options.y,
          width: options.width * 5,
          height: options.height * 5,
          text: options.text,
          color: options.color,
        };
        pdfBlob(await annotatePdf(primary, [annotation]), 'edited-document.pdf');
      } else if (slug === 'sign') {
        const signatureFile = signature
          ? new Blob([signature], { type: signature.type })
          : undefined;
        pdfBlob(await signPdf(primary, { text: options.text, image: signatureFile }), 'signed-document.pdf');
      } else if (slug === 'redact') {
        const { redactPdf } = await import('../lib/pdf-render');
        const document = await loadPdf(primary);
        if (options.page < 1 || options.page > document.getPageCount()) {
          throw new Error(`Choose a page between 1 and ${document.getPageCount()}.`);
        }
        const x = Math.max(0, Math.min(0.99, options.x / 100));
        const y = Math.max(0, Math.min(0.99, options.y / 100));
        const boxes = [{
          page: options.page - 1,
          x,
          y,
          width: Math.max(0.01, Math.min(1 - x, options.width / 100)),
          height: Math.max(0.01, Math.min(1 - y, options.height / 100)),
        }];
        pdfBlob(await redactPdf(primary, boxes), 'redacted-rasterized.pdf');
        note = 'This PDF has been rasterized. Content underneath the black box is not present in the output.';
      } else if (slug === 'ocr') {
        const { recognizeText } = await import('../lib/ocr');
        const chunks: string[] = [];
        for (let index = 0; index < files.length; index += 1) {
          const file = files[index].file;
          if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            const { renderPdfPages } = await import('../lib/pdf-render');
            const pages = await renderPdfPages(bytes[index], { scale: 1.5 });
            for (const page of pages) chunks.push(await recognizeText(page.blob, options.language, (value) => setProgress(15 + Math.round(value * 70))));
          } else {
            chunks.push(await recognizeText(file, options.language, (value) => setProgress(15 + Math.round(value * 70))));
          }
        }
        text = chunks.join('\n\n');
        textBlob(text, 'recognized-text.txt');
      } else if (slug === 'qr-scanner') {
        const { scanBarcode } = await import('../lib/images');
        const codes = await scanBarcode(files[0].file);
        if (!codes.length) throw new Error('No QR code was found in this image.');
        text = codes.map(({ format, rawValue }) => `${format}: ${rawValue}`).join('\n');
        textBlob(text, 'qr-code.txt');
      } else if (slug === 'compare') {
        if (files.length < 2) throw new Error('Choose two PDFs to compare.');
        const { extractPdfText } = await import('../lib/pdf-render');
        const [left, right] = await Promise.all([extractPdfText(bytes[0]), extractPdfText(bytes[1])]);
        const pageTotal = Math.max(left.length, right.length);
        const changes: string[] = [];
        for (let pageIndex = 0; pageIndex < pageTotal; pageIndex += 1) {
          const first = left[pageIndex]?.lines.map((line) => line.text) ?? [];
          const second = right[pageIndex]?.lines.map((line) => line.text) ?? [];
          const diff = Array.from({ length: Math.max(first.length, second.length) }, (_, index) => {
            const before = first[index] ?? '';
            const after = second[index] ?? '';
            if (before === after) return before ? `  ${before}` : '';
            return `${before ? `- ${before}\n` : ''}${after ? `+ ${after}` : ''}`;
          }).filter(Boolean);
          if (diff.length) changes.push(`Page ${pageIndex + 1}\n${diff.join('\n')}`);
        }
        text = changes.join('\n\n') || 'No text differences found.';
        textBlob(text, 'pdf-comparison.txt');
      } else {
        throw new Error('This tool is not available yet.');
      }
      setProgress(100);
      setResult({ files: output, text, note });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The document could not be processed. Try another file.');
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    setFiles([]);
    setSignature(null);
    setOptions({ ...initialOptions, range: slug === 'rotate' ? '' : initialOptions.range });
    setFormFields([]);
    setFormValues({});
    setPageOrder([]);
    setDeletedPages([]);
    setPageRotations({});
    setPageThumbnails([]);
    setPageCount(0);
    setError('');
    setResult(null);
  };

  if (slug === 'scan-to-pdf') {
    const ScanIcon = tools.find((entry) => entry.slug === slug)?.icon ?? FileText;
    return (
      <div className="tool-page">
        <Breadcrumb name="Scan to PDF" />
        <ToolHeading name="Scan to PDF" description="Capture paper, refine each page, and export your finished document." icon={<ScanIcon size={21} />} />
        <Suspense fallback={<div className="loading-state"><LoaderCircle className="spin" />Loading scanner…</div>}>
          <ScanTool />
        </Suspense>
      </div>
    );
  }

  if (!tool) return <div className="tool-page"><Link to="/" className="secondary-button"><ArrowLeft size={15} /> Back to all tools</Link></div>;
  const Icon = tool.icon;
  return (
    <div className="tool-page">
      <Breadcrumb name={tool.name} />
      <ToolHeading name={tool.name} description={tool.description} icon={<Icon size={21} />} />
      <section className="tool-card-panel">
        <Dropzone
          accept={accept}
          multiple={multiple}
          dragging={dragging}
          onDragChange={setDragging}
          onFiles={prepareFiles}
          toolName={tool.name}
        />
        {!!files.length && (
          <div className="file-list">
            {files.map(({ file, id }, index) => (
              <div className="file-row" key={id}>
                <FileText size={17} />
                <div className="file-row-name"><strong>{file.name}</strong><span>{formatBytes(file.size)}</span></div>
                {multiple && <button className="icon-button" type="button" aria-label={`Move ${file.name} up`} onClick={() => moveFile(index, -1)}><ArrowDown className="flip-vertical" size={14} /></button>}
                {multiple && <button className="icon-button" type="button" aria-label={`Move ${file.name} down`} onClick={() => moveFile(index, 1)}><ArrowDown size={14} /></button>}
                <button className="icon-button" type="button" aria-label={`Remove ${file.name}`} onClick={() => removeFile(id)}><X size={15} /></button>
              </div>
            ))}
          </div>
        )}
        {toolHelp[slug] && <div className="info-box" style={{ marginTop: 12 }}><CircleHelp size={14} />{toolHelp[slug]}</div>}

        {slug === 'organize' && pageOrder.length > 0 && (
          <div className="options-section">
            <div className="options-title">Page order <span className="page-count">({pageCount} pages)</span></div>
            <div className="organize-pages">
              {pageOrder.map((page, index) => (
                <div className={`organize-page ${deletedPages.includes(page) ? 'removed' : ''}`} key={`${page}-${index}`}>
                  <span className="page-count">{index + 1}</span>
                  {pageThumbnails[page] && <img src={pageThumbnails[page]} alt={`Preview of page ${page + 1}`} />}
                  <strong>PDF page {page + 1} {pageRotations[page] ? `· ${pageRotations[page]}°` : ''}</strong>
                  <button className="icon-button" type="button" aria-label={`Move page ${page + 1} up`} onClick={() => movePage(index, -1, pageOrder, setPageOrder)}><ArrowDown className="flip-vertical" size={14} /></button>
                  <button className="icon-button" type="button" aria-label={`Move page ${page + 1} down`} onClick={() => movePage(index, 1, pageOrder, setPageOrder)}><ArrowDown size={14} /></button>
                  <button className="icon-button" type="button" aria-label={`Rotate page ${page + 1}`} onClick={() => setPageRotations((current) => ({ ...current, [page]: ((current[page] ?? 0) + 90) % 360 }))}><RotateCw size={14} /></button>
                  <button className="icon-button" type="button" aria-label={`Toggle page ${page + 1}`} onClick={() => setDeletedPages((current) => current.includes(page) ? current.filter((item) => item !== page) : [...current, page])}><X size={14} /></button>
                </div>
              ))}
            </div>
            <label className="check-field" style={{ marginTop: 10 }}><input type="checkbox" checked={options.redact} onChange={(event) => updateOption('redact', event.target.checked)} /> Insert a blank page at the beginning</label>
          </div>
        )}
        {slug === 'fill-forms' && formFields.length > 0 && (
          <div className="options-section">
            <div className="options-title">Form fields <span className="page-count">({formFields.length})</span></div>
            <div className="form-fields">
              {formFields.map((field) => (
                <div className="form-field-row" key={field.name}>
                  <label htmlFor={`field-${field.name}`}>{field.name}</label>
                  {field.type === 'checkbox' ? (
                    <input id={`field-${field.name}`} type="checkbox" checked={formValues[field.name] === 'true'} onChange={(event) => setFormValues((current) => ({ ...current, [field.name]: String(event.target.checked) }))} />
                  ) : (
                    <input id={`field-${field.name}`} value={formValues[field.name] ?? ''} onChange={(event) => setFormValues((current) => ({ ...current, [field.name]: event.target.value }))} />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {slug === 'sign' && (
          <div className="options-section">
            <div className="options-title">Signature</div>
            <div className="option-grid">
              <Field label="Type your name" value={options.text} onChange={(value) => updateOption('text', value)} />
              <div className="field"><label htmlFor="signature-image">Or add a signature image</label><input id="signature-image" type="file" accept="image/png,image/jpeg" onChange={(event) => setSignature(event.target.files?.[0] ?? null)} /></div>
            </div>
          </div>
        )}
        {slug !== 'organize' && slug !== 'fill-forms' && slug !== 'sign' && (
          <ToolOptions slug={slug} options={options} updateOption={updateOption} />
        )}
        {slug === 'fill-forms' && <div className="options-section"><label className="check-field"><input type="checkbox" checked={options.flatten} onChange={(event) => updateOption('flatten', event.target.checked)} /> Flatten the fields after filling</label></div>}
        {slug === 'sign' && <div className="options-section"><div className="info-box"><ShieldCheck size={14} /> Signature is added to the first page of the PDF.</div></div>}
        {error && <div className="error-box"><X size={15} /> {error}</div>}
        <div className="process-row">
          <span className="privacy-note"><ShieldCheck size={14} /> Files never leave this device</span>
          <button className="primary-button" type="button" disabled={!files.length || busy} onClick={process}>
            {busy ? <><LoaderCircle className="spin" size={15} /> Processing…</> : <><LockKeyhole size={14} /> Process document <ChevronRight size={15} /></>}
          </button>
        </div>
        {busy && <div className="progress-wrap"><div className="progress-caption"><span>Working in your browser</span><span>{progress}%</span></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></div>}
      </section>
      {result && <ResultPanel result={result} onStartOver={startOver} />}
    </div>
  );
}

function movePage(
  index: number,
  direction: -1 | 1,
  order: number[],
  setOrder: Dispatch<SetStateAction<number[]>>,
) {
  const target = index + direction;
  if (target < 0 || target >= order.length) return;
  setOrder((current) => {
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
}

function Breadcrumb({ name }: { name: string }) {
  return <div className="breadcrumb"><Link to="/">Tools</Link><ChevronRight size={13} /><span>{name}</span></div>;
}

function ToolHeading({ name, description, icon }: { name: string; description: string; icon: ReactNode }) {
  return <div className="tool-heading"><span className="tool-heading-icon">{icon}</span><div><h1>{name}</h1><p>{description}</p></div></div>;
}

function Dropzone({
  accept,
  multiple,
  dragging,
  onDragChange,
  onFiles,
  toolName,
}: {
  accept: string;
  multiple: boolean;
  dragging: boolean;
  onDragChange: (value: boolean) => void;
  onFiles: (files: FileList | File[]) => void;
  toolName: string;
}) {
  return (
    <label
      className={`dropzone ${dragging ? 'dragging' : ''}`}
      onDragOver={(event) => { event.preventDefault(); onDragChange(true); }}
      onDragLeave={() => onDragChange(false)}
      onDrop={(event) => { event.preventDefault(); onDragChange(false); onFiles(event.dataTransfer.files); }}
    >
      <span className="dropzone-icon"><Upload size={20} /></span>
      <strong>Drop files here or <em>browse</em></strong>
      <span>{multiple ? 'You can add more than one file' : `Choose a file to ${toolName.toLowerCase()}`}. Processing stays on your device.</span>
      <input type="file" accept={accept} multiple={multiple} onChange={(event) => event.target.files && onFiles(event.target.files)} aria-label={`Choose file for ${toolName}`} />
    </label>
  );
}

function ToolOptions({
  slug,
  options,
  updateOption,
}: {
  slug: string;
  options: Options;
  updateOption: <Key extends keyof Options>(key: Key, value: Options[Key]) => void;
}) {
  const optionFields: ReactNode[] = [];
  const field = (key: keyof Options, label: string, type: 'text' | 'number' | 'password' = 'text') => (
    <Field
      key={key}
      label={label}
      type={type}
      value={options[key] as string | number}
      onChange={(value) => updateOption(key, type === 'number' ? Number(value) as Options[typeof key] : value as Options[typeof key])}
    />
  );
  const select = <Key extends keyof Options>(key: Key, label: string, choices: Array<{ value: string; label: string }>) => (
    <div className="field" key={key}>
      <label htmlFor={`option-${key}`}>{label}</label>
      <select id={`option-${key}`} value={options[key] as string} onChange={(event) => updateOption(key, event.target.value as Options[Key])}>
        {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
      </select>
    </div>
  );

  if (slug === 'merge') optionFields.push(<div className="info-box" key="order"><ArrowDown size={14} />Files are merged in the order shown. Use the arrows beside each file to rearrange them.</div>);
  if (slug === 'split' || slug === 'extract-pages' || slug === 'remove-pages' || slug === 'rotate') {
    optionFields.push(field('range', slug === 'rotate' ? 'Pages (leave blank to rotate all)' : 'Pages or ranges (example: 1-3, 5)'));
    if (slug === 'split') optionFields.push(
      <label className="check-field" key="every"><input type="checkbox" checked={options.everyPage} onChange={(event) => updateOption('everyPage', event.target.checked)} /> Split every page into its own file</label>,
    );
  }
  if (slug === 'rotate') optionFields.push(select('angle', 'Rotation', [{ value: '90', label: '90° clockwise' }, { value: '180', label: '180°' }, { value: '270', label: '270° clockwise' }]));
  if (slug === 'crop' || slug === 'jpg-to-pdf') {
    optionFields.push(field('margin', 'Margin (PDF points)', 'number'));
    if (slug === 'jpg-to-pdf') optionFields.push(select('pageSize', 'Page size', [{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'fit', label: 'Fit to image' }]));
  }
  if (slug === 'compress' || slug === 'pdf-to-jpg') {
    optionFields.push(select('quality', slug === 'compress' ? 'Compression level' : 'Image resolution', [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Balanced' }, { value: 'high', label: 'High' }]));
  }
  if (slug === 'watermark') {
    optionFields.push(field('text', 'Watermark text'));
    optionFields.push(field('fontSize', 'Font size', 'number'));
    optionFields.push(field('opacity', 'Opacity (0–1)', 'number'));
    optionFields.push(field('rotation', 'Rotation in degrees', 'number'));
    optionFields.push(field('color', 'Text color (hex)'));
    optionFields.push(select('position', 'Placement', [{ value: 'center', label: 'Center' }, { value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }, { value: 'tiled', label: 'Tiled' }]));
  }
  if (slug === 'page-numbers') {
    optionFields.push(select('pageFormat', 'Format', [{ value: 'n', label: '1, 2, 3…' }, { value: 'Page n of N', label: 'Page 1 of 5' }]));
    optionFields.push(field('startNumber', 'Start number', 'number'));
    optionFields.push(select('position', 'Position', [{ value: 'bottom', label: 'Bottom center' }, { value: 'top', label: 'Top center' }]));
  }
  if (slug === 'protect' || slug === 'unlock') optionFields.push(field('password', slug === 'protect' ? 'Opening password' : 'Current PDF password', 'password'));
  if (slug === 'ocr') optionFields.push(select('language', 'OCR language', [{ value: 'eng', label: 'English' }, { value: 'fil', label: 'Filipino' }]));
  if (slug === 'edit-pdf') {
    optionFields.push(field('text', 'Text to add'));
    optionFields.push(select('position', 'Annotation', [{ value: 'center', label: 'Text label' }, { value: 'top', label: 'Rectangle outline' }, { value: 'tiled', label: 'Highlight' }]));
    optionFields.push(field('color', 'Color (hex)'));
    optionFields.push(field('x', 'X position from left (pt)', 'number'));
    optionFields.push(field('y', 'Y position from bottom (pt)', 'number'));
    optionFields.push(field('width', 'Width (pt)', 'number'));
    optionFields.push(field('height', 'Height (pt)', 'number'));
  }
  if (slug === 'redact') {
    optionFields.push(field('page', 'Page to redact', 'number'));
    optionFields.push(field('x', 'Box left (%)', 'number'));
    optionFields.push(field('y', 'Box top (%)', 'number'));
    optionFields.push(field('width', 'Box width (%)', 'number'));
    optionFields.push(field('height', 'Box height (%)', 'number'));
  }

  if (!optionFields.length) return null;
  return <div className="options-section"><div className="options-title">Options</div><div className="option-grid">{optionFields}</div></div>;
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: 'text' | 'number' | 'password';
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function ResultPanel({ result, onStartOver }: { result: ToolResult; onStartOver: () => void }) {
  const zipMultiple = result.files.length > 1;
  const files = result.files;
  const [zipFile, setZipFile] = useState<ResultFile | null>(null);
  useEffect(() => {
    if (!zipMultiple) {
      setZipFile(null);
      return;
    }
    let alive = true;
    const zip = new JSZip();
    files.forEach((file) => zip.file(file.name, file.blob));
    void zip.generateAsync({ type: 'blob' }).then((blob) => {
      if (alive) setZipFile({ name: 'documax-files.zip', blob });
    });
    return () => { alive = false; };
  }, [files, zipMultiple]);
  return (
    <div className="result-panel">
      <div className="result-heading"><Check size={17} /> Your file is ready</div>
      {result.note && <div className="info-box">{result.note}</div>}
      {result.text && <pre className="text-result">{result.text.slice(0, 6000)}{result.text.length > 6000 ? '\n…' : ''}</pre>}
      {zipMultiple && zipFile && <ResultFileRow file={zipFile} />}
      {files.map((file) => <ResultFileRow file={file} key={file.name} />)}
      <div className="result-actions"><button className="secondary-button" type="button" onClick={onStartOver}><RotateCw size={14} /> Start over</button></div>
    </div>
  );
}

function ResultFileRow({ file }: { file: ResultFile }) {
  const url = useMemo(() => URL.createObjectURL(file.blob), [file.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <div className="result-file"><FileText size={16} /><strong>{file.name} · {formatBytes(file.blob.size)}</strong><a className="download-link" href={url} download={file.name}>Download</a></div>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
