// Форматирование для UI (русская локаль).

const eur = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 2,
});

export function formatEur(value: number): string {
  return eur.format(value);
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function ownerLabel(owner: string): string {
  // owner — нормализованное (нижний регистр) имя; покажем с заглавных букв.
  return owner.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

const BANK_LABELS: Record<string, string> = {
  deutsche_bank: 'Deutsche Bank',
  trade_republic: 'Trade Republic',
  revolut: 'Revolut',
};

export function bankLabel(bank: string): string {
  return BANK_LABELS[bank] ?? bank;
}
