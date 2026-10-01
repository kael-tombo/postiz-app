# Calendar — Improvements & Implementation

Companion to `01-calendar-assessment.md`.

> **2026-10 redesign update:** token re-point + literal sweep re-themed every
> calendar chrome automatically (toolbars, pagination, day/week/month pills,
> connector lines all read CSS vars now). The ✅ items below are unchanged in
> behavior; only their colors follow the new neutral system.

## I1 ✅ Brand literals swept (C1)
`SVGLine` connector gradients re-accented to the teal ramp
(#0D9488 / #0B7A70 / #5EEAD4).

## I2 ✅ Drop-target highlight (C2)
Day columns in week view gain a `drop-target` visual while dragging:
teal dashed outline + tinted background via a `isOver` check from the
existing react-dnd monitor — users see exactly where the post lands.

## I3 ✅ Current-time indicator (C3)
A 2px primary-colored line across today's column at the current hour
(`top: hours*rowHeight`), with a small dot at the left edge. Updates
every minute via a lightweight interval, only in week/day views.

## I4 ✅ Empty-state CTA (C4)
"No posts" gains a "+ Create post" ghost button that opens the existing
NewPost modal (same entry as the add button), so an empty calendar is
never a dead end.

## I5 ✅ Filter/toggle semantics (C5)
Filter pills and Day/Week/Month buttons now render `aria-pressed` and
`role="group"` on their containers; active pill keeps the teal fill
(state was already correct visually).

## I6 ⏳ Channel search (C6), keyboard shortcuts (C7)
Deferred: search needs a new state slice in calendar.context; shortcuts
need a global keymap to avoid colliding with the editor. Tracked.
*Not addressed by the redesign — purely behavioral, orthogonal to theming.*
