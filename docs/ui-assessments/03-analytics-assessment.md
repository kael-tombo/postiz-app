# SocialFlow — UI/UX Assessment: Analytics

**Scope:** `analytics.component.tsx`, `stars.and.forks.tsx`, `chart.tsx`, `chart-social.tsx`, `stars.table.component.tsx`
**Verdict:** 5/10 — this page currently reports *repo* analytics (GitHub stars/forks/trending), not social-channel performance; the real per-channel/per-post analytics live behind the Calendar's post menu and integrations. The page mislabels its intent for a social scheduler and leans on commented-out dead layout code.

## Findings

| ID | Severity | Finding |
|----|----------|---------|
| N1 | High | Page identity mismatch: "Analytics" shows GitHub stars/forks — social performance (the user's actual goal) is one click deeper or missing. |
| N2 | High | ~60 lines of commented-out dead layout shipped in the component. |
| N3 | Medium | No empty/error handling for orgs with no connected channels: charts render zeros instead of a connect-channels CTA. |
| N4 | Medium | Charts use hardcoded colors not tied to the theme; legend contrast unverified in dark mode. |
| N5 | Low | No date-range control or export. |

## Non-goals
- Building a full social-analytics dashboard (backend aggregation needed) — tracked as a feature, not a UI fix.
