import type { YahooKey } from "./fetchers";

// Display currency for the four dollar-priced tiles (BTC, gold, copper,
// brent). The other four are not dollar amounts — yields are percentages,
// DXY is a unitless index, and USD/JPY is itself a USD pair — so they
// render identically whatever is selected here.
export type Currency = "USD" | "CAD" | "INR";

type CurrencyInfo = {
  // Prefix on the price and the absolute change.
  symbol: string;
  // Yahoo key for the rate, in units of this currency per USD. USD is the
  // base and needs no fetch, so the default view costs no extra requests.
  rateKey: YahooKey | null;
  // How the footer discloses the rate actually applied.
  pair: string;
  rateDecimals: number;
};

export const CURRENCIES: Record<Currency, CurrencyInfo> = {
  USD: { symbol: "$", rateKey: null, pair: "USD", rateDecimals: 2 },
  CAD: { symbol: "C$", rateKey: "cad", pair: "USD/CAD", rateDecimals: 4 },
  INR: { symbol: "₹", rateKey: "inr", pair: "USD/INR", rateDecimals: 2 },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES) as Currency[];

// Persisted like the theme so a returning visitor keeps their choice. Its
// own key, not shared with satusd.com — that site has no currency concept.
const STORAGE_KEY = "mp-currency";

export function loadCurrency(): Currency {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in CURRENCIES) return saved as Currency;
  } catch {
    // private mode / storage disabled — fall through to the default
  }
  return "USD";
}

export function saveCurrency(currency: Currency) {
  try {
    localStorage.setItem(STORAGE_KEY, currency);
  } catch {
    // best-effort, same as the theme toggle
  }
}
