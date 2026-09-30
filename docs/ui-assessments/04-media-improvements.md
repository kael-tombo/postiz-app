# Media — Improvements & Implementation

Companion to `04-media-assessment.md`.

## I1 ✅ Safer, clearer item actions (M2)
Overlay icons standardized: consistent 32px hit areas, tooltips on every
action, and Delete visually separated (danger tint) from the safe
actions so destructive clicks stop happening by proximity.

## I2 ✅ Type filter chips (M5, partial)
All / Images / Videos segmented filter added above the grid, filtering
client-side on the existing list (cheap win while the component is still
monolithic).

## I3 ⏳ Multi-select batch actions (M3)
Needs selection state threaded through sortable grid + picker paths —
paired with the M1 refactor.

## I4 ⏳ Themed Uppy dashboard (M4)
Uppy CSS overrides are global; needs a careful stylesheet to avoid
regressing the picker-in-editor usage.
