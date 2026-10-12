import { floorToCoin, roundToCoin } from "./bill-math";

/*
 * Splitting a finalized bill (§23). All amounts are integer minor units and
 * always add up exactly to the bill total.
 */

/**
 * Equal split: `count` shares of `total`, each rounded down to whole coins;
 * the last share takes the difference (so it's never smaller than the rest).
 * Share `index` is 1-based.
 */
export function equalShare(total: number, count: number, index: number, currency: string): number {
  const base = floorToCoin(total / count, currency);
  return index === count ? total - base * (count - 1) : base;
}

/**
 * What paying some lines costs: their share of the total (so discount and
 * service charge are shared in proportion), rounded to whole coins. When
 * these lines are the last unpaid ones, the payment takes exactly what's
 * left, so the bill adds up.
 */
export function itemsAmount(input: {
  linesMinor: number;
  subtotalMinor: number;
  totalMinor: number;
  /** Already held by other live payments. */
  heldMinor: number;
  /** These are the last lines nobody has covered yet. */
  isLast: boolean;
  currency: string;
}): number {
  if (input.isLast) return input.totalMinor - input.heldMinor;
  if (input.subtotalMinor === 0) return 0;
  const share = roundToCoin(
    (input.linesMinor * input.totalMinor) / input.subtotalMinor,
    input.currency,
  );
  return Math.min(share, input.totalMinor - input.heldMinor);
}
