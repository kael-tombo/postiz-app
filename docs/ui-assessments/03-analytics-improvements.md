# Analytics — Improvements & Implementation

Companion to `03-analytics-assessment.md`.

> **2026-10 redesign update:** framing header and no-channels callout now
> render as hairline `shadow-card` rounded cards on the neutral system.
> N4 is partially advanced: page chrome follows the tokens, but the chart
> canvases (`chart-social.tsx`) still hardcode grays — see I4.

## I1 ✅ Dead code removed (N2)
Commented-out layout deleted from `analytics.component.tsx`.

## I2 ✅ Honest page framing (N1, partial)
Header section added above the charts: "Repository analytics" subtitle
clarifying what this page reports, with a hint that per-post performance
lives in each post's statistics menu on the Calendar. (Full social
dashboard = tracked feature.)

## I3 ✅ No-channels empty guidance (N3)
When the integration list is empty, a callout with an "Add Channel"
link renders above the charts instead of meaningless zero charts.

## I4 ✅ Chart theming (N4 — canvas colors) · ⏳ date range/export (N5)
Charts now read the design tokens: a shared `chart.theme.ts` helper
resolves `--new-*` vars via `getComputedStyle(document.body)` (canvas
can't resolve `var()` itself) and converts hex tokens to rgba for
gradients. `chart-social.tsx`: tooltip bg/title/body/border + hover
point ring all token-driven (the `mode === 'dark'` ternaries are gone);
the default scheme was renamed `purple`→`primary`, killing the leftover
Postiz purple `#612BD3` gradient that mismatched the already-teal dot
indicators. `chart.tsx`: the hardcoded white line (invisible on light
cards) and navy gradient replaced with the accent token. Effects re-run
on theme flip so charts re-resolve tokens. Callers updated to the
`primary` naming. Remaining: N5 date range/export — still deferred.
