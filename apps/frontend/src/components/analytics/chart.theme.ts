// Chart.js draws onto a <canvas>, so it cannot resolve CSS var() references
// the way DOM styling does. Re-exports the shared resolver (the canonical
// implementation lives in @gitroom/react/utils/css.var); chart effects re-run
// when the `mode` cookie flips, so charts re-theme in sync with the app.

export { cssVar, withAlpha } from '@gitroom/react/utils/css.var';
