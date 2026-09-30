# SocialFlow — UI/UX Assessment: Settings

**Scope:** `layout/settings.component.tsx` (tabbed shell: Global, Teams, Webhooks, Auto Post, Sets, Signatures, Developers, Approved Apps), `settings/*` panels
**Verdict:** 6/10 — feature-complete tab list with permission gating, but navigation is a plain 260px text list with weak active states, no section icons, and no mobile handling; panels are inconsistent in heading structure.

## Findings

| ID | Severity | Finding |
|----|----------|---------|
| T1 | Medium | Tab active state is a background tint only; no left-edge indicator consistency with the app shell (the SVGLine is hover-only). |
| T2 | Medium | No icons on tabs — 8 text items scan slowly. |
| T3 | Medium | Danger zone (Delete Account) sits at the same visual level as preference toggles. |
| T4 | Low | Panels have heterogeneous heading sizes/spacings (Global vs Teams vs API). |
| T5 | Low | Settings is a modal-style layout crammed into a page; no breadcrumbs back to app context. |

## Non-goals
- Restructuring into a route-per-tab (deep-linkable settings) — routing change.
