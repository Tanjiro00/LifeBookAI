export type AccentKey = "quiet" | "bronze" | "ochre" | "swamp" | "burgundy" | "charcoal";

export const ACCENT_COLORS: Record<AccentKey, { stripe: string; ink: string; tintTop: string }> = {
  quiet:    { stripe: "#7E8FA1", ink: "#3D4A57", tintTop: "rgba(126,143,161,0.10)" },
  bronze:   { stripe: "#9A6A43", ink: "#6F4A2C", tintTop: "rgba(154,106,67,0.12)" },
  ochre:    { stripe: "#C7903F", ink: "#8E6726", tintTop: "rgba(199,144,63,0.13)" },
  swamp:    { stripe: "#4F6B53", ink: "#36482F", tintTop: "rgba(79,107,83,0.10)" },
  burgundy: { stripe: "#7B2C2C", ink: "#561C1C", tintTop: "rgba(123,44,44,0.10)" },
  charcoal: { stripe: "#2E2A26", ink: "#15120F", tintTop: "rgba(46,42,38,0.13)" }
};

export function accentFor(key?: string | null) {
  const k = (key || "bronze") as AccentKey;
  return ACCENT_COLORS[k] ?? ACCENT_COLORS.bronze;
}
