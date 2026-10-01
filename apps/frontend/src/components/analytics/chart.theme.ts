// Chart.js draws onto a <canvas>, so it cannot resolve CSS var() references
// the way DOM styling does. These helpers read the *resolved* token values at
// effect-run time. Chart effects re-run when the `mode` cookie flips (the
// theme class lives on document.body), so charts re-theme in sync with the
// rest of the app.

export const cssVar = (name: string, fallback: string): string => {
  if (typeof document === 'undefined') {
    return fallback;
  }
  const value = getComputedStyle(document.body)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
};

// Chart.js gradients need concrete color strings; convert a resolved #rrggbb
// token to rgba() with the requested alpha. Non-hex values pass through.
export const withAlpha = (color: string, alpha: number): string => {
  const hex = color.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return color;
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
