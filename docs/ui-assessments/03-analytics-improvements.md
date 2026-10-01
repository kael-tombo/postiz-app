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

## I4 ⏳ Chart theming + legend contrast (N4), date range/export (N5)
Deferred — chart lib re-theme is a larger sweep across chart.tsx /
chart-social.tsx; paired with the future social dashboard.
*Partially advanced by the redesign: surrounding cards/grid now follow
the neutral tokens, but `chart-social.tsx` still hardcodes its tooltip/
axis grays (`#1e1d1d`, `#9c9c9c`, `#2b2b2b`, …) and needs the lib-level
re-theme. Not resolved.*
