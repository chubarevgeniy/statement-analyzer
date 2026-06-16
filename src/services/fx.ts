import { getFxRate, putFxRate } from '../db/transactionsDb';
import type { FxRate } from '../types';

// Конвертация валют в EUR. Для Revolut EUR-эквивалент берётся прямо из выписки
// (eurAmountHint), поэтому этот модуль нужен лишь как резерв для не-EUR операций
// без готового эквивалента.

// Последний введённый вручную курс по валюте (для дефолта следующего ввода).
const lastManualRate = new Map<string, number>();

function key(currency: string, date: string): string {
  return `${currency}:${date}`;
}

/** Пытается получить курс из кэша или бесплатного API (frankfurter.app, ECB). */
export async function lookupRate(currency: string, date: string): Promise<FxRate | null> {
  if (currency === 'EUR') return { key: key('EUR', date), currency, date, rate: 1, source: 'api' };
  const cached = await getFxRate(key(currency, date));
  if (cached) return cached;
  try {
    const url = `https://api.frankfurter.app/${date}?from=${currency}&to=EUR`;
    const resp = await fetch(url);
    if (resp.ok) {
      const data = (await resp.json()) as { rates?: Record<string, number> };
      const rate = data.rates?.EUR;
      if (typeof rate === 'number') {
        const fx: FxRate = { key: key(currency, date), currency, date, rate, source: 'api' };
        await putFxRate(fx);
        return fx;
      }
    }
  } catch {
    // оффлайн / API недоступно — вернём null, потребуется ручной ввод
  }
  return null;
}

/** Дефолтный курс для ручного ввода (последний введённый по этой валюте). */
export function defaultManualRate(currency: string): number | undefined {
  return lastManualRate.get(currency);
}

/** Сохраняет введённый вручную курс (в кэш и как дефолт). */
export async function saveManualRate(currency: string, date: string, rate: number): Promise<FxRate> {
  lastManualRate.set(currency, rate);
  const fx: FxRate = { key: key(currency, date), currency, date, rate, source: 'manual' };
  await putFxRate(fx);
  return fx;
}
