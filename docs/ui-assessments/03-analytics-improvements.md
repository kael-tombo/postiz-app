# Analytics — Improvements & Implementation

Companion to `03-analytics-assessment.md`.

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
