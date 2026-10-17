# DocuMax

DocuMax is a client-side document workspace for scanning, organizing, converting, editing, and protecting PDFs. Files are processed in the browser and are never uploaded.

## Features

- Camera-ready multi-page scanning and image-to-PDF conversion
- PDF merge, split, rotate, extraction, compression, and page management
- OCR, PDF text/Markdown/Word export, and image export
- Watermarks, page numbers, signatures, annotations, redaction, and form filling
- Password protection and PDF decryption
- Installable offline-capable PWA

## Run locally

```sh
npm i && npm run dev
```

## Checks

```sh
npm run typecheck
npm run lint
npm run test
npm run build
```

All document operations run locally in your browser. For encrypted PDFs, provide the document password when prompted.
