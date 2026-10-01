// Resolving CSS custom properties to concrete color strings for surfaces
// that can't consume var() directly: canvas (Chart.js) and iframe embeds
// (Stripe Elements). Reads from document.body because the theme class
// (.dark/.light) is applied there by mode.component.

export const cssVar = (name: string, fallback: string): string => {
  if (typeof document === 'undefined') {
    return fallback;
  }
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value || fallback;
};

// Convert a resolved #rrggbb token to rgba() with the requested alpha.
// Non-hex values (rgb(), rgba(), named colors) pass through unchanged.
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
