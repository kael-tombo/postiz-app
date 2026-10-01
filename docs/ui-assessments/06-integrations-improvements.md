# Integrations — Improvements & Implementation

Companion to `06-integrations-assessment.md`.

> **2026-10 redesign update:** provider cards, search field, and health
> badges all follow the neutral token system automatically via the
> re-point. No deferred item resolved (G5 is a backend query).

## I1 ✅ Unhealthy channels surface first (G1)
Channel list orders disabled/error-state channels to the top with a
warning tint + "Needs reconnect" badge — the operational task is now the
first thing seen.

## I2 ✅ Provider search (G2)
"Add Channel" modal gains a search input filtering providers client-side
(name match, case-insensitive) — finding WordPress among 40 logos is now
one keystroke.

## I3 ✅ Provider categories (G3)
Providers grouped under three labeled sections in the add modal:
Social, Blogging, Other (mapping by provider identifier list kept in one
place).

## I4 ⏳ Delete impact note (G5)
Deferred — needs a post-count lookup per channel (backend query), paired
with a backend touch. *Not addressed by the redesign.*
