import { CURRENCY_CODES, type Currency } from "../lib/currency";

// Segmented USD/CAD/INR control in the header eyebrow, sized to match that
// row's uppercase micro-type. The active and hover states live in
// styles.css (.ccy-btn) — inline styles can't express :hover.
export function CurrencyPicker({
  value,
  onChange,
}: {
  value: Currency;
  onChange: (currency: Currency) => void;
}) {
  return (
    <span className="ccy-picker" role="group" aria-label="Display currency">
      {CURRENCY_CODES.map((code) => (
        <button
          key={code}
          type="button"
          className="ccy-btn"
          aria-pressed={value === code}
          title={`Show prices in ${code}`}
          onClick={() => onChange(code)}
        >
          {code}
        </button>
      ))}
    </span>
  );
}
