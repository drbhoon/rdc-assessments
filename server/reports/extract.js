/**
 * Plain text of an uploaded report, for the copy/repeat check.
 *
 * Digital PDFs and Word files are read directly. Scanned PDFs and photos carry
 * no text, so they are transcribed by the AI — without that, a trainee could
 * dodge the check simply by printing and scanning a copied report.
 */
import mammoth from 'mammoth';
import { transcribe } from './ai.js';

export const ACCEPTED_TYPES = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'text/plain': 'Text',
  'image/png': 'Image',
  'image/jpeg': 'Image',
  'image/webp': 'Image',
};

export const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** A PDF with less readable text than this is treated as scanned. */
const MIN_DIGITAL_WORDS = 40;

const wordCount = (t) => String(t || '').split(/\s+/).filter(Boolean).length;

/** @returns { text, source: 'digital' | 'ocr' } */
export async function extractText({ fileData, mime }) {
  const buffer = Buffer.from(fileData);

  if (mime === 'text/plain') return { text: buffer.toString('utf8'), source: 'digital' };

  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const { value } = await mammoth.extractRawText({ buffer });
    return { text: value || '', source: 'digital' };
  }

  if (mime === 'application/pdf') {
    let text = '';
    try {
      // Loaded on first use: pdf-parse pulls in a native canvas binary, and
      // if that ever failed to load it should cost the PDF text read (the AI
      // transcribes instead), not the whole server at startup.
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        text = (await parser.getText()).text || '';
      } finally {
        await parser.destroy().catch(() => {});
      }
    } catch {
      text = '';
    }
    if (wordCount(text) >= MIN_DIGITAL_WORDS) return { text, source: 'digital' };
  }

  // Scanned PDF or image.
  return { text: await transcribe({ fileData: buffer, mime }), source: 'ocr' };
}
