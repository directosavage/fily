import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Check,
  FileImage,
  FileText,
  RotateCw,
  ScanLine,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import JSZip from 'jszip';
import CornerCropEditor from '../components/CornerCropEditor';
import { detectDocumentCorners, imageFileToPixels, imagesToPdf, pixelsToBlob, rotatePixels, warpAndFilter } from '../lib/images';
import type { ImageFilter, PageSize } from '../lib/images';
import type { PixelImage, Point } from '../lib/warp';

interface ScanPage {
  id: string;
  blob: Blob;
  pixels: PixelImage;
  corners: [Point, Point, Point, Point];
  filter: ImageFilter;
  rotation: number;
  preview: string;
}

interface DownloadFile {
  name: string;
  blob: Blob;
}

const filterOptions: Array<{ value: ImageFilter; label: string }> = [
  { value: 'original', label: 'Original' },
  { value: 'enhance', label: 'Enhance' },
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'bw', label: 'B&W' },
  { value: 'magic', label: 'Magic color' },
];

export default function ScanTool() {
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [selected, setSelected] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>('a4');
  const [margin, setMargin] = useState(24);
  const [exportType, setExportType] = useState<'pdf' | 'jpg' | 'text'>('pdf');
  const [language, setLanguage] = useState<'eng' | 'fil'>('eng');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [downloads, setDownloads] = useState<DownloadFile[]>([]);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pagesRef = useRef<ScanPage[]>([]);

  const cleanupCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraActive(false);
  }, []);

  useEffect(() => {
    if (videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [cameraActive]);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    pagesRef.current.forEach((page) => URL.revokeObjectURL(page.preview));
  }, []);

  const makePage = async (blob: Blob): Promise<ScanPage> => {
    const pixels = await imageFileToPixels(new File([blob], 'scan.jpg', { type: blob.type || 'image/jpeg' }));
    const corners = detectDocumentCorners(pixels);
    return {
      id: crypto.randomUUID(),
      blob,
      pixels,
      corners,
      filter: 'original',
      rotation: 0,
      preview: URL.createObjectURL(blob),
    };
  };

  const addFiles = async (files: FileList | File[], replace?: number) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (!imageFiles.length) {
      setError('Choose an image file, such as JPG, PNG, or WebP.');
      return;
    }
    try {
      setError('');
      const prepared = await Promise.all(imageFiles.map(makePage));
      if (replace !== undefined && prepared.length) {
        setPages((current) => {
          const previous = current[replace];
          if (previous) URL.revokeObjectURL(previous.preview);
          const next = [...current];
          next[replace] = prepared[0];
          return next;
        });
        setSelected(replace);
      } else {
        setPages((current) => [...current, ...prepared]);
        setSelected((current) => (pages.length ? current : 0));
      }
    } catch {
      setError('This image could not be opened. Try another photo.');
    }
  };

  const startCamera = async () => {
    setCameraError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('not-supported');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setCameraError('Camera access is unavailable here. Use the photo picker below instead.');
    }
  };

  const shutter = async () => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.94));
    if (blob) await addFiles([new File([blob], `scan-${pages.length + 1}.jpg`, { type: 'image/jpeg' })]);
  };

  const updateSelected = (updater: (page: ScanPage) => ScanPage) => {
    setPages((current) => current.map((page, index) => (index === selected ? updater(page) : page)));
  };

  const reorder = (from: number, direction: -1 | 1) => {
    const target = from + direction;
    if (target < 0 || target >= pages.length) return;
    setPages((current) => {
      const next = [...current];
      [next[from], next[target]] = [next[target], next[from]];
      return next;
    });
    setSelected(target);
  };

  const removeSelected = () => {
    const page = pages[selected];
    if (page) URL.revokeObjectURL(page.preview);
    setPages((current) => current.filter((_, index) => index !== selected));
    setSelected((current) => Math.max(0, Math.min(current, pages.length - 2)));
  };

  const process = async () => {
    if (!pages.length) return;
    setBusy(true);
    setError('');
    setProgress(5);
    try {
      const blobs: Blob[] = [];
      const scannedText: string[] = [];
      for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index];
        const pixels = warpAndFilter(page.pixels, page.corners, page.filter);
        const rotated = rotatePixels(pixels, page.rotation / 90);
        blobs.push(await pixelsToBlob(rotated));
        setProgress(Math.round(((index + 1) / pages.length) * 72));
      }
      if (exportType === 'pdf') {
        const bytes = await imagesToPdf(blobs, pageSize, margin);
        setDownloads([{ name: 'document-scan.pdf', blob: new Blob([bytes], { type: 'application/pdf' }) }]);
      } else if (exportType === 'jpg') {
        const zip = new JSZip();
        blobs.forEach((blob, index) => zip.file(`scan-page-${index + 1}.jpg`, blob));
        const archive = await zip.generateAsync({ type: 'blob' });
        setDownloads([{ name: 'scanned-pages.zip', blob: archive }]);
      } else {
        const { recognizeText } = await import('../lib/ocr');
        for (let index = 0; index < blobs.length; index += 1) {
          scannedText.push(await recognizeText(blobs[index], language, (value) => setProgress(72 + Math.round(value * 25))));
        }
        setDownloads([{ name: 'scan-text.txt', blob: new Blob([scannedText.join('\n\n')], { type: 'text/plain' }) }]);
      }
      setProgress(100);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The scan could not be exported.');
    } finally {
      setBusy(false);
    }
  };

  const selectedPage = pages[selected];
  const previewFilter =
    selectedPage?.filter === 'grayscale' ? 'grayscale(1)' :
      selectedPage?.filter === 'bw' ? 'grayscale(1) contrast(1.8)' :
        selectedPage?.filter === 'enhance' ? 'contrast(1.14) brightness(1.04)' :
          selectedPage?.filter === 'magic' ? 'contrast(1.2) saturate(1.25)' : undefined;

  return (
    <div className="tool-card-panel">
      <div className="scan-workspace">
        <section>
          {cameraActive && (
            <div className="camera-box">
              <video ref={videoRef} autoPlay muted playsInline aria-label="Live document camera preview" />
              <div className="camera-controls">
                <button className="camera-select" onClick={cleanupCamera} type="button">Stop camera</button>
                <button className="shutter" onClick={shutter} type="button" aria-label="Take scan photo" />
                <label className="camera-select">Choose photos<input type="file" accept="image/*" capture="environment" multiple onChange={(event) => event.target.files && addFiles(event.target.files)} /></label>
              </div>
            </div>
          )}
          {selectedPage ? (
            <>
              <CornerCropEditor
                source={selectedPage.preview}
                alt={`Scan page ${selected + 1}`}
                pixels={selectedPage.pixels}
                corners={selectedPage.corners}
                filter={previewFilter}
                onChange={(corners) => updateSelected((page) => ({ ...page, corners }))}
              />
              <div className="scan-toolbar">
                <button className="chip-button" type="button" onClick={() => updateSelected((page) => ({ ...page, corners: detectDocumentCorners(page.pixels) }))}><ScanLine size={13} /> Auto detect</button>
                <button className="chip-button" type="button" onClick={() => updateSelected((page) => ({ ...page, rotation: (page.rotation + 90) % 360 }))}><RotateCw size={13} /> Rotate</button>
                <label className="chip-button" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Upload size={13} /> Retake
                  <input type="file" accept="image/*" capture="environment" hidden onChange={(event) => event.target.files && addFiles(event.target.files, selected)} />
                </label>
                <button className="chip-button" type="button" onClick={removeSelected}><Trash2 size={13} /> Delete</button>
              </div>
              <div className="scan-toolbar" aria-label="Image filter">
                {filterOptions.map((option) => (
                  <button
                    className={`chip-button ${selectedPage.filter === option.value ? 'active' : ''}`}
                    key={option.value}
                    type="button"
                    onClick={() => updateSelected((page) => ({ ...page, filter: option.value }))}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="scan-empty"><FileImage size={27} /><strong>No pages added yet</strong><span>Start with a camera photo or choose images.</span></div>
          )}
          <div className="scan-toolbar">
            {!cameraActive && <button type="button" className="secondary-button" onClick={startCamera}><Camera size={15} /> Open camera</button>}
            <label className="secondary-button">
              <Upload size={15} /> Choose photos
              <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(event) => event.target.files && addFiles(event.target.files)} />
            </label>
          </div>
          {cameraError && <div className="info-box" style={{ marginTop: 8 }}>{cameraError}</div>}
          {selectedPage && (
            <div className="scan-foot-controls">
              <div className="field">
                <label htmlFor="scan-format">Export as</label>
                <select id="scan-format" value={exportType} onChange={(event) => setExportType(event.target.value as typeof exportType)}>
                  <option value="pdf">PDF document</option><option value="jpg">JPG images (ZIP)</option><option value="text">Recognized text</option>
                </select>
              </div>
              {exportType === 'pdf' && (
                <>
                  <div className="field"><label htmlFor="scan-size">Page size</label><select id="scan-size" value={pageSize} onChange={(event) => setPageSize(event.target.value as PageSize)}><option value="a4">A4</option><option value="letter">Letter</option><option value="fit">Fit to image</option></select></div>
                  <div className="field"><label htmlFor="scan-margin">Margin (pt)</label><input id="scan-margin" type="number" min="0" max="80" value={margin} onChange={(event) => setMargin(Number(event.target.value))} /></div>
                </>
              )}
              {exportType === 'text' && <div className="field"><label htmlFor="scan-language">OCR language</label><select id="scan-language" value={language} onChange={(event) => setLanguage(event.target.value as typeof language)}><option value="eng">English</option><option value="fil">Filipino</option></select></div>}
            </div>
          )}
        </section>
        <aside>
          <div className="options-title">Pages <span className="page-count">({pages.length})</span></div>
          <div className="scan-page-list">
            {pages.map((page, index) => (
              <div className={`scan-page-row ${selected === index ? 'selected' : ''}`} key={page.id} onClick={() => setSelected(index)}>
                <img src={page.preview} alt="" />
                <strong>Page {index + 1}</strong>
                <div className="scan-page-actions">
                  <button className="icon-button" type="button" aria-label={`Move page ${index + 1} up`} onClick={(event) => { event.stopPropagation(); reorder(index, -1); }}><ArrowUp size={13} /></button>
                  <button className="icon-button" type="button" aria-label={`Move page ${index + 1} down`} onClick={(event) => { event.stopPropagation(); reorder(index, 1); }}><ArrowDown size={13} /></button>
                  <button className="icon-button" type="button" aria-label={`Delete page ${index + 1}`} onClick={(event) => { event.stopPropagation(); setSelected(index); const target = pages[index]; URL.revokeObjectURL(target.preview); setPages((current) => current.filter((_, at) => at !== index)); setSelected(Math.max(0, Math.min(selected, pages.length - 2))); }}><X size={13} /></button>
                </div>
              </div>
            ))}
          </div>
          <label className="scan-add"><Upload size={14} /> Add another page<input type="file" accept="image/*" capture="environment" multiple onChange={(event) => event.target.files && addFiles(event.target.files)} /></label>
          <div className="info-box" style={{ marginTop: 13 }}><Check size={14} /> Drag each corner to fit the page. Pages stay on this device.</div>
        </aside>
      </div>

      <div className="process-row">
        <span className="privacy-note"><FileText size={13} /> Your scan is processed locally</span>
        <button className="primary-button" type="button" disabled={!pages.length || busy} onClick={process}>
          {busy ? <><span className="spin"><RotateCw size={14} /></span> Processing…</> : <><ScanLine size={15} /> Process {pages.length} {pages.length === 1 ? 'page' : 'pages'}</>}
        </button>
      </div>
      {busy && <div className="progress-wrap"><div className="progress-caption"><span>Preparing your scan</span><span>{progress}%</span></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></div>}
      {error && <div className="error-box"><X size={15} /> {error}</div>}
      {!!downloads.length && !busy && (
        <div className="result-panel">
          <div className="result-heading"><Check size={17} /> Your scan is ready</div>
          {downloads.map((file) => <DownloadRow key={file.name} file={file} />)}
          <div className="result-actions">
            <button className="secondary-button" type="button" onClick={() => { setDownloads([]); pages.forEach((page) => URL.revokeObjectURL(page.preview)); setPages([]); setSelected(0); }}>
              <ArrowDown size={14} /> Start over
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DownloadRow({ file }: { file: DownloadFile }) {
  const url = useBlobUrl(file.blob);
  return <div className="result-file"><FileText size={16} /><strong>{file.name}</strong><a className="download-link" href={url} download={file.name}>Download</a></div>;
}

function useBlobUrl(blob: Blob): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const created = URL.createObjectURL(blob);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [blob]);
  return url;
}
