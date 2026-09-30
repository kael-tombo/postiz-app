# SocialFlow — UI/UX Assessment: Global Shell (Sidebar + Top Bar)

**Scope:** `layout.component.tsx`, `menu-item.tsx`, `logo.tsx`, `top.menu.tsx`, `mode.component`, `organization.selector`
**Verdict:** 6/10 — solid fixed-sidebar pattern with a clear active state, but the rail is cramped, labels are tiny, the top bar is an unlabeled icon row, and there is no responsive behavior below desktop.

## Findings

| ID | Severity | Finding |
|----|----------|---------|
| S1 | High | `body * { outline: none !important }` kills ALL focus indicators — keyboard users are blind to position. |
| S2 | High | Sidebar 64px rail, 9–10px labels, 44–54px items — below comfortable touch/click targets; no collapse/expand. |
| S3 | Medium | Active item differs only by subtle bg/text tint; no left-edge indicator — low recognizability at a glance. |
| S4 | Medium | Top bar (80px) is a dense row of ~7 icon controls with no labels/tooltips for several; dividers help little. |
| S5 | Medium | Content area (`bg-newBgLineColor` wrapper, `gap-[1px]`) relies on background-color "borders" — looks flat in light mode. |
| S6 | Low | Sidebar has `custom:` breakpoint for collapsed icon-only mode, but below `lg` nothing adapts — no mobile drawer at all. |
| S7 | Low | Theme toggle (ModeComponent) has no tooltip/aria-label; same for language + extension icons. |

## Non-goals this round
- Mobile drawer navigation (needs a routing-level refactor; larger effort).
- Changing the rail width app-wide (risks breaking the `custom:`/`minCustom:` breakpoint contract).
