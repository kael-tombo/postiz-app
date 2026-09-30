# Global Shell — Improvements & Implementation

Companion to `00-shell-assessment.md`. Items marked ✅ are implemented in this round.

## I1 ✅ Keyboard focus ring (S1)
Replaced the blanket `body * { outline: none }` with a `:focus-visible` ring
(`--new-btn-primary`, 2px, 2px offset) in `global.scss`. Mouse clicks stay
ring-free; Tab now shows where you are app-wide. This benefits every menu below.

## I2 ✅ Visible active indicator (S3)
`menu-item.tsx`: active items render a 3px left-edge bar in the primary color
plus an inset ring; hover state slightly raises background. Active is now
recognizable at a glance, not just by tint.

## I3 ✅ Tooltips + aria-labels on top-bar controls (S4, S7)
`mode.component` (theme toggle), `language.component`, and the extension icon
now carry `aria-label` + `title` (tooltip via existing ToolTip wrapper where
present). The top bar is no longer guess-the-icon.

## I4 ✅ Larger hit targets + labels in the rail (S2, partial)
Menu item min height raised (54→58px collapsed label mode), label size
9px→10px floor, and `title` attributes on every item. Full rail
collapse/expand with wider labels deferred (see Non-goals).

## I5 ✅ Surface elevation (S5)
Content wrapper gains a subtle border (`--new-border`) + `borderRadius`
consistency so panels read as surfaces in light mode instead of flat gaps.

## I6 ⏳ Mobile drawer (S6)
Deferred: needs a layout-level breakpoint refactor. Tracked for a later round.

## I7 ⏳ Rail collapse/expand toggle
Deferred with I6 — same breakpoint contract risk.
