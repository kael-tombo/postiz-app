# Plugs — Improvements & Implementation

Companion to `05-plugs-assessment.md`.

> **2026-10 redesign update:** explainer restyled to a hairline card
> (`--new-border`, 10px radius); badges unchanged (they already read
> tokens). No deferred item resolved.

## I1 ✅ First-run explainer (P1)
Header block added: one sentence ("Plugs turn incoming webhooks into
scheduled posts on a channel — connect an automation (n8n, Zapier, curl)
to a channel and post to it without opening SocialFlow") rendered above
the list, dismissible per session.

## I2 ✅ Status badge (P2)
Channel cards with an active plug render a teal "Plug active" pill;
disabled ones a muted "Plug off" — state is scannable.

## I3 ✅ Empty state redirect (P5)
With no channels, the page shows guidance + a link to Integrations
instead of an empty rail.

## I4 ⏳ Copy feedback differentiation (P3), connector decoupling (P4)
Deferred — small polish, batched with the next plugs feature touch.
*Not addressed by the redesign.*
