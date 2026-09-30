# Auth + Onboarding — Improvements & Implementation

Companion to `08-auth-onboarding-assessment.md`.

## I1 ✅ Password visibility toggle (B1, partial)
Show/hide eye toggle on the auth password field (sign-up + sign-in).
Strength meter deferred (needs zxcvbn or heuristic — batched later).

## I2 ✅ Onboarding skip affordance (B2, partial)
"Continue without channels" restyled from a low-contrast violet gradient
to a clear secondary outline button — skipping is now an honest first-class
choice instead of a hidden escape hatch. Provider search in onboarding is
deferred (same catalog component as Integrations I2).

## I3 ✅ Auth mode toggle prominence (B3)
"Sign in"/"Sign up" switch link converted to an outlined secondary button
row — mode switching is discoverable.

## I4 ⏳ Testimonial clipping (B4), OAuth error states (B5)
Deferred — B4 needs a scroll/fade rework; B5 needs error-code mapping
from the OAuth round-trip.
