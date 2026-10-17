import { createWorker } from 'tesseract.js';

export async function recognizeText(
  image: Blob,
  language: 'eng' | 'fil',
  onProgress?: (progress: number) => void,
): Promise<string> {
  const worker = await createWorker(language, 1, {
    logger: (message) => {
      if (message.status === 'recognizing text') onProgress?.(message.progress);
    },
  });
  try {
    const result = await worker.recognize(image);
    return result.data.text.trim();
  } catch {
    throw new Error(`Could not read this image using ${language === 'fil' ? 'Filipino' : 'English'} OCR.`);
  } finally {
    await worker.terminate();
  }
}
