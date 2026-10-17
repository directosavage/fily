import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, PointerEvent as ReactPointerEvent, ReactNode, SetStateAction } from 'react';
import '@fontsource/dancing-script/500.css';
import '@fontsource/dancing-script/700.css';
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
import CornerCropEditor from '../components/CornerCropEditor';
import PageCanvasEditor from '../components/PageCanvasEditor';
import {
  addIdCardPages,
  addPageNumbers,
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
  splitEveryPage,
  splitPdfByRanges,
  unlockPdf,
  watermarkPdf,
} from '../lib/pdf';
import type { FormFieldInfo } from '../lib/pdf';
import { parsePageRanges } from '../lib/ranges';
import type { PdfArtifact } from '../lib/pdf';
import { flattenPageItems } from '../lib/page-editor';
import type { PageEditorItem } from '../lib/page-editor';
import { detectDocumentCorners, imageFileToPixels, imagesToPdf, pixelsToBlob, scanBarcode, warpAndFilter } from '../lib/images';
import type { ImageFilter } from '../lib/images';
import type { PixelImage, Point } from '../lib/warp';

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
interface CardCrop {
  file: File;
  pixels: PixelImage;
  corners: [Point, Point, Point, Point];
  filter: ImageFilter;
}

const cardFilterOptions: Array<{ value: ImageFilter; label: string }> = [
  { value: 'original', label: 'Original' },
  { value: 'enhance', label: 'Enhance' },
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'bw', label: 'B&W' },
  { value: 'magic', label: 'Magic color' },
];

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
  ownerPassword: string;
  printing: boolean;
  copying: boolean;
  modifying: boolean;
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
  ownerPassword: '',
  printing: true,
  copying: false,
  modifying: false,
};

const toolHelp: Record<string, string> = {
  'scan-to-pdf': 'Take photos with your camera or choose existing images. Reorder pages and adjust the crop before exporting.',
  'id-card': 'Select the front and back photos in that order. Both sides will be centered on one A4 page.',
  ocr: 'OCR uses on-device Tesseract language data. The first recognition may take a moment while the language model loads.',
  'qr-scanner': 'BarcodeDetector availability depends on your browser. This tool does not send photos anywhere.',
  compress: 'Compression rasterizes pages to JPEG images. Text selection and vectors are not preserved; the original is kept if the compressed output is larger.',
  redact: 'Pages containing redaction boxes are rasterized; untouched pages remain vector. Covered content is removed from the output.',
  'pdf-to-word': 'Text is extracted page by page into editable paragraphs. Original layout and images are not preserved.',
  'fill-forms': 'This tool supports common AcroForm text, checkbox, dropdown, and radio fields. XFA forms are not supported.',
  unlock: 'The Cantoo PDF library opens supported encrypted PDFs with a password, then saves a decrypted copy.',
  'edit-pdf': 'Place text, shapes, highlights, pen strokes, or images on any page. Edits are flattened into the PDF.',
  sign: 'Draw or type a signature and place multiple copies on any page.',
  crop: 'The same margin is removed from the visible content area on every page.',
};

export default function ToolPage() {
  const { slug = '' } = useParams();
  const tool = tools.find((candidate) => candidate.slug === slug);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [editorBytes, setEditorBytes] = useState<Uint8Array | null>(null);
  const [editorItems, setEditorItems] = useState<PageEditorItem[]>([]);
  const [editorTool, setEditorTool] = useState<'select' | 'text' | 'rectangle' | 'highlight' | 'pen' | 'image' | 'redact'>('select');
  const [editorText, setEditorText] = useState('');
  const [editorImage, setEditorImage] = useState('');
  const [editorColor, setEditorColor] = useState('#172554');
  const [editorFontSize, setEditorFontSize] = useState(24);
  const [removeWhiteBackground, setRemoveWhiteBackground] = useState(false);
  const [options, setOptions] = useState<Options>(initialOptions);
  const [formFields, setFormFields] = useState<FormFieldInfo[]>([]);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [deletedPages, setDeletedPages] = useState<number[]>([]);
  const [pageRotations, setPageRotations] = useState<Record<number, number>>({});
  const [blankAfter, setBlankAfter] = useState<number[]>([]);
  const [draggedPage, setDraggedPage] = useState<number | null>(null);
  const [draggedFile, setDraggedFile] = useState<string | null>(null);
  const [cardCrops, setCardCrops] = useState<Array<CardCrop | null>>([null, null]);
  const [pageThumbnails, setPageThumbnails] = useState<string[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ToolResult | null>(null);

  const accept = tool?.accepts === 'word' ? '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
    tool?.accepts === 'pdf' || tool?.accepts === 'two-pdfs' ? '.pdf,application/pdf' :
    tool?.accepts === 'image' || tool?.accepts === 'two-images' ? 'image/*' : '.pdf,application/pdf,image/*';
  const multiple = !!tool && (tool.multiple || tool.accepts === 'two-images' || tool.accepts === 'two-pdfs');

  useEffect(() => {
    setFiles([]);
    setEditorBytes(null);
    setEditorItems([]);
    setEditorTool('select');
    setEditorImage('');
    setRemoveWhiteBackground(false);
    setCardCrops([null, null]);
    setOptions({ ...initialOptions, range: slug === 'rotate' ? '' : initialOptions.range });
    setFormFields([]);
    setFormValues({});
    setPageOrder([]);
    setDeletedPages([]);
    setPageRotations({});
    setBlankAfter([]);
    setPageThumbnails([]);
    setPageCount(0);
    setError('');
    setResult(null);
  }, [slug]);

  useEffect(() => () => pageThumbnails.forEach((url) => URL.revokeObjectURL(url)), [pageThumbnails]);

  useEffect(() => {
    if (slug !== 'id-card') return;
    let cancelled = false;
    void Promise.all(files.slice(0, 2).map(async ({ file }) => {
      const pixels = await imageFileToPixels(file);
      return { file, pixels, corners: detectDocumentCorners(pixels), filter: 'original' as const };
    })).then((sides) => {
      if (!cancelled) setCardCrops([sides[0] ?? null, sides[1] ?? null]);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'The card image could not be opened.');
    });
    return () => { cancelled = true; };
  }, [files, slug]);

  const updateOption = <Key extends keyof Options>(key: Key, value: Options[Key]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };

  const prepareFiles = async (selected: FileList | File[]) => {
    if (!tool) return;
    const incoming = Array.from(selected);
    const valid = incoming.filter((file) => {
      if (tool.accepts === 'word') return file.name.toLowerCase().endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      if (tool.accepts === 'pdf' || tool.accepts === 'two-pdfs') return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (tool.accepts === 'image' || tool.accepts === 'two-images') return file.type.startsWith('image/');
      return file.type.startsWith('image/') || file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    });
    if (!valid.length) {
      setError(tool.accepts === 'word' ? 'Choose a DOCX file to continue.' : tool.accepts.includes('pdf') ? 'Choose a PDF file to continue.' : 'Choose a supported image file to continue.');
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
    if (tool.slug === 'sign' || tool.slug === 'edit-pdf' || tool.slug === 'redact') {
      setEditorBytes(new Uint8Array(await limited[0].arrayBuffer()));
      setEditorItems([]);
      setEditorTool(tool.slug === 'redact' ? 'redact' : 'select');
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
        const organized = await organizePdf(primary, pageOrder, deletedPages, pageRotations, blankAfter);
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
        pdfBlob(await imagesToPdf(files.map(({ file }) => file), options.pageSize, options.margin), 'images.pdf');
      } else if (slug === 'id-card') {
        if (!cardCrops[0] || !cardCrops[1]) throw new Error('Choose a front and back card image.');
        const sides = await Promise.all(cardCrops.map(async (side) => {
          if (!side) throw new Error('Choose both sides of the card.');
          return pixelsToBlob(warpAndFilter(side.pixels, side.corners, side.filter));
        }));
        pdfBlob(await addIdCardPages(sides[0]!, sides[1]!), 'id-card.pdf');
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
      } else if (slug === 'word-to-pdf') {
        const { wordToPdf } = await import('../lib/word-to-pdf');
        pdfBlob(await wordToPdf(primary), 'converted-document.pdf');
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
        if (!options.ownerPassword) throw new Error('Enter an owner password as well as an opening password.');
        pdfBlob(await protectPdf(primary, options.password, {
          printing: options.printing ? 'highResolution' : false,
          copying: options.copying,
          modifying: options.modifying,
        }, options.ownerPassword), 'protected.pdf');
      } else if (slug === 'unlock') {
        pdfBlob(await unlockPdf(primary, options.password), 'unlocked.pdf');
      } else if (slug === 'fill-forms') {
        pdfBlob(await fillForm(primary, formValues, options.flatten), 'filled-form.pdf');
      } else if (slug === 'sign') {
        if (!editorItems.length) throw new Error('Draw or place at least one signature or date stamp.');
        pdfBlob(await flattenPageItems(primary, editorItems), 'signed-document.pdf');
      } else if (slug === 'redact') {
        const { redactPdf } = await import('../lib/pdf-render');
        const boxes = editorItems.filter((item) => item.kind === 'redact').map(({ page, x, y, width, height }) => ({ page, x, y, width, height }));
        if (!boxes.length) throw new Error('Draw at least one redaction box on a page.');
        pdfBlob(await redactPdf(primary, boxes), 'redacted.pdf');
        note = 'Only pages containing redactions were rasterized. The covered content is removed from the output.';
      } else if (slug === 'edit-pdf') {
        const annotations = editorItems.filter((item) => item.kind !== 'redact');
        if (!annotations.length) throw new Error('Add at least one item to the document.');
        pdfBlob(await flattenPageItems(primary, annotations), 'edited-document.pdf');
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
    setEditorBytes(null);
    setEditorItems([]);
    setEditorImage('');
    setEditorTool('select');
    setCardCrops([null, null]);
    setBlankAfter([]);
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
              <div
                className={`file-row sort-handle ${draggedFile === id ? 'dragging' : ''}`}
                data-file-id={id}
                key={id}
                onPointerDown={(event) => { if (multiple && !(event.target as HTMLElement).closest('button')) { setDraggedFile(id); event.currentTarget.setPointerCapture(event.pointerId); } }}
                onPointerUp={(event) => {
                  if (!draggedFile) return;
                  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-file-id]');
                  const targetId = target?.dataset.fileId;
                  if (targetId) setFiles((current) => reorderPage(current, current.findIndex((item) => item.id === draggedFile), current.findIndex((item) => item.id === targetId)));
                  setDraggedFile(null);
                }}
              >
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
        {slug === 'id-card' && (
          <div className="options-section">
            <div className="options-title">Crop each side</div>
            <div className="id-card-editors">
              {(['Front', 'Back'] as const).map((label, index) => <CardCropEditor key={label} label={label} crop={cardCrops[index]} onChange={(corners) => setCardCrops((current) => current.map((side, sideIndex) => sideIndex === index && side ? { ...side, corners } : side))} onFilterChange={(filter) => setCardCrops((current) => current.map((side, sideIndex) => sideIndex === index && side ? { ...side, filter } : side))} />)}
            </div>
            <div className="info-box" style={{ marginTop: 10 }}>Choose the front and back photos in that order. Drag the four corners to fit each card side.</div>
          </div>
        )}

        {slug === 'organize' && pageOrder.length > 0 && (
          <div className="options-section">
            <div className="options-title">Page order <span className="page-count">({pageCount} pages)</span></div>
            <div className="organize-pages">
              {pageOrder.map((page, index) => (
                <div
                  data-organize-page={page}
                  className={`organize-page sort-handle ${deletedPages.includes(page) ? 'removed' : ''}`}
                  key={`${page}-${index}`}
                  onPointerDown={(event) => { if (!(event.target as HTMLElement).closest('button')) { setDraggedPage(page); event.currentTarget.setPointerCapture(event.pointerId); } }}
                  onPointerUp={(event) => {
                    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-organize-page]');
                    const targetPage = Number(target?.dataset.organizePage);
                    if (draggedPage !== null && Number.isFinite(targetPage)) setPageOrder((current) => reorderPage(current, current.indexOf(draggedPage), current.indexOf(targetPage)));
                    setDraggedPage(null);
                  }}
                >
                  <span className="page-count">{index + 1}</span>
                  {pageThumbnails[page] && <img src={pageThumbnails[page]} alt={`Preview of page ${page + 1}`} />}
                  <strong>PDF page {page + 1} {pageRotations[page] ? `· ${pageRotations[page]}°` : ''}</strong>
                  <button className="icon-button" type="button" aria-label={`Move page ${page + 1} up`} onClick={() => movePage(index, -1, pageOrder, setPageOrder)}><ArrowDown className="flip-vertical" size={14} /></button>
                  <button className="icon-button" type="button" aria-label={`Move page ${page + 1} down`} onClick={() => movePage(index, 1, pageOrder, setPageOrder)}><ArrowDown size={14} /></button>
                  <button className="icon-button" type="button" aria-label={`Rotate page ${page + 1}`} onClick={() => setPageRotations((current) => ({ ...current, [page]: ((current[page] ?? 0) + 90) % 360 }))}><RotateCw size={14} /></button>
                  <button className="icon-button" type="button" aria-label={`Insert blank page after page ${page + 1}`} title="Insert blank page after this page" onClick={() => setBlankAfter((current) => current.includes(page) ? current.filter((item) => item !== page) : [...current, page])}>{blankAfter.includes(page) ? 'Blank ✓' : 'Blank +'}</button>
                  <button className="icon-button" type="button" aria-label={`Toggle page ${page + 1}`} onClick={() => setDeletedPages((current) => current.includes(page) ? current.filter((item) => item !== page) : [...current, page])}><X size={14} /></button>
                </div>
              ))}
            </div>
            <div className="info-box" style={{ marginTop: 10 }}>Drag thumbnails to reorder pages. Use the Blank button to insert a page after an individual page.</div>
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
        {(slug === 'sign' || slug === 'edit-pdf' || slug === 'redact') && editorBytes && (
          <div className="options-section">
            <div className="options-title">{slug === 'sign' ? 'Place signatures and date stamps' : slug === 'redact' ? 'Draw redaction boxes' : 'Add page annotations'}</div>
            {slug === 'sign' ? (
              <>
                <div className="option-grid">
                  <Field label="Cursive signature name" value={editorText} onChange={setEditorText} />
                  <div className="field"><label htmlFor="signature-color">Signature color</label><input id="signature-color" type="color" value={editorColor} onChange={(event) => setEditorColor(event.target.value)} /></div>
                </div>
                <div className="scan-toolbar">
                  <button type="button" className="chip-button" onClick={() => setEditorTool('select')}>Select / move</button>
                  <button type="button" className="chip-button" onClick={() => setEditorTool('text')}>Place typed signature</button>
                  <button type="button" className="chip-button" onClick={() => { setEditorText(new Date().toLocaleDateString()); setEditorTool('text'); }}>Add date</button>
                  <label className="chip-button">Upload signature image<input type="file" accept="image/png,image/jpeg" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void imageFileToDataUrl(file, removeWhiteBackground).then(setEditorImage); }} /></label>
                </div>
                <label className="check-field"><input type="checkbox" checked={removeWhiteBackground} onChange={(event) => setRemoveWhiteBackground(event.target.checked)} /> Remove white from uploaded signature background</label>
                <div className="field"><label>Draw a signature</label><SignaturePad onSave={setEditorImage} /></div>
                {!!editorImage && <div className="scan-toolbar"><button className="chip-button active" type="button" onClick={() => setEditorTool('image')}>Place saved drawing or image</button><button className="chip-button" type="button" onClick={() => setEditorImage('')}>Clear saved image</button></div>}
              </>
            ) : slug === 'edit-pdf' ? (
              <>
                <div className="option-grid">
                  <Field label="Text to place" value={editorText} onChange={setEditorText} />
                  <Field label="Text size (pt)" type="number" value={editorFontSize} onChange={(value) => setEditorFontSize(Number(value))} />
                  <div className="field"><label htmlFor="annotation-color">Text / shape color</label><input id="annotation-color" type="color" value={editorColor} onChange={(event) => setEditorColor(event.target.value)} /></div>
                  <div className="field"><label htmlFor="annotation-image">Image to place</label><input id="annotation-image" type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void imageFileToDataUrl(file, false).then(setEditorImage); }} /></div>
                </div>
                <div className="scan-toolbar">
                  {(['select', 'text', 'rectangle', 'highlight', 'pen', 'image'] as const).map((name) => <button key={name} type="button" className={`chip-button ${editorTool === name ? 'active' : ''}`} onClick={() => setEditorTool(name)}>{name === 'rectangle' ? 'Rectangle' : name === 'pen' ? 'Freehand pen' : name[0].toUpperCase() + name.slice(1)}</button>)}
                </div>
              </>
            ) : (
              <div className="scan-toolbar"><button className={`chip-button ${editorTool === 'redact' ? 'active' : ''}`} type="button" onClick={() => setEditorTool('redact')}>Draw redaction box</button><button className="chip-button" type="button" onClick={() => setEditorTool('select')}>Select / move boxes</button></div>
            )}
            <PageCanvasEditor
              bytes={editorBytes}
              items={editorItems}
              onChange={setEditorItems}
              activeTool={editorTool}
              imageDataUrl={editorImage}
              defaults={{
                text: editorText || (slug === 'sign' ? 'Your name' : 'Text'),
                fontSize: editorFontSize,
                fontFamily: slug === 'sign' ? 'Dancing Script' : undefined,
                color: editorColor,
              }}
            />
          </div>
        )}
        {slug !== 'organize' && slug !== 'fill-forms' && slug !== 'sign' && (
          <ToolOptions slug={slug} options={options} updateOption={updateOption} />
        )}
        {slug === 'fill-forms' && <div className="options-section"><label className="check-field"><input type="checkbox" checked={options.flatten} onChange={(event) => updateOption('flatten', event.target.checked)} /> Flatten the fields after filling</label></div>}
        {(slug === 'sign' || slug === 'edit-pdf' || slug === 'redact') && <div className="options-section"><div className="info-box"><ShieldCheck size={14} /> Place items on any page. Select an item to move or resize it; press Delete to remove it.</div></div>}
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

function reorderPage<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
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
  if (slug === 'protect') {
    optionFields.push(field('ownerPassword', 'Owner password', 'password'));
    optionFields.push(<label className="check-field" key="printing"><input type="checkbox" checked={options.printing} onChange={(event) => updateOption('printing', event.target.checked)} /> Allow printing</label>);
    optionFields.push(<label className="check-field" key="copying"><input type="checkbox" checked={options.copying} onChange={(event) => updateOption('copying', event.target.checked)} /> Allow copying</label>);
    optionFields.push(<label className="check-field" key="modifying"><input type="checkbox" checked={options.modifying} onChange={(event) => updateOption('modifying', event.target.checked)} /> Allow modifying</label>);
  }
  if (slug === 'ocr') optionFields.push(select('language', 'OCR language', [{ value: 'eng', label: 'English' }, { value: 'fil', label: 'Filipino' }]));
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

function imageFileToDataUrl(file: File, removeWhite: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('This image could not be opened.'));
    reader.onload = async () => {
      if (!removeWhite || typeof reader.result !== 'string') {
        resolve(String(reader.result));
        return;
      }
      try {
        const image = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Your browser could not prepare this signature image.');
        context.drawImage(image, 0, 0);
        image.close();
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let offset = 0; offset < pixels.data.length; offset += 4) {
          if (pixels.data[offset] > 242 && pixels.data[offset + 1] > 242 && pixels.data[offset + 2] > 242) pixels.data[offset + 3] = 0;
        }
        context.putImageData(pixels, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (cause) {
        reject(cause);
      }
    };
    reader.readAsDataURL(file);
  });
}

function CardCropEditor({ label, crop, onChange, onFilterChange }: {
  label: string;
  crop: CardCrop | null;
  onChange: (corners: [Point, Point, Point, Point]) => void;
  onFilterChange: (filter: ImageFilter) => void;
}) {
  const [preview, setPreview] = useState('');
  const cropFile = crop?.file;
  useEffect(() => {
    if (!cropFile) { setPreview(''); return; }
    const url = URL.createObjectURL(cropFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [cropFile]);
  const previewFilter = crop?.filter === 'grayscale' ? 'grayscale(1)' :
    crop?.filter === 'bw' ? 'grayscale(1) contrast(1.8)' :
      crop?.filter === 'enhance' ? 'contrast(1.14) brightness(1.04)' :
        crop?.filter === 'magic' ? 'contrast(1.2) saturate(1.25)' : undefined;
  return (
    <div className="id-card-side">
      <h3>{label} side</h3>
      {crop && preview ? (
        <>
          <CornerCropEditor source={preview} alt={`${label} side crop preview`} pixels={crop.pixels} corners={crop.corners} filter={previewFilter} onChange={onChange} />
          <button type="button" className="chip-button" onClick={() => onChange(detectDocumentCorners(crop.pixels))}>Auto detect corners</button>
          <div className="scan-toolbar" aria-label={`${label} side image filter`}>
            {cardFilterOptions.map((option) => <button className={`chip-button ${crop.filter === option.value ? 'active' : ''}`} key={option.value} type="button" onClick={() => onFilterChange(option.value)}>{option.label}</button>)}
          </div>
        </>
      ) : <p className="page-editor-hint">Choose two card photos above.</p>}
    </div>
  );
}

function SignaturePad({ onSave }: { onSave: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState('#111827');
  const [strokes, setStrokes] = useState<Array<Array<{ x: number; y: number }>>>([]);
  const [current, setCurrent] = useState<Array<{ x: number; y: number }>>([]);
  const draw = useCallback((next = strokes, active = current) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = color;
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    [...next, active].forEach((stroke) => {
      if (stroke.length < 2) return;
      context.beginPath();
      context.moveTo(stroke[0].x * canvas.width, stroke[0].y * canvas.height);
      stroke.slice(1).forEach((point) => context.lineTo(point.x * canvas.width, point.y * canvas.height));
      context.stroke();
    });
  }, [color, strokes, current]);
  useEffect(() => { draw(); }, [draw]);
  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  };
  return (
    <div className="signature-pad">
      <canvas
        ref={canvasRef}
        width={720}
        height={180}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setCurrent([point(event)]); }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setCurrent((items) => [...items, point(event)]); }}
        onPointerUp={() => { if (current.length > 1) setStrokes((items) => [...items, current]); setCurrent([]); }}
      />
      <div className="signature-pad-actions">
        <label className="field">Pen color <select value={color} onChange={(event) => setColor(event.target.value)}><option value="#111827">Black</option><option value="#1d4ed8">Blue</option></select></label>
        <button type="button" className="secondary-button" onClick={() => { setStrokes((items) => items.slice(0, -1)); setCurrent([]); }}>Undo</button>
        <button type="button" className="secondary-button" onClick={() => { setStrokes([]); setCurrent([]); }}>Clear</button>
        <button type="button" className="primary-button" onClick={() => { const canvas = canvasRef.current; if (canvas) onSave(canvas.toDataURL('image/png')); }}>Use signature</button>
      </div>
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
