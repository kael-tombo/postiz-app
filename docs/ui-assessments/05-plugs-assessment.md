# SocialFlow — UI/UX Assessment: Plugs (Auto-posting endpoints)

> **2026-10 redesign update:** the modern-minimal redesign (docs/redesign/plan.md, commit 4e98302f) re-pointed all theme tokens to the neutral zinc/slate system with hairline cards and soft shadows. Per-item resolution status lives in the companion `-improvements.md`.

**Scope:** `plugs/plugs.tsx`, `plugs/plug.tsx`, `plugs.context.ts`
**Verdict:** 6/10 — functional per-channel plug (webhook auto-post) management with enable/disable and secret handling, but it inherits the launches sidebar pattern and gives little guidance about what a "Plug" does on first visit.

## Findings

| ID | Severity | Finding |
|----|----------|---------|
| P1 | High | Zero onboarding copy: the page assumes you already know plugs are incoming-webhook auto-post endpoints; first-time users hit a channel list with no explanation. |
| P2 | Medium | Plug state (enabled/disabled) shown only by subtle styling; no status badge on the channel cards. |
| P3 | Medium | Secret/token reveal + copy has no feedback differentiation (plain copy toast). |
| P4 | Low | Reuses `SVGLine` connector — visual coupling to the Calendar sidebar. |
| P5 | Low | Empty state (no channels) shows an empty column rather than a redirect to Integrations. |
