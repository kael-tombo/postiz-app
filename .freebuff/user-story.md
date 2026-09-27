# User Story: "The Self-Hosted Content Engine"

Aligned with Postiz's vision: **open-source, self-hosted, privacy-first social
media scheduling** where *your data never leaves your server*, with automation
as a first-class citizen (Public API, MCP, webhooks) rather than an add-on.

---

## Persona

**Maya** — runs a two-person indie studio. She is privacy-conscious and
cost-conscious: she self-hosts Postiz on a $10 VPS instead of paying for a SaaS
scheduler, and she refuses to hand her (and her clients') social tokens to a
third-party cloud. She is comfortable with Docker but does not want to babysit
the stack. She also automates everything — if a feature can't be driven by the
Public API, she won't use it for long.

## Story

> **As a** self-hosting studio owner,
> **I want to** create my workspace, invite my teammate, connect my own
> developer-app channels, schedule a week of content, and drive the whole
> pipeline from a script,
> **so that** I own my data end-to-end, pay nothing per seat, and my posting
> keeps working even if I'm offline.

### Acceptance criteria (each maps to a tested feature)

| # | Criterion | Verified by |
|---|-----------|-------------|
| 1 | I can register and start working **without any email provider** — the instance auto-activates me | `POST /auth/register`, `/auth/can-register` |
| 2 | My session is real: profile, org, tier limits and my **personal API key** come back from `/user/self` | `GET /user/self` |
| 3 | I control notifications (success / failure / streak) — they persist | `GET/POST /user/email-notifications` |
| 4 | I can **invite a teammate** by email; the invite is a signed URL the teammate accepts; I can remove them again | `POST /settings/team`, `POST /user/join-org`, `DELETE /settings/team/:userId` |
| 5 | The invite link is **stateless** — no pending-row babysitting; the JWT carries the grant and expires | invite token consumed via `join-org` |
| 6 | I can **organize content** with colored tags (create, rename) | `POST/PUT/GET /posts/tags` |
| 7 | The **calendar** reads cleanly even when empty | `GET /posts?startDate&endDate` → `{p:[]}` |
| 8 | Validation is honest: a post with **no connected channel is rejected**, not silently queued | `POST /posts` → 400 |
| 9 | **Find-slot** works even with zero channels (sane default, no hang) | `GET /posts/find-slot` |
| 10 | My **API key works on the Public API** — list integrations, check connectivity — and a forged key is rejected with 401 | `GET /public/v1/*` with/without key |
| 11 | **Rotating the key kills the old one** (theft self-healing) | old key → 401, new key → 200 |
| 12 | Privileged public endpoints are **denied** to normal orgs (403, not leaked) | `GET /public/v1/users` |
| 13 | Forged sessions and privilege escalation (impersonation, foreign org switch) are **rejected** | forged JWT → 401, impersonate → denied |
| 14 | Settings, team, media and calendar screens render in the **browser UI**, not just API | UI walkthrough |

## Why this matches the philosophy

- **Self-host first**: every criterion passes with zero cloud services —
  no email provider, no Stripe, no storage bucket. Defaults are sane.
- **Your keys, your data**: the story never assumes Postiz holds secrets; the
  API key belongs to the org and is rotatable.
- **Automation is a citizen, not a premium**: the Public API is tested in the
  same breath as the UI, and auth/rotation/validation all behave like a real
  developer platform.
- **Honest validation over silent failure**: no channel → no post. The system
  tells you (400) instead of promising a delivery that will never happen.
