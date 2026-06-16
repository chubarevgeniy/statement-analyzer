import * as pdfjs from 'pdfjs-dist';
// Воркер pdf.js подключаем как URL-ассет (Vite).
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ParseResult } from './types';
import * as deutscheBank from './deutscheBank';
import * as tradeRepublic from './tradeRepublic';
import * as revolut from './revolut';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { ParseResult, ParsedTxn, ParsedAccount, Bank, TxnType } from './types';

/** Извлекает весь текст из PDF-файла (по страницам, склеенный переводами строк). */
export async function extractText(file: ArrayBuffer): Promise<string> {
  const doc = await pdfjs.getDocument({ data: file }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Восстанавливаем переводы строк по координате Y элементов.
    let lastY: number | null = null;
    let line = '';
    const lines: string[] = [];
    for (const item of content.items) {
      const it = item as { str: string; transform: number[] };
      const y = it.transform[5];
      if (lastY != null && Math.abs(y - lastY) > 2) {
        lines.push(line);
        line = '';
      }
      line += it.str;
      lastY = y;
    }
    if (line) lines.push(line);
    pages.push(lines.join('\n'));
  }
  return pages.join('\n');
}

const PARSERS = [deutscheBank, tradeRepublic, revolut];

/** Определяет банк и парсит текст выписки. Бросает ошибку, если формат неизвестен. */
export function parseStatement(text: string): ParseResult {
  for (const p of PARSERS) {
    if (p.detect(text)) return p.parse(text);
  }
  throw new Error('Неизвестный формат выписки. Поддерживаются Deutsche Bank, Trade Republic, Revolut.');
}
