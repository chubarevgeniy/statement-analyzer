import * as pdfjs from 'pdfjs-dist';
// Воркер pdf.js подключаем как URL-ассет (Vite).
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ParseResult } from './types';
import * as deutscheBank from './deutscheBank';
import * as deutscheBank2023 from './deutscheBank2023';
import * as tradeRepublic from './tradeRepublic';
import * as tradeRepublicCsv from './tradeRepublicCsv';
import * as revolut from './revolut';
import * as revolutXlsx from './revolutXlsx';
import { readXlsx } from './xlsx';

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

// Текстовые парсеры (PDF и CSV дают текст). CSV ставим первым: его заголовок
// опознаётся однозначно и не пересекается с PDF-форматами.
// deutscheBank2023 перед deutscheBank: его detect() требует закодированный IBAN,
// что не пересекается с обычным форматом.
const PARSERS = [tradeRepublicCsv, deutscheBank2023, deutscheBank, tradeRepublic, revolut];

/** Определяет банк и парсит текст выписки. Бросает ошибку, если формат неизвестен. */
export function parseStatement(text: string): ParseResult {
  for (const p of PARSERS) {
    if (p.detect(text)) return p.parse(text);
  }
  throw new Error('Неизвестный формат выписки. Поддерживаются Deutsche Bank, Trade Republic, Revolut.');
}

/**
 * Разбирает загруженный файл в зависимости от его типа:
 * - .csv — экспорт транзакций (Trade Republic);
 * - .xlsx — консолидированная выписка Revolut;
 * - иначе — PDF (текст извлекается через pdf.js).
 */
export async function parseFile(file: File): Promise<ParseResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || file.type === 'text/csv') {
    return parseStatement(await file.text());
  }
  if (name.endsWith('.xlsx') || file.type.includes('spreadsheetml')) {
    const rows = readXlsx(await file.arrayBuffer());
    if (!revolutXlsx.detect(rows)) {
      throw new Error('Неизвестный формат XLSX. Поддерживается консолидированная выписка Revolut.');
    }
    return revolutXlsx.parse(rows);
  }
  const text = await extractText(await file.arrayBuffer());
  return parseStatement(text);
}
