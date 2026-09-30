# SocialFlow — UI/UX Assessment: Integrations (Channels)

**Scope:** `launches/add.provider.component.tsx`, `internal.channels.tsx`, `launches.component.tsx` (channel list section), provider redirect flow
**Verdict:** 6.5/10 — 40+ providers with a working OAuth/redirect flow and per-channel actions (refresh, reconnect, delete), but the provider grid is an undifferentiated wall of logos and unhealthy channels don't demand attention.

## Findings

| ID | Severity | Finding |
|----|----------|---------|
| G1 | High | Broken/disabled channels (bad token, needs reconnect) are not visually prioritized — the #1 operational task hides among healthy rows. |
| G2 | Medium | No search/filter over 40+ providers when adding; scanning is alphabetical only. |
| G3 | Medium | Category grouping (social / blog / messaging) absent — providers of wildly different kinds sit together. |
| G4 | Low | Channel card metadata (added date, plug state) inconsistent. |
| G5 | Low | Delete flow exists with confirm (good), but no "what breaks" explanation (scheduled posts on it). |

## Non-goals this round
- Restructuring the provider catalog backend grouping.
