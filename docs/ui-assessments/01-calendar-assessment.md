# SocialFlow — UI/UX Assessment: Calendar (Home)

**Scope:** `launches.component.tsx`, `calendar.tsx`, `filters.tsx`, `calendar.context.tsx`, `menu/`, `new.post.tsx`
**Verdict:** 7/10 — the core surface is strong (drag & drop week/month/list views, channel sidebar with connect states, week/day/month toggle, empty states). Gaps are mostly affordance and feedback, not structure.

## Findings

| ID | Severity | Finding |
|----|----------|---------|
| C1 | High | Leftover Postiz purple gradients in `SVGLine` (channel connector) — fixed this round (swept to teal). |
| C2 | High | Drag-to-schedule has no drop-target highlight on day columns — users can't see where a post will land until release. |
| C3 | Medium | Week view shows hour rows from 0:00 with today's column only subtly marked; no "current time" indicator line. |
| C4 | Medium | Empty state ("No posts") is bare text in the grid; no CTA to create the first post. |
| C5 | Medium | Filter pills (All/Scheduled/Draft/Published) and Day/Week/Month toggle lack aria-pressed semantics — screen readers can't tell which is active. |
| C6 | Low | Left channels panel: no search/filter when many channels; scrollbar styling only. |
| C7 | Low | Date navigation uses raw arrows; no keyboard shortcuts (T=today, arrows=prev/next period). |

## Non-goals this round
- Rebuilding the drag & drop layer (react-dnd → dnd-kit migration).
- Virtualizing the month view.
