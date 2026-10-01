# SocialFlow UI Redesign — Plan

**Direction (user-selected):** modern minimal · polished sidebar shell · equal light/dark · plan → shell → areas.

## 1. Design principles

1. **Neutral surfaces, one accent.** Slate/zinc neutrals carry the UI; teal (`#0D9488` light / `#14B8A6` dark) is the *only* chromatic accent besides the violet AI accent (`--new-ai-btn`). No teal-tinted grays.
2. **Hairline borders, soft depth.** 1px `--new-border` borders + a new `--sf-shadow-card` (two-layer, near-invisible). No heavy glows.
3. **Quiet states.** Active/hover = a whisper of accent (`--sf-accent-weak`), never a saturated fill. Focus ring already exists (`:focus-visible`, kept).
4. **Calm geometry.** Radius scale: inputs/buttons 10px, cards 16px, sidebar 16px. Type: page titles drop 24px→18px/600.
5. **Both modes from one token set.** Same structure, mode-appropriate values; verified side by side.

## 2. Token strategy (highest leverage first)

The app is fully token-driven (`--new-*` + `--color-*` → Tailwind maps in `tailwind.config.cjs`), so **re-pointing the token values restyles every area at once**. All var names stay identical — zero component churn for the base pass.

- `apps/frontend/src/app/colors.scss` — new values for both `.dark`/`.light`:
  - Dark: canvas `#0E0F11`, cards `#16171A`, hairline `#232428`, text `#FAFAFA`, accent `#14B8A6`.
  - Light: canvas `#F6F7F8`, cards `#FFFFFF`, hairline `#E6E8EB`, text `#0B0C0E`, accent `#0D9488`.
  - New tokens: `--sf-accent-weak` (whisper accent surface), `--sf-shadow-card`, `--sf-radius-card/btn/input`.
- `tailwind.config.cjs` — map the new tokens (`accentWeak`, `shadow-card`, radii).
- `global.scss` — keep focus ring/scrollbars; selection → accent-tinted (not solid fill).

## 3. Shell rebuild

| Element | Change |
|---|---|
| Page frame | gap 12px, unified `bg-newBgColor` canvas |
| Sidebar | rounded-16 card: border + `shadow-card`, w 64→68, py 16 |
| Menu item | pill active state: `accentWeak` bg + teal text/icon; drop left bar; keep 58px targets, 10px labels |
| Logo | glyph unchanged (already brand); spacing tuned |
| Content surface | `bgColorInner` card w/ hairline border + `shadow-card`, rounded-16 |
| Topbar | 80→64px, title 24→18px/600, hairline `border-b`, right cluster gap 16 |

Files: `new-layout/layout.component.tsx`, `new-layout/menu-item.tsx`, minor `layout/top.menu.tsx`.

## 4. Area pass (after shell is verified live)

Each area gets *small, class-level* refinements — the token re-point already does the heavy lifting:

1. **Calendar** — toolbar/filter chrome to hairline cards; keep drop-tint, current-time line, CTA.
2. **Agent** — chat wrap + starter chips on `accentWeak`, input card hairline.
3. **Analytics** — empty-state callout → card + hairline; header framing kept.
4. **Media** — kind-filter chips → `accentWeak` pills; delete button quiet red.
5. **Plugs** — explainer → card; badges stay.
6. **Integrations** — provider search hairline; category grouping kept.
7. **Settings** — tabs stay icons+indicator; container cards hairline; danger zone stays.
8. **Launches list** — health badges restyle only.
9. **Auth/onboarding** — card on canvas, outlined mode-switch kept.

## 5. Verification

- Frontend `tsc --noEmit` clean.
- Live preview `:4200`: screenshot shell + each area in **dark and light** (`preview_set_color_scheme`).
- HMR renders token + class changes instantly; no backend dependency for visual pass.

## 6. Rollout

One commit at the end: `feat(ui): modern-minimal redesign — tokens, shell, all areas`. This doc updated with ✅ status per step.
