import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { PDFDocument } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import type { PageEditorItem, PageGeometry } from '../lib/page-editor';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type EditorTool = 'select' | 'text' | 'rectangle' | 'highlight' | 'pen' | 'image' | 'redact';

interface PageCanvasEditorProps {
  bytes: Uint8Array;
  items: PageEditorItem[];
  onChange: (items: PageEditorItem[]) => void;
  activeTool: EditorTool;
  defaults?: Partial<PageEditorItem>;
  imageDataUrl?: string;
}

interface Size {
  width: number;
  height: number;
  pointWidth: number;
  pointHeight: number;
}

interface DragSession {
  pointerId: number;
  mode: 'move' | 'resize' | 'create' | 'pen';
  itemId: string;
  start: { x: number; y: number };
  initial: PageEditorItem;
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function boundsFromPoints(points: Array<{ x: number; y: number }>) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(0.005, Math.max(...xs) - x), height: Math.max(0.005, Math.max(...ys) - y) };
}

export default function PageCanvasEditor({
  bytes,
  items,
  onChange,
  activeTool,
  defaults = {},
  imageDataUrl,
}: PageCanvasEditorProps) {
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pageBoxes, setPageBoxes] = useState<PageGeometry[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [size, setSize] = useState<Size | null>(null);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const selectedRef = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  selectedRef.current = selectedId;

  useEffect(() => {
    let disposed = false;
    let pdfTask: pdfjs.PDFDocumentLoadingTask | undefined;
    setPdf(null);
    setPageBoxes([]);
    setPageIndex(0);
    setError('');
    void Promise.all([
      PDFDocument.load(new Uint8Array(bytes)),
      (async () => {
        pdfTask = pdfjs.getDocument({
          data: new Uint8Array(bytes),
          isEvalSupported: false,
        } as unknown as Parameters<typeof pdfjs.getDocument>[0]);
        return pdfTask.promise;
      })(),
    ]).then(([source, rendered]) => {
      if (disposed) {
        void pdfTask?.destroy();
        return;
      }
      setPageBoxes(source.getPages().map((page) => ({ ...page.getCropBox(), rotation: page.getRotation().angle })));
      setPdf(rendered);
    }).catch((cause: unknown) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : 'This PDF could not be previewed.');
    });
    return () => {
      disposed = true;
      void pdfTask?.destroy();
    };
  }, [bytes]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    const canvas = canvasRef.current;
    void pdf.getPage(pageIndex + 1).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 1.45 });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      setSize({
        width: canvas.width,
        height: canvas.height,
        pointWidth: viewport.width / 1.45,
        pointHeight: viewport.height / 1.45,
      });
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Your browser could not render this PDF page.');
      void page.render({ canvas, canvasContext: context, viewport }).promise.catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'This PDF page could not be rendered.');
      });
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'This PDF page could not be rendered.');
    });
    return () => { cancelled = true; };
  }, [pdf, pageIndex]);

  useEffect(() => {
    setSelectedId(null);
  }, [pageIndex]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if ((event.target as HTMLElement | null)?.matches('input,textarea,select,[contenteditable="true"]')) return;
      const selected = selectedRef.current;
      if (!selected) return;
      event.preventDefault();
      onChange(items.filter((item) => item.id !== selected));
      setSelectedId(null);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [items, onChange]);

  const itemsOnPage = items.filter((item) => item.page === pageIndex);

  const normalizedPosition = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('textarea')) return;
    const position = normalizedPosition(event);
    const itemElement = target.closest<HTMLElement>('[data-page-item]');
    if (activeTool === 'select' && itemElement) {
      const item = items.find((candidate) => candidate.id === itemElement.dataset.pageItem);
      if (!item) return;
      event.preventDefault();
      setSelectedId(item.id);
      const mode = target.closest('[data-resize-handle]') ? 'resize' : 'move';
      dragRef.current = { pointerId: event.pointerId, mode, itemId: item.id, start: position, initial: item };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (activeTool === 'select') {
      setSelectedId(null);
      return;
    }
    const id = crypto.randomUUID();
    const kind = activeTool;
    const initial: PageEditorItem = {
      id,
      page: pageIndex,
      kind,
      x: position.x,
      y: position.y,
      width: kind === 'text' || kind === 'image' ? 0.32 : 0.005,
      height: kind === 'text' || kind === 'image' ? 0.1 : 0.005,
      text: defaults.text ?? (kind === 'text' ? 'Text' : undefined),
      fontSize: defaults.fontSize ?? 18,
      fontFamily: defaults.fontFamily,
      color: defaults.color ?? (kind === 'highlight' ? '#fde047' : kind === 'redact' ? '#000000' : '#1f2937'),
      opacity: defaults.opacity ?? 0.38,
      imageDataUrl: kind === 'image' ? imageDataUrl : undefined,
      points: kind === 'pen' ? [position] : undefined,
    };
    if (kind === 'image' && !imageDataUrl) {
      setError('Choose an image before placing it on the page.');
      return;
    }
    setError('');
    setSelectedId(id);
    onChange([...items, initial]);
    dragRef.current = { pointerId: event.pointerId, mode: kind === 'pen' ? 'pen' : 'create', itemId: id, start: position, initial };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const position = normalizedPosition(event);
    const dx = position.x - session.start.x;
    const dy = position.y - session.start.y;
    const updated = items.map((item) => {
      if (item.id !== session.itemId) return item;
      if (session.mode === 'move') {
        return {
          ...session.initial,
          x: clamp(session.initial.x + dx, 0, 1 - session.initial.width),
          y: clamp(session.initial.y + dy, 0, 1 - session.initial.height),
        };
      }
      if (session.mode === 'resize' || session.mode === 'create') {
        const x2 = session.mode === 'create' ? position.x : session.initial.x + session.initial.width + dx;
        const y2 = session.mode === 'create' ? position.y : session.initial.y + session.initial.height + dy;
        const startX = session.mode === 'create' ? session.start.x : session.initial.x;
        const startY = session.mode === 'create' ? session.start.y : session.initial.y;
        const left = Math.min(startX, x2);
        const top = Math.min(startY, y2);
        const width = Math.max(0.015, Math.abs(x2 - startX));
        const height = Math.max(0.015, Math.abs(y2 - startY));
        const points = session.mode === 'resize' && session.initial.kind === 'pen'
          ? session.initial.points?.map((point) => ({
            x: left + ((point.x - session.initial.x) / session.initial.width) * width,
            y: top + ((point.y - session.initial.y) / session.initial.height) * height,
          }))
          : session.initial.points;
        return { ...session.initial, x: left, y: top, width, height, points };
      }
      const points = [...(session.initial.points ?? []), position];
      return { ...session.initial, ...boundsFromPoints(points), points };
    });
    onChange(updated);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const pageBox = pageBoxes[pageIndex];
  const oddRotation = pageBox && Math.abs(pageBox.rotation % 180) === 90;
  const displayWidth = pageBox ? (oddRotation ? pageBox.height : pageBox.width) : 1;
  const fontScale = size ? size.width / displayWidth : 1;

  return (
    <div className="page-editor">
      <div className="page-editor-controls">
        <button className="secondary-button" type="button" aria-label="Previous PDF page" disabled={pageIndex === 0} onClick={() => setPageIndex((value) => Math.max(0, value - 1))}><ChevronLeft size={15} /> Previous</button>
        <label className="page-editor-picker">Page
          <select aria-label="Select PDF page" value={pageIndex} onChange={(event) => setPageIndex(Number(event.target.value))}>
            {pageBoxes.map((_, index) => <option key={index} value={index}>{index + 1} of {pageBoxes.length}</option>)}
          </select>
        </label>
        <button className="secondary-button" type="button" aria-label="Next PDF page" disabled={pageIndex >= pageBoxes.length - 1} onClick={() => setPageIndex((value) => Math.min(pageBoxes.length - 1, value + 1))}>Next <ChevronRight size={15} /></button>
        <button className="icon-button" type="button" disabled={!selectedId} aria-label="Delete selected item" onClick={() => { if (selectedId) onChange(items.filter((item) => item.id !== selectedId)); setSelectedId(null); }}><Trash2 size={15} /></button>
        <span className="page-editor-hint">Click or drag on the page to place items; select and drag to move.</span>
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="page-editor-stage">
        <div
          ref={surfaceRef}
          className={`page-editor-surface ${activeTool !== 'select' ? 'placing' : ''}`}
          style={{ aspectRatio: size ? `${size.width} / ${size.height}` : '1 / 1.4' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <canvas ref={canvasRef} className="page-editor-pdf-canvas" />
          <div className="page-editor-overlay">
            {itemsOnPage.map((item) => (
              <div
                key={item.id}
                data-page-item={item.id}
                className={`page-editor-item ${selectedId === item.id ? 'selected' : ''} ${item.kind}`}
                style={{
                  left: `${item.x * 100}%`,
                  top: `${item.y * 100}%`,
                  width: `${item.width * 100}%`,
                  height: `${item.height * 100}%`,
                  color: item.color,
                  fontSize: `${(item.fontSize ?? 18) * fontScale}px`,
                  fontFamily: item.fontFamily ? `"${item.fontFamily}", cursive` : undefined,
                  backgroundColor: item.kind === 'highlight' ? `${item.color ?? '#fde047'}66` : item.kind === 'redact' ? '#000' : undefined,
                }}
              >
                {item.kind === 'text' ? (
                  <textarea
                    value={item.text ?? ''}
                    aria-label="Edit placed text"
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={(event) => onChange(items.map((candidate) => candidate.id === item.id ? { ...candidate, text: event.target.value } : candidate))}
                    style={{ fontSize: 'inherit', fontFamily: 'inherit', color: 'inherit' }}
                  />
                ) : item.kind === 'image' && item.imageDataUrl ? (
                  <img src={item.imageDataUrl} alt="Placed signature or image" draggable={false} />
                ) : item.kind === 'pen' && item.points?.length ? (
                  <svg viewBox="0 0 1 1" preserveAspectRatio="none"><polyline points={item.points.map((point) => `${(point.x - item.x) / item.width},${(point.y - item.y) / item.height}`).join(' ')} /></svg>
                ) : null}
                {selectedId === item.id && activeTool === 'select' && <button type="button" data-resize-handle aria-label="Resize item" className="page-editor-resize" />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
