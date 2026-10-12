/**
 * Money is stored as integers in ISO 4217 minor units (§15, §22): AMD has an
 * exponent of 2, so 3 500 ֏ is stored as 350000. Never use floats for money.
 */
const EXPONENT: Record<string, number> = { AMD: 2, USD: 2, EUR: 2, RUB: 2, GEL: 2 };

export const currencyExponent = (currency: string) => EXPONENT[currency] ?? 2;

/** "3500" / "3500.5" (major units, as typed) → minor units; null if not a valid amount. */
export function toMinorUnits(major: string | number, currency: string): number | null {
  const text = String(major).trim().replace(/\s/g, "").replace(",", ".");
  const exponent = currencyExponent(currency);
  if (!new RegExp(`^\\d+(\\.\\d{1,${exponent}})?$`).test(text)) return null;
  const [whole = "0", fraction = ""] = text.split(".");
  return Number(whole) * 10 ** exponent + Number(fraction.padEnd(exponent, "0"));
}

/** Minor units → major-unit string for form inputs ("3500", "3500.5"). */
export function toMajorUnits(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  const whole = Math.trunc(minor / 10 ** exponent);
  const fraction = String(minor % 10 ** exponent)
    .padStart(exponent, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

const SYMBOL: Record<string, string> = { AMD: "֏", USD: "$", EUR: "€", RUB: "₽", GEL: "₾" };
const NBSP = "\u00a0";
/** Thousands / decimal separators per UI language. */
const SEPARATORS: Record<string, { group: string; decimal: string }> = {
  hy: { group: NBSP, decimal: "," },
  ru: { group: NBSP, decimal: "," },
  en: { group: ",", decimal: "." },
};

/**
 * Display a price, e.g. "3 500 ֏" (hy) or "3,500 ֏" (en); whole amounts have
 * no decimals. Deliberately not Intl.NumberFormat: some browsers (notably
 * Chrome on Android) ship without Armenian locale data and would show
 * "AMD 3,500" — and server and browser output must match for hydration.
 */
export function formatMoney(minor: number, currency: string, locale: string): string {
  const exponent = currencyExponent(currency);
  const { group, decimal } = SEPARATORS[locale.split("-")[0] ?? "en"] ?? SEPARATORS.en!;
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = String(Math.trunc(abs / 10 ** exponent)).replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const fraction = abs % 10 ** exponent;
  const amount = fraction ? `${whole}${decimal}${String(fraction).padStart(exponent, "0")}` : whole;
  return `${sign}${amount}${NBSP}${SYMBOL[currency] ?? currency}`;
}
