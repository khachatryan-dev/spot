/*
 * Bill arithmetic (§22) in integer minor units. Prices are whole in practice
 * (AMD has no coins below 1 ֏), so computed amounts — the service charge —
 * are rounded half-up to the currency's smallest coin; the included VAT is
 * informational and rounded to whole coins too.
 */

/** Smallest coin per currency, in minor units (AMD: 1 ֏ = 100). */
const COIN: Record<string, number> = { AMD: 100 };
const coinOf = (currency: string) => COIN[currency] ?? 1;

/** Round a computed amount half-up to the currency's smallest coin. */
export function roundToCoin(minor: number, currency: string): number {
  const coin = coinOf(currency);
  return Math.floor((minor + coin / 2) / coin) * coin;
}

/** Round down to the currency's smallest coin. */
export function floorToCoin(minor: number, currency: string): number {
  const coin = coinOf(currency);
  return Math.floor(minor / coin) * coin;
}

export interface BillAmounts {
  subtotalMinor: number;
  discountMinor: number;
  serviceFeeBps: number;
  serviceFeeMinor: number;
  vatRateBps: number;
  taxIncludedMinor: number;
  totalMinor: number;
}

/**
 * Totals for a bill: the service charge applies after discounts; VAT is
 * already inside the prices, so it's extracted from the total, not added.
 */
export function billAmounts(input: {
  lineTotals: number[];
  discountMinor?: number;
  serviceFeeBps: number;
  vatRateBps: number;
  currency: string;
}): BillAmounts {
  const subtotalMinor = input.lineTotals.reduce((sum, line) => sum + line, 0);
  const discountMinor = Math.min(input.discountMinor ?? 0, subtotalMinor);
  const serviceFeeMinor = roundToCoin(
    ((subtotalMinor - discountMinor) * input.serviceFeeBps) / 10_000,
    input.currency,
  );
  const totalMinor = subtotalMinor - discountMinor + serviceFeeMinor;
  const taxIncludedMinor = roundToCoin(
    (totalMinor * input.vatRateBps) / (10_000 + input.vatRateBps),
    input.currency,
  );
  return {
    subtotalMinor,
    discountMinor,
    serviceFeeBps: input.serviceFeeBps,
    serviceFeeMinor,
    vatRateBps: input.vatRateBps,
    taxIncludedMinor: Math.min(taxIncludedMinor, totalMinor),
    totalMinor,
  };
}
