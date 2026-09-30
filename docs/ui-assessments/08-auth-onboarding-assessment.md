# SocialFlow — UI/UX Assessment: Auth + Onboarding

**Scope:** `app/(app)/auth/*`, `logo-text.component.tsx`, `testimonial.component`, `onboarding.modal.tsx`, `onboarding.tsx`
**Verdict:** 7.5/10 after this round's rebrand — the sign-up/sign-in split panel with rotating testimonials is a strong pattern; the flow-wave logo + teal CTA landed well. Remaining gaps are mostly flow polish.

## Findings

| ID | Severity | Finding |
|----|----------|---------|
| B1 | Medium | Password field has no visibility toggle and no strength hint on sign-up. |
| B2 | Medium | Onboarding "Connect Channels" step is a 40-logo wall — no search, no skip affordance hierarchy (the real skip button is bottom-right, low-contrast). |
| B3 | Low | Sign-in/sign-up toggle is a text link below the form; easy to miss. |
| B4 | Low | Testimonial column is static-height with fade — tall cards clip abruptly on short viewports. |
| B5 | Low | OAuth error states (provider denied, callback failure) surface as raw toasts. |

## Already fixed this round (pre-assessment)
- Postiz wordmark → SocialFlow wordmark + flow glyph.
- Hardcoded pink `#FC69FF` accent → teal `#5EEAD4`.
- Purple gradient CTA buttons → teal gradients.
- Form inputs follow the theme (dark teal tint).
