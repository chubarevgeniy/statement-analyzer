import { unzipSync } from 'fflate';

// Минимальное чтение .xlsx без тяжёлых зависимостей: .xlsx — это zip с XML.
// Распаковываем через fflate и достаём ячейки регулярками (работает и в браузере,
// и в node без DOMParser). Возвращаем первый лист как массив строк-массивов ячеек.

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function decodeXml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-fA-F]+);/g, (_m, named, dec, hex) => {
    if (named) return XML_ENTITIES[`&${named};`];
    if (dec) return String.fromCodePoint(Number(dec));
    return String.fromCodePoint(parseInt(hex, 16));
  });
}

/** Текст внутри одного <si> (склеивает все вложенные <t>). */
function siText(block: string): string {
  let out = '';
  const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out += decodeXml(m[1]);
  return out;
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) strings.push(siText(m[1]));
  return strings;
}

/** Буква колонки ("A", "AB") → 0-based индекс. */
function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1];
      const inner = cm[2] ?? '';
      const refM = attrs.match(/r="([A-Z]+)\d+"/);
      const typeM = attrs.match(/t="([^"]+)"/);
      const type = typeM ? typeM[1] : null;

      let value = '';
      if (type === 'inlineStr') {
        const isM = inner.match(/<is>([\s\S]*?)<\/is>/);
        value = isM ? siText(isM[1]) : '';
      } else {
        const vM = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        const raw = vM ? vM[1] : '';
        if (type === 's') value = shared[Number(raw)] ?? '';
        else value = decodeXml(raw);
      }

      if (refM) {
        const ci = colIndex(refM[1]);
        while (cells.length < ci) cells.push('');
        cells[ci] = value;
      } else {
        cells.push(value);
      }
    }
    rows.push(cells);
  }
  return rows;
}

/** Читает первый лист .xlsx и возвращает его как массив строк-массивов ячеек. */
export function readXlsx(buf: ArrayBuffer): string[][] {
  const files = unzipSync(new Uint8Array(buf));
  const decoder = new TextDecoder();
  const sharedXml = files['xl/sharedStrings.xml'];
  const shared = sharedXml ? parseSharedStrings(decoder.decode(sharedXml)) : [];

  // Берём первый лист (sheet1.xml), либо первый попавшийся worksheet.
  const sheetName =
    'xl/worksheets/sheet1.xml' in files
      ? 'xl/worksheets/sheet1.xml'
      : Object.keys(files).find((n) => /^xl\/worksheets\/.*\.xml$/.test(n));
  if (!sheetName) throw new Error('В .xlsx не найден лист с данными.');
  return parseSheet(decoder.decode(files[sheetName]), shared);
}
