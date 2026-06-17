import type { Category, LlmConfig } from '../types';

// Клиент для локальной OpenAI-совместимой LLM (например, Ollama по адресу
// http://localhost:11434/v1). Всё происходит в браузере: запрос уходит только на
// указанный пользователем адрес инференса, никаких внешних сервисов.

/** Одна операция, которую нужно классифицировать. */
export interface ExampleTxn {
  description: string;
  amount: number;
}

export interface LlmItem {
  /** Ключ категоризации (как в маппингах) — по нему вернётся результат. */
  key: string;
  /** Человекочитаемое описание/контрагент. */
  description: string;
  /** Знаковая сумма (для подсказки «доход/расход»). */
  amount: number;
  currency: string;
}

/** Нормализует базовый URL: убирает хвостовой слэш. */
function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Проверка доступности эндпоинта (список моделей). */
export async function pingLlm(config: LlmConfig): Promise<{ ok: boolean; message: string }> {
  const base = normalizeBaseUrl(config.baseUrl);
  if (!base) return { ok: false, message: 'Не указан адрес' };
  try {
    const res = await fetch(`${base}/models`, { method: 'GET' });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const data = (await res.json()) as { data?: { id: string }[] };
    const ids = (data.data ?? []).map((m) => m.id);
    const hasModel = config.model ? ids.includes(config.model) : true;
    return {
      ok: true,
      message: hasModel
        ? `Соединение есть, моделей: ${ids.length}`
        : `Соединение есть, но модель «${config.model}» не найдена среди ${ids.length}`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

function buildPrompt(items: LlmItem[], categories: Category[]): string {
  const catList = categories
    .map((c) => `- ${c.id} :: ${c.name} (${c.kind})`)
    .join('\n');
  const ops = items
    .map((it, i) => {
      const sign = it.amount < 0 ? 'расход' : 'доход';
      return `${i + 1}. key="${it.key}" | "${it.description}" | ${it.amount} ${it.currency} (${sign})`;
    })
    .join('\n');
  return (
    `Ты помогаешь категоризировать банковские операции.\n` +
    `Доступные категории (формат «id :: название (вид)»):\n${catList}\n\n` +
    `Операции:\n${ops}\n\n` +
    `Для каждой операции выбери НАИБОЛЕЕ подходящую категорию из списка выше по её id.\n` +
    `Если уверенной категории нет — используй null.\n` +
    `Ответь СТРОГО валидным JSON-массивом без пояснений, по одному объекту на операцию: ` +
    `[{"key": "<key операции>", "categoryId": "<id категории или null>"}].`
  );
}

export function computeSelectedExamples(examples: ExampleTxn[], newChoices: ExampleTxn[]): string[] {
  const combined = [...examples, ...newChoices];
  if (combined.length === 0) return [];

  // Deduplicate by description
  const uniqueMap = new Map<string, ExampleTxn>();
  for (const ex of combined) {
    if (!uniqueMap.has(ex.description)) {
      uniqueMap.set(ex.description, ex);
    }
  }
  const unique = Array.from(uniqueMap.values());
  if (unique.length <= 7) {
    return unique.map(ex => `${ex.description} (${ex.amount})`);
  }

  unique.sort((a, b) => a.amount - b.amount);

  const min = unique[0];
  const max = unique[unique.length - 1];

  const totalAmount = unique.reduce((sum, ex) => sum + ex.amount, 0);
  const average = totalAmount / unique.length;
  const median = unique[Math.floor(unique.length / 2)].amount;

  let closestToAvg = unique[0];
  let avgDiff = Math.abs(unique[0].amount - average);
  for (const ex of unique) {
    const diff = Math.abs(ex.amount - average);
    if (diff < avgDiff) {
      closestToAvg = ex;
      avgDiff = diff;
    }
  }

  let closestToMedian = unique[0];
  let medianDiff = Math.abs(unique[0].amount - median);
  for (const ex of unique) {
    const diff = Math.abs(ex.amount - median);
    if (diff < medianDiff) {
      closestToMedian = ex;
      medianDiff = diff;
    }
  }

  const selected = new Set<ExampleTxn>();
  selected.add(min);
  selected.add(max);
  selected.add(closestToAvg);
  selected.add(closestToMedian);

  const remaining = unique.filter(ex => !selected.has(ex));

  // Shuffle remaining
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }

  for (let i = 0; i < remaining.length && selected.size < 7; i++) {
    selected.add(remaining[i]);
  }

  return Array.from(selected).map(ex => `${ex.description} (${ex.amount})`);
}

function buildSingleItemPrompt(item: LlmItem, categories: Category[], examples: Record<string, string[]>): string {
  const catList = categories
    .map((c) => {
      const exps = examples[c.id] || [];
      const expsText = exps.length > 0 ? ` Примеры: ${exps.join(', ')}` : '';
      return `- ${c.id} :: ${c.name} (${c.kind})${expsText}`;
    })
    .join('\n');
  const sign = item.amount < 0 ? 'расход' : 'доход';
  const op = `key="${item.key}" | "${item.description}" | ${item.amount} ${item.currency} (${sign})`;
  return (
    `Ты помогаешь категоризировать банковскую операцию.\n` +
    `Доступные категории (формат «id :: название (вид) Примеры: ...»):\n${catList}\n\n` +
    `Операция:\n${op}\n\n` +
    `Выбери НАИБОЛЕЕ подходящую категорию из списка выше по её id.\n` +
    `Если уверенной категории нет — используй null.\n` +
    `Ответь СТРОГО валидным JSON-объектом без пояснений: ` +
    `{"categoryId": "<id категории или null>"}.`
  );
}

/** Достаёт JSON-массив из ответа модели (на случай обёрток ```json и текста вокруг). */
function extractJsonArray(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) throw new Error('В ответе модели нет JSON-массива');
  return JSON.parse(body.slice(start, end + 1));
}

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('В ответе модели нет JSON-объекта');
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * Просит LLM сопоставить одну операцию с категорией.
 */
export async function suggestSingleCategoryLlm(
  item: LlmItem,
  categories: Category[],
  examples: Record<string, string[]>,
  config: LlmConfig,
): Promise<string | null> {
  const base = normalizeBaseUrl(config.baseUrl);
  if (!base || !config.model) throw new Error('Не настроен адрес или модель ИИ');

  const validIds = new Set(categories.map((c) => c.id));

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Ты аккуратный помощник по финансам. Отвечаешь только JSON.' },
        { role: 'user', content: buildSingleItemPrompt(item, categories, examples) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ошибка ИИ: HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? '';
  const parsed = extractJsonObject(content) as { categoryId?: string | null };

  const id = parsed.categoryId;
  if (id && id !== 'null' && validIds.has(id)) return id;
  return null;
}

/**
 * Просит LLM сопоставить операции с существующими категориями.
 * Возвращает Map key → categoryId (только валидные id из переданных категорий).
 */
export async function suggestCategoriesLlm(
  items: LlmItem[],
  categories: Category[],
  config: LlmConfig,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (items.length === 0) return result;
  const base = normalizeBaseUrl(config.baseUrl);
  if (!base || !config.model) throw new Error('Не настроен адрес или модель ИИ');

  const validIds = new Set(categories.map((c) => c.id));
  const byKey = new Map(items.map((it) => [it.key, it]));

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Ты аккуратный помощник по финансам. Отвечаешь только JSON.' },
        { role: 'user', content: buildPrompt(items, categories) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ошибка ИИ: HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? '';
  const parsed = extractJsonArray(content) as { key?: string; categoryId?: string | null }[];

  for (const row of parsed) {
    if (!row || typeof row.key !== 'string') continue;
    if (!byKey.has(row.key)) continue;
    const id = row.categoryId;
    if (id && id !== 'null' && validIds.has(id)) result.set(row.key, id);
  }
  return result;
}
