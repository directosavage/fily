import type { LucideIcon } from 'lucide-react';
import {
  AlignLeft,
  ArrowDownUp,
  BadgeCheck,
  BookOpenText,
  Camera,
  Copy,
  Crop,
  FileArchive,
  FileImage,
  FileLock2,
  FileOutput,
  FilePlus2,
  FileSearch,
  FileSignature,
  FileText,
  Files,
  FlipHorizontal,
  Hash,
  Image,
  Layers2,
  ListOrdered,
  LockKeyhole,
  Maximize2,
  Minimize2,
  MoveHorizontal,
  PanelsTopLeft,
  Pencil,
  RotateCw,
  ScanLine,
  Scissors,
  ShieldCheck,
  Sparkles,
  Stamp,
  Trash2,
  UnlockKeyhole,
  WandSparkles,
} from 'lucide-react';

export type ToolCategory = 'Scan' | 'Organize' | 'Optimize' | 'Convert' | 'Edit' | 'Security';

export interface ToolInfo {
  slug: string;
  name: string;
  description: string;
  category: ToolCategory;
  icon: LucideIcon;
  accepts: 'pdf' | 'image' | 'both' | 'word' | 'two-images' | 'two-pdfs';
  multiple?: boolean;
}

export const categories: ToolCategory[] = ['Scan', 'Organize', 'Optimize', 'Convert', 'Edit', 'Security'];

export const tools: ToolInfo[] = [
  { slug: 'scan-to-pdf', name: 'Scan to PDF', description: 'Capture, clean up, and combine pages into a polished scan.', category: 'Scan', icon: Camera, accepts: 'image', multiple: true },
  { slug: 'id-card', name: 'ID card to PDF', description: 'Place the front and back of a card neatly on one page.', category: 'Scan', icon: BadgeCheck, accepts: 'two-images' },
  { slug: 'ocr', name: 'Image to text (OCR)', description: 'Recognize printed text in photos and PDF pages.', category: 'Scan', icon: ScanLine, accepts: 'both', multiple: true },
  { slug: 'qr-scanner', name: 'QR scanner', description: 'Read QR codes locally with your browser camera tools.', category: 'Scan', icon: FileSearch, accepts: 'image' },
  { slug: 'merge', name: 'Merge PDF', description: 'Bring several documents together in the order you choose.', category: 'Organize', icon: Files, accepts: 'pdf', multiple: true },
  { slug: 'split', name: 'Split PDF', description: 'Separate page ranges or export every page on its own.', category: 'Organize', icon: Scissors, accepts: 'pdf' },
  { slug: 'organize', name: 'Organize PDF', description: 'Reorder, remove, and insert blank pages.', category: 'Organize', icon: ListOrdered, accepts: 'pdf' },
  { slug: 'rotate', name: 'Rotate PDF', description: 'Turn every page or only the pages you select.', category: 'Organize', icon: RotateCw, accepts: 'pdf' },
  { slug: 'remove-pages', name: 'Remove pages', description: 'Delete unwanted pages while keeping the rest intact.', category: 'Organize', icon: Trash2, accepts: 'pdf' },
  { slug: 'extract-pages', name: 'Extract pages', description: 'Save selected pages into a new PDF.', category: 'Organize', icon: FileOutput, accepts: 'pdf' },
  { slug: 'compress', name: 'Compress PDF', description: 'Reduce file size with adjustable image quality.', category: 'Optimize', icon: Minimize2, accepts: 'pdf' },
  { slug: 'crop', name: 'Crop PDF', description: 'Trim equal margins from every page.', category: 'Optimize', icon: Crop, accepts: 'pdf' },
  { slug: 'jpg-to-pdf', name: 'Images to PDF', description: 'Turn JPG, PNG, and WebP images into a PDF.', category: 'Convert', icon: FileImage, accepts: 'image', multiple: true },
  { slug: 'pdf-to-jpg', name: 'PDF to JPG', description: 'Export each page as a high-quality image.', category: 'Convert', icon: Image, accepts: 'pdf' },
  { slug: 'pdf-to-text', name: 'PDF to text', description: 'Extract selectable text into a plain text file.', category: 'Convert', icon: AlignLeft, accepts: 'pdf' },
  { slug: 'pdf-to-markdown', name: 'PDF to Markdown', description: 'Extract text with simple heading-size detection.', category: 'Convert', icon: BookOpenText, accepts: 'pdf' },
  { slug: 'pdf-to-word', name: 'PDF to Word', description: 'Create an editable DOCX from extracted PDF text.', category: 'Convert', icon: FileText, accepts: 'pdf' },
  { slug: 'word-to-pdf', name: 'Word to PDF', description: 'Convert headings, paragraphs, lists, tables, and images to paginated PDF.', category: 'Convert', icon: FileText, accepts: 'word' },
  { slug: 'watermark', name: 'Watermark PDF', description: 'Add your own text watermark to every page.', category: 'Edit', icon: Stamp, accepts: 'pdf' },
  { slug: 'page-numbers', name: 'Page numbers', description: 'Add clean page numbers to your document.', category: 'Edit', icon: Hash, accepts: 'pdf' },
  { slug: 'sign', name: 'Sign PDF', description: 'Place a typed signature or your own signature image.', category: 'Edit', icon: FileSignature, accepts: 'pdf' },
  { slug: 'edit-pdf', name: 'Edit PDF', description: 'Add text, rectangle outlines, and highlights.', category: 'Edit', icon: Pencil, accepts: 'pdf' },
  { slug: 'redact', name: 'Redact PDF', description: 'Permanently cover content by rasterizing the pages.', category: 'Edit', icon: ShieldCheck, accepts: 'pdf' },
  { slug: 'fill-forms', name: 'Fill PDF forms', description: 'Find and fill common AcroForm fields.', category: 'Edit', icon: FilePlus2, accepts: 'pdf' },
  { slug: 'compare', name: 'Compare PDFs', description: 'Review text changes between two documents.', category: 'Edit', icon: MoveHorizontal, accepts: 'two-pdfs' },
  { slug: 'protect', name: 'Protect PDF', description: 'Encrypt your PDF with an opening password.', category: 'Security', icon: LockKeyhole, accepts: 'pdf' },
  { slug: 'unlock', name: 'Unlock PDF', description: 'Remove a password after opening the document.', category: 'Security', icon: UnlockKeyhole, accepts: 'pdf' },
];

export const categoryDescriptions: Record<ToolCategory, string> = {
  Scan: 'Capture paper, recognize text, and get clean digital copies.',
  Organize: 'Arrange pages and combine or separate documents.',
  Optimize: 'Trim page space and shrink large files.',
  Convert: 'Move between PDFs, images, text, and editable documents.',
  Edit: 'Personalize, annotate, sign, and compare PDF pages.',
  Security: 'Add and remove document passwords on your device.',
};

export const extraIconSet = [
  Copy,
  ArrowDownUp,
  FlipHorizontal,
  Layers2,
  Maximize2,
  PanelsTopLeft,
  Sparkles,
  WandSparkles,
  FileArchive,
  FileLock2,
];
