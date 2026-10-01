# Global Shell — Improvements & Implementation

Companion to `00-shell-assessment.md`. Items marked ✅ are implemented in this round.

> **2026-10 redesign update:** the modern-minimal redesign
> (`docs/redesign/plan.md`, commit `4e98302f`) re-pointed all theme tokens
> to the neutral zinc/slate system (hairline borders, `shadow-card` depth,
> teal as the single accent). Items below reflect the post-redesign state;
> the two deferred items are *not* resolved by it.

## I1 ✅ Keyboard focus ring (S1)
Replaced the blanket `body * { outline: none }` with a `:focus-visible` ring
(`--new-btn-primary`, 2px, 2px offset) in `global.scss`. Mouse clicks stay
ring-free; Tab now shows where you are app-wide. This benefits every menu below.

## I2 ✅ Visible active indicator (S3)
`menu-item.tsx`: active items render a quiet **whisper-accent pill**
(`--new-box-focused` surface + accent text/icon) — introduced by the
redesign, replacing this round's original 3px left-edge bar. Active is
still recognizable at a glance, now without a hard edge.

## I3 ✅ Tooltips + aria-labels on top-bar controls (S4, S7)
`mode.component` (theme toggle), `language.component`, and the extension icon
now carry `aria-label` + `title` (tooltip via existing ToolTip wrapper where
present). The top bar is no longer guess-the-icon.

## I4 ✅ Larger hit targets + labels in the rail (S2, partial)
Menu item min height raised (54→58px collapsed label mode), label size
9px→10px floor, and `title` attributes on every item. Full rail
collapse/expand with wider labels deferred (see Non-goals).

## I5 ✅ Surface elevation (S5)
Superseded by the redesign: sidebar (rail 64→68px in an 84px column) and
content surface are now hairline cards — `--new-border` + `rounded-[16px]`
+ `shadow-card` — and the topbar slimmed 80→64px with an 18px/600 title
and hairline divider. Panels read as surfaces in both modes.

## I6 ⏳ Mobile drawer (S6)
Deferred: needs a layout-level breakpoint refactor. Tracked for a later round.
*Not addressed by the redesign (which kept the fixed sidebar).*

## I7 ⏳ Rail collapse/expand toggle
Deferred with I6 — same breakpoint contract risk.
*Not addressed by the redesign (which widened the rail slightly, 64→68px, but kept it fixed).*
