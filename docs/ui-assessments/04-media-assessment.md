# SocialFlow — UI/UX Assessment: Media

> **2026-10 redesign update:** the modern-minimal redesign (docs/redesign/plan.md, commit 4e98302f) re-pointed all theme tokens to the neutral zinc/slate system with hairline cards and soft shadows. Per-item resolution status lives in the companion `-improvements.md`.

**Scope:** `media/media.component.tsx` (999 lines), `new.uploader.tsx` (Uppy), media picker modal, pagination
**Verdict:** 7/10 — dense but capable: grid + sort, drag-and-drop upload, AI image/video generation entry points, pagination, insert/settings actions. Costs: a 999-line god component, small hit targets in the hover overlay, and no multi-select batch actions.

## Findings

| ID | Severity | Finding |
|----|----------|---------|
| M1 | High | 999-line component mixes uploader, grid, picker-modal, pagination, AI modals — refactor candidate (tracked, not this round). |
| M2 | Medium | Grid item hover overlay packs 5 icon actions (insert, settings, design, drag, delete) at small sizes — mis-clicks likely; delete has confirm dialog (good) but sits next to safe actions. |
| M3 | Medium | No multi-select → no batch delete/move; one-by-one cleanup is painful for large libraries. |
| M4 | Low | Upload progress relies on Uppy dashboard defaults (visual mismatch with theme). |
| M5 | Low | Search debounce exists, but no filter by type (image/video) or date. |

## Non-goals this round
- Splitting the component (M1) — structural refactor with real regression risk; schedule separately.
