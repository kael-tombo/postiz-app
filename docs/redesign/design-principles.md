# SocialFlow — Design Principles (Baseline → Adopted Ruleset)

Baseline ruleset audited against the actual product: the Postiz fork with the
SocialFlow teal rebrand + modern-minimal redesign (commits `5f950c85`,
`4e98302f`, `d52b56a5`). Evidence cites our own audit artifacts:
`docs/ui-assessments/*` (9 area assessments), live preview verification in
dark+light, and the component/token code. "How to test" is phrased so anyone
can run it against the running app (`:4200`).

Status legend: **KEEP** (rule adopted as-is) · **ADAPT** (adopted with the
noted change) · **REJECT** (not adopted for this product, reason given) ·
**NEW** (revealed by this research).

## GLOBAL

| ID | Rule | Status | Evidence | How to test |
|----|------|--------|----------|-------------|
| G1 | One primary action per screen | ADAPT | New Post is the calendar's primary; but Calendar toolbar shows filter pills, view switch, add-channel at equal weight (`calendar.tsx`, `filters.tsx`). Enforce: one solid-accent button per toolbar; others quiet/outline. | Per screen, exactly one element uses the solid accent fill; screenshot audit each area. |
| G2 | Consistency over novelty | KEEP | Token-driven system (`colors.scss` → `tailwind.config.cjs`) + assessment docs enforce reuse; pill/hairline/card patterns repeat everywhere (4e98302f). | Any new surface must be buildable from existing tokens + documented patterns only; grep for one-off hexes. |
| G3 | Every screen answers where/what/next | ADAPT | "Where": active pill + title (menu-item.tsx, Title). "What next": strong in empties (C8 work), weak in populated states — statistics live behind per-post menus with only a hint (analytics I2). | New-user walkthrough: on each screen they can name location + one next action in <5s. |
| G4 | Design all states | ADAPT | Empty ✓ (all 9 areas, ui-assessments), loading ✓ (`LoadingComponent`, media skeletons), success via toasts ✓; **error states thin** — OAuth failure codes unmapped (08-auth I4), no offline handling. | For each async surface, force failure (devtools offline / bad payload) and check a designed error appears. |
| G5 | Reduce steps and decisions | ADAPT | Agent starter chips seed prompts (02-agent I2); scheduling defaults exist. Gap: channel reconnect requires navigating Integrations manually. | Count clicks for top 5 jobs (schedule post, reconnect channel, add media): ≤3 each. |
| G6 | ≤100ms action feedback | ADAPT | 0.15s hover/active transitions on chrome (`global.scss`); no press feedback on buttons; async buttons show spinners but not optimistically. | Click any button: visual acknowledgement within 100ms (transition start counts). Audit with slow 3G. |
| G7 | Accessibility baseline | ADAPT | Focus ring ✓ (S1), aria-pressed/labels ✓ (round 20), 58px rail targets ✓. Gaps: full keyboard map missing (calendar C7), contrast of muted text borderline in some spots, screen-reader pass never run end-to-end. | axe/DevTools audit per area = 0 criticals; Tab-only tour completes every core job; contrast checker on token pairs ≥4.5:1. |

## NAVIGATION AND MENUS

| ID | Rule | Status | Evidence | How to test |
|----|------|--------|----------|-------------|
| N1 | Nav reflects user goals | KEEP | Rail = Calendar/Agent/Analytics/Media/Plugs/Integrations/Settings — task-named, user language (`top.menu.tsx`). | Card-sort with 5 users: labels match their words for the jobs. |
| N2 | Mobile: 3-5 bottom tabs | ADAPT | No mobile nav exists at all (00-shell I6 deferred; fixed 84px sidebar). Adopt as target: bottom bar with Calendar/Agent/Media/More when mobile layout lands. | At ≤430px width, primary destinations reachable one-handed; no horizontal scroll. |
| N3 | Persistent sidebar 5+ sections | KEEP | Implemented + redesigned as hairline card (4e98302f). | Sidebar visible on all 7 areas at desktop width. |
| N4 | Always show location | KEEP | Whisper pill + `aria-pressed` context + 18px page title; verified live (menu-item.tsx). | On any screen, current area is identifiable without scrolling. |
| N5 | Max 2 hierarchy levels | KEEP | Rail → area → panels; deeper content uses modals/tabs (settings tabs, plugs list/detail). | No screen requires 3+ visible nav levels to reach content. |
| N6 | Icons paired with labels | KEEP | Rail icons have 10px labels; icon-only topbar controls carry aria-label+title (I3). | Hover/tap any icon: label or tooltip appears; screen reader announces it. |
| N7 | Thumb reach; destructive separated | ADAPT | Destructive separated + confirmed ✓ (media delete M2, deleteDialog). Thumb-reach N/A until mobile exists (pairs with N2). | Delete actions never adjacent to primary CTAs; on mobile, in bottom 2/3 of screen. |
| N8 | Search + command palette | NEW ✅ (implemented) | `command-palette.tsx`: Ctrl/Cmd+K opens a keyboard-first launcher — jump to all 8 areas, New post (event bridge to the calendar composer), Add channel, Theme toggle (via `modeEmitter`, now listener-synced). Filter + arrows + Enter; tokens only. Verified live. | Ctrl/Cmd+K opens; type to filter; Enter runs; Esc closes — confirmed in preview. |
| N9 | Menus grouped, destructive separated | KEEP | Rail splits firstMenu/secondMenu; destructive flows confirm (`delete.dialog`). | Visual grouping check + destructive always confirms with specific wording. |
| N10 | Nav stable across screens | KEEP | Rail identical everywhere (verified across all area screenshots). | Screenshot diff of rail across areas: identical order/position. |

## LANDING PAGES

| ID | Rule | Status | Evidence | How to test |
|----|------|--------|----------|-------------|
| L1-L10 | Hero test, single CTA, proof, product demo, scroll narrative, 3-tier pricing, FAQ objections, perf budget, mobile-first | KEEP (deferred scope) | The marketing page is upstream Postiz's; this round's redesign scoped the **app** UI. Rules retained verbatim for the future marketing pass — brand sweep already applied teal there (onboarding/launches gradients, commit 5f950c85). | Run the cold-user 5-second test + Lighthouse mobile audit when the landing pass starts; LCP <2.5s on mid-range Android. |

## ONBOARDING AND FIRST RUN

| ID | Rule | Status | Evidence | How to test |
|----|------|--------|----------|-------------|
| O1 | Time to first value | KEEP | First value = scheduled post; empty calendar CTA + channel-empty guidance route straight there (01-calendar I4). | % of new signups reaching a scheduled post in session 1 (add analytics event to measure). |
| O2 | Ask only what's needed now | ADAPT | Onboarding modal asks channels first ✓; but tier/billing surfaces early for FREE users (FirstBillingComponent). | Inventory every onboarding question: can it be deferred to first relevant use? |
| O3 | Skippable, never trapped | KEEP | "Continue without channels" is a first-class outlined button (08-auth I2/B2). | Complete onboarding with zero channels; no dead end. |
| O4 | Teach in context | KEEP | Plugs explainer (P1), agent starter chips (A2), analytics framing (N1), media empty-state hint — all contextual, no tutorial. | No modal-only tutorial exists; help appears at point of use. |
| O5 | Show progress in multi-step flows | ADAPT | Provider connect shows step states ("Needs reconnect" badges, inBetweenSteps sort, launches I1). Onboarding modal has no explicit step indicator. | Any multi-step flow displays step x of y and what remains. |
| O6 | Permission at moment of need | KEEP | No upfront permission walls; OAuth requested when adding a channel. | No permission prompt appears before the action that needs it. |
| O7 | Paywall shows value first | ADAPT | FREE tier sees billing CTA early (FirstBillingComponent) — borderline. Trial terms visible in billing; dismissal obvious (closable). Ensure feature-gated buttons explain the upgrade, not just block. | Gated action shows why + price + path; Esc/click-outside always closes paywalls. |

## FORMS AND INPUT

| ID | Rule | Status | Evidence | How to test |
|----|------|--------|----------|-------------|
| F1 | Single column, labels above | KEEP | Auth forms, settings panels, composer fields: label-above pattern via shared `Input` (`react-shared-libraries/src/form/input.tsx`). | Audit forms: no side-by-side label layouts; placeholders never sole labels. |
| F2 | Inline validation on blur, specific messages | ADAPT | react-hook-form wired; errors render (e.g. `text-[12px] text-red-400` in media component) but message quality varies and validation timing not standardized. | Blur any required field empty: specific, fix-stating message appears inline (not on submit). |
| F3 | Right input types, autofill | ADAPT | Email/password inputs use proper types + visibility toggle (B1); date inputs in composer unverified for keyboard type. | Check `type`/`inputMode`/`autocomplete` attrs on all inputs; browser autofill completes signup. |
| F4 | Mark optional, not required | ADAPT | Forms are short; convention not established. Adopt asterisk-free: label optional fields explicitly. | Optional fields visibly marked; zero required-field markers. |
| F5 | Preserve input on error | KEEP | react-hook-form keeps values in-place; draft state survives failed submits. | Submit invalid form → values intact; navigate away and back where the flow allows. |
| F6 | Verb-first submit labels | KEEP | "Sign in"/"Sign up", "Schedule", "Add Channel" — action-named (verified across areas). | Grep for Submit/OK/Confirm in button labels: none. |
| F7 | Chunk long forms | ADAPT | Settings chunked into tabs ✓; **post composer is one long modal** — the biggest form in the product. | Composer sections collapsible or stepped with summary before publish. |

## DATA: TABLES, LISTS, DASHBOARDS

| ID | Rule | Status | Evidence | How to test |
|----|------|--------|----------|-------------|
| D1 | Lead with the answer | ADAPT | Analytics cards show total + trend up top ✓; calendar leads with the grid ✓. Stars table buries totals in rows. | Key number visible without scrolling on each data screen. |
| D2 | Tables: sort/filter/sticky/row actions | ADAPT | Stars table: static. Media grid: filter chips + pagination ✓. Adopt: sortable columns + row hover actions on the stars table. | Header click sorts; row actions appear on hover/focus. |
| D3 | Density option | REJECT | Over-engineering for current user scale; one comfortable density ships. Revisit only with evidence of power-user demand (usage telemetry or requests). | — (rejected; revisit trigger documented). |
| D4 | One message per chart, direct labels, zero baseline, colorblind-safe | ADAPT | Charts token-driven + re-theme on flip (d52b56a5); `beginAtZero` ✓; legends hidden, values via tooltip — adopt direct end-labels for the last point. Palette teal/green/blue is colorblind-acceptable but unverified. | Each chart states one thing; deuteranopia simulation distinguishes series; bars/lines start at zero. |
| D5 | Designed empty/loading/error | ADAPT | Empty ✓ all areas; skeleton ✓ (media 16-shimmer, LoadingComponent); error states thin (pairs G4). | Same test as G4. |
| D6 | Persist filters, make visible | ADAPT | Calendar filter is component state — lost on reload. Persist to query param or cookie; show clearable chips. | Apply filter → reload → filter survives with a visible chip to clear. |
| D7 | Pagination/virtualization | KEEP | Media paginates with 10-window ✓; lists bounded. | No unbounded list endpoint rendered raw; large sets paginate. |

## COMPONENTS

| ID | Rule | Status | Evidence | How to test |
|----|------|--------|----------|-------------|
| C1 | Components documented (variants/states) | ADAPT | No formal component docs; the 9 assessments + this doc serve as usage rules. Adopt: document Button/Input/Modal/Toast states in `docs/redesign/components.md` as they stabilize. | For each core component: doc lists default/hover/focus/active/disabled/loading/error. |
| C2 | Tokens only, no hardcoded values | ADAPT | Sweeps in 5f950c85 + 4e98302f + d52b56a5 killed brand literals; **remaining**: canvas/embed hardcodes now resolved (`chart.theme`, `css.var`), but editor internals + some SVG fills still hardcode. | `grep -rn '#[0-9a-fA-F]\{6\}' components/` shrinks each sprint; new code review blocks one-off hexes. |
| C3 | Visible focus everywhere | KEEP | `:focus-visible` ring app-wide (S1). | Tab through every screen: focus always visible, never clipped. |
| C4 | Button hierarchy incl. destructive | ADAPT | Primary (accent), secondary (btnSimple) exist; destructive styling inconsistent (red text in places, solid red in others — danger zone vs media delete). Adopt one destructive pattern. | Inventory buttons: exactly 4 classes of styling; destructive uses the red pattern everywhere. |
| C5 | Modals for blocking only | ADAPT | Composer/media-picker modals justified (blocking focus). Many confirms already inline. Audit borderline modals (settings sub-dialogs) for popover/sheet conversion. | List all modals; each is either blocking-by-nature or converted; all close via Esc ✓ (new-modal supports). |
| C6 | Toasts non-critical + undo | ADAPT | Toaster ✓ auto-dismiss ✓; **no undo anywhere**. Adopt undo for delete-media (trash-state) as first case. | Non-blocking confirmations appear as toasts; destructive toasts carry Undo for ≥5s. |
| C7 | Destructive: confirm or undo | KEEP | `deleteDialog` with specific wording ✓ ("Are you sure you want to delete…"). Adopt undo (C6) as the preferred upgrade. | Every destructive flow: specific confirm or undo; generic confirms flagged. |
| C8 | Empty states explain + one action | KEEP | Every area's empty state names what belongs + one CTA (calendar, media, analytics, plugs, integrations — verified live). | Empty each surface as new user: explanation + exactly one primary action. |

## MOTION AND ANIMATION

| ID | Rule | Status | Evidence | How to test |
|----|------|--------|----------|-------------|
| M1 | Purposeful motion only | ADAPT | Existing motion is functional (fades, spinner, progress bar). No decorative animation found — keep it that way. | Animation inventory: each has an orient/feedback/attention purpose; else remove. |
| M2 | Duration bands | ADAPT | Chrome transitions 0.15s ✓; toasts/fades 0.2-0.5s; large modal transitions unmeasured. Standardize: 150/250/400ms tokens. | Measured durations fall in 100-200 / 200-300 / 400-500ms bands; nothing blocks input. |
| M3 | Easing conventions | ADAPT | `ease`/`ease-in-out`/`easeOutQuart` mixed ad hoc. Adopt ease-out-in / ease-in-out mapping (M3) as tokens. | Same class of transition uses same easing curve everywhere. |
| M4 | Transform/opacity only | ADAPT | Existing animations (fadeDown uses marginTop — layout property!). Fix to translateY. | DevTools paint flashing: animated elements don't repaint layout. |
| M5 | Shared-element continuity | REJECT (for now) | Would require framer-motion or hand-rolled FLIP across next.js route boundaries; cost outweighs value at current scope. Revisit if a hero flow (composer open from calendar) proves disorienting in usability tests. | — (rejection + trigger documented). |
| M6 | Skeletons >300ms waits | KEEP | Media grid skeleton, LoadingComponent, uppy progress determinate ✓. | Throttle network: waits >300ms show skeleton/progress, never a frozen pane. |
| M7 | Stagger ≤5 items, 30-60ms | REJECT (for now) | No list choreography exists; adding it is decoration until a UX test shows disorientation in dense lists. | — (rejected; revisit with the mobile pass). |
| M8 | Respect prefers-reduced-motion | KEEP (new impl) | **Implemented this round** (`global.scss` media query kills animations/transitions). | Toggle OS reduce-motion: no movement anywhere; meaning intact without motion. |
| M9 | Consistent motion language | ADAPT | Pairs M2/M3 — converge on the two duration + two easing tokens. | Token grep: durations/easings only from the motion tokens. |
| M10 | Gestures have alternatives | KEEP (deferred) | No gesture-only controls exist; rule auto-satisfied until mobile ships. | On mobile, every swipe/pull has a visible button equivalent. |

## VISUAL LANGUAGE

| ID | Rule | Status | Evidence | How to test |
|----|------|--------|----------|-------------|
| V1 | ≤2 type families, scale, body ≥16px web | ADAPT | Plus Jakarta Sans (shell) + system/Arial (editor previews) = 2 ✓. Type scale informal (10-48px, many one-offs); dense data UI at 14px is deliberate. Adopt: named scale (12/14/16/18/24/36) + 16px floor for reading surfaces (agent chat, explanations), 14px floor for dense data. | Font-size inventory maps to the scale; reading paragraphs ≥16px; line length 45-75ch (agent 820px ✓). |
| V2 | Neutral base + one accent + semantics, both modes same roles | KEEP | Exactly this: zinc neutrals, teal accent, violet reserved for AI, red/amber/green semantics — one token set, two modes (4e98302f). | Token file audit: roles map 1:1 across .dark/.light; no mode-only hues. |
| V3 | 4/8pt spacing scale | ADAPT | Values are 4-compatible but unsystematic (10/12/14/18/20 mixed). Adopt: 4/8/12/16/24/32/48 as the allowed set; migrate opportunistically. | Spacing audit: all gaps/paddings ∈ scale (report %, trend upward). |
| V4 | Hierarchy via size/weight/contrast first | KEEP | Whisper-pill active states, weight-first hierarchy; color only via accent (redesign verified both modes). | Grayscale screenshot: hierarchy still readable. |
| V5 | One icon set, one stroke weight | ADAPT | Mixed: hand-rolled stroke SVGs (top.menu) + lucide-style (media pagination) + filled brand icons. Adopt: one stroke set at 1.5-1.8 weight for UI chrome; brand marks exempt. | Icon inventory: UI icons share stroke width/style ±10%. |
| V6 | Imagery serves content, consistent style | KEEP | Plugs/analytics empty-state illustrations are one stock family; acceptable until brand art exists. | Illustration inventory: single style family. |
| V7 | Elevation sparing + consistent | KEEP | One card shadow token (`--sf-shadow-card`), hairline borders; menus/popovers only elevated surfaces. | Shadow usage audit: only overlay/overlay-adjacent surfaces cast shadows. |

## CONTENT AND MICROCOPY

| ID | Rule | Status | Evidence | How to test |
|----|------|--------|----------|-------------|
| T1 | Plain language, verbs, sentence case | KEEP | UI copy verified across areas ("Add Channel", "No channels yet", honest analytics framing). | Copy pass: no jargon without explanation; buttons all verbs. |
| T2 | Errors: what/why/how, no blame | ADAPT | MCP surface is exemplary (rounds 17-18 scoring); UI error strings thinner (OAuth B5 pending). Bring UI errors to the MCP standard. | Force each UI error: message names what happened + fix; no raw codes alone. |
| T3 | Tone guides, never jokes through failure | KEEP | Empty/error copy is factual + helpful (verified in assessments). | Read all error/empty copy aloud: no levity at failure points. |
| T4 | One word per concept | KEEP | "Plugs"/"Channels"/"Integrations" each mean one thing consistently; translations rebranded (18 locales). | Terminology table: each concept maps to exactly one UI word. |

## RESPONSIVE AND PLATFORM

| ID | Rule | Status | Evidence | How to test |
|----|------|--------|----------|-------------|
| R1 | Platform conventions unless researched otherwise | KEEP | Web conventions followed (Esc closes modals, toasts bottom, Cmd shortcuts where present). | Platform-convention checklist per surface. |
| R2 | Mobile-first, behavior per breakpoint | ADAPT | **Biggest structural gap**: app is desktop-only; breakpoints exist in tailwind (`mobile:` ≤1025px) and some components degrade (iconBreak) but no designed mobile layout. Adopt: mobile pass after N2 decision. | At 430px, every core job completable without horizontal scroll or pinch. |
| R3 | Touch + mouse + keyboard | ADAPT | Mouse ✓, keyboard partial (toggles, filters ✓; calendar/editor shortcuts C7 pending), touch untested. | Complete core jobs with keyboard-only and touch-only. |
| R4 | Safe areas, dynamic type | REJECT (for now) | Meaningful only once a mobile/native surface exists; desktop browser app. Revisit with R2 pass. | — (rejected; trigger: mobile pass kickoff). |

## PERFORMANCE AND TRUST

| ID | Rule | Status | Evidence | How to test |
|----|------|--------|----------|-------------|
| P1 | Perceived speed | ADAPT | SWR caching ✓, skeletons ✓ (M6); optimistic updates partial (scheduling UI updates post-hoc). Adopt optimistic add for calendar drops. | Drop-to-visible-post <100ms on fast network; spinner only for true waits. |
| P2 | Never lose user data | ADAPT | Composer keeps in-session state; **no draft autosave** — refresh loses the post. Highest-trust gap for a scheduling product. Adopt localStorage draft persistence per channel. | Type a draft → hard refresh → draft restored. |
| P3 | Explicit privacy/payments, no dark patterns | KEEP | Open-source, transparent pricing table, cancellable flows; no forced-continuity patterns found. | Billing audit: price/terms visible at commitment; cancellation ≤3 steps. |

## NEW RULES (revealed by this research)

| ID | Rule | Evidence | How to test |
|----|------|----------|-------------|
| X1 | Canvas/iframe surfaces resolve tokens at runtime via `cssVar()` and re-resolve on theme flip — never hardcode mode ternaries | `chart.theme.ts` + `@gitroom/react/utils/css.var` (d52b56a5); fixed Stripe billing embed hardcoding `#1E1E1E/#FFFFFF` | Toggle theme with a chart/billing surface open: colors flip without reload. |
| X2 | Every theme-dependent effect re-runs on mode change (effect deps include `mode`) | chart-social effect deps `[mode, list]` | Flip theme → canvas visuals update in place. |
| X3 | Segmented controls expose `role="group"` + `aria-pressed` per option | filters.tsx, media kind chips, calendar Day/Week/Month | Screen reader announces group + pressed state; axe passes. |
| X4 | Empty states must contain the action that fills them | calendar CTA, media upload, analytics link, plugs guidance | New-user test: from empty state, the filling action is one click. |
| X5 | Theme switch never requires reload | mode.component body-class flip + emitter; charts/billing re-resolve | Toggle theme on every area: instant, no white flash, no stale surfaces. |

## THE 5 PRINCIPLES THAT MATTER MOST FOR THIS PRODUCT

1. **Tokens only, two modes from one set (C2/V2/X1).** The entire redesign —
   rebrand, minimal system, charts, billing embed — composes through the token
   layer. It is what makes teal→anything rebrands, dark/light parity, and
   canvas theming mechanical instead of heroic. Test: no surface needs a
   hardcoded color to ship.
2. **Every state designed (G4/D5).** A scheduling tool's trust lives in the
   unglamorous states. We are strong on empty/loading and weak on error/offline
   — that's the next real UX moat. Test: force every failure mode; nothing
   shows a raw error or frozen pane.
3. **Always oriented: location + next action (G3/N4).** Multi-area app with a
   calendar-centric workflow; users must never wonder where they are or what
   to do next. Test: new-user walkthrough names both on every screen.
4. **Accessibility as baseline, not phase (G7/C3/X3).** Focus ring, ARIA
   states, 58px targets already shipped; keyboard-complete and contrast-clean
   are the finish line. Test: keyboard-only + screen-reader tour per area.
5. **Never lose a draft (P2).** The product's core promise is "your post goes
   out on time" — losing a composed post to a refresh breaks it worse than any
   visual bug. Test: hard-refresh mid-compose; the draft survives.

## Immediate rule-gap implementations this round

- M8: `prefers-reduced-motion` kill-switch in `global.scss`. ✅
- X1/C2: Stripe billing embed hardcoded grays → `cssVar()` tokens. ✅
- Shared `cssVar`/`withAlpha` promoted to `@gitroom/react/utils/css.var`. ✅
- N8: command palette (Ctrl/Cmd+K) — navigation + New post/Add channel/theme actions. ✅
