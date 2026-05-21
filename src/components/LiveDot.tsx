import { COLORS } from "../lib/theme";

export function LiveDot() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: COLORS.amber,
        marginRight: 6,
        verticalAlign: "middle",
        animation: "livePulse 1.6s ease-in-out infinite",
      }}
    />
  );
}
