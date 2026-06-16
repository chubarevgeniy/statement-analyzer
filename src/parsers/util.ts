// Утилиты, общие для парсеров. Без личных данных.

/** Разбивает извлечённый из PDF текст на непустые обрезанные строки. */
export function toLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/ /g, ' ').trim())
    .filter((l) => l.length > 0);
}

/** Нормализует IBAN: убирает пробелы, в верхний регистр. */
export function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

/** Нормализует имя для сравнения (нижний регистр, схлопнутые пробелы). */
export function normalizeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Парсит сумму из европейского формата "2.034,95" / "1.991,32 €" → 2034.95 / 1991.32.
 */
export function parseEuAmount(raw: string): number {
  const cleaned = raw.replace(/[^\d.,-]/g, '');
  // Удаляем разделители тысяч (точки), запятую делаем десятичной.
  const normalized = cleaned.replace(/\./g, '').replace(',', '.');
  return Number(normalized);
}

/**
 * Парсит сумму из англо/американского формата "2,034.95" / "-€2.03" → 2034.95 / -2.03.
 */
export function parseUsAmount(raw: string): number {
  const sign = /-/.test(raw) ? -1 : 1;
  const cleaned = raw.replace(/[^\d.,]/g, '');
  const normalized = cleaned.replace(/,/g, '');
  return sign * Number(normalized);
}

/** Деньги в центах (целое), чтобы избегать ошибок плавающей точки. */
export function toCents(value: number): number {
  return Math.round(value * 100);
}

/** Из центов обратно в число. */
export function fromCents(cents: number): number {
  return cents / 100;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, mär: 3, märz: 3, maerz: 3, mrz: 3, apr: 4, mai: 5, may: 5,
  jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, okt: 10, oct: 10,
  nov: 11, dez: 12, dec: 12,
};

/** Месяц по короткому названию (немецкому или английскому). */
export function monthFromAbbrev(abbrev: string): number | null {
  const key = abbrev.toLowerCase().replace('.', '');
  return MONTHS[key] ?? null;
}

/** Форматирует ISO-дату YYYY-MM-DD из чисел. */
export function isoDate(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}
