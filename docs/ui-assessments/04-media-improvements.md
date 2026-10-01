# Media — Improvements & Implementation

Companion to `04-media-assessment.md`.

> **2026-10 redesign update:** kind-filter chips quieted from a solid teal
> fill to the accent-weak token (`--new-box-focused` + focused text), search
> input on hairline borders with accent focus, grid cards on the neutral
> system. I4 (Uppy theming) is partially advanced — the surrounding page
> follows the tokens, but the Uppy dashboard chrome itself is untouched.

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
paired with the M1 refactor. *Not addressed by the redesign.*

## I4 ⏳ Themed Uppy dashboard (M4)
Uppy CSS overrides are global; needs a careful stylesheet to avoid
regressing the picker-in-editor usage.
*Partially advanced by the redesign (page surfaces around the uploader
follow the tokens); the Uppy dashboard chrome itself is still unthemed.*
