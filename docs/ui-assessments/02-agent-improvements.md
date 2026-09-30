# Agent — Improvements & Implementation

Companion to `02-agent-assessment.md`.

## I1 ✅ Brand theming of the chat (A1)
`--copilot-kit-primary-color` now maps to `--new-btn-primary` and the
background to `--new-bgColorInner`, so chat buttons/bubbles follow the
teal theme in both modes.

## I2 ✅ Starter prompts on empty thread (A2)
When no messages exist, four clickable starter chips (Create a post,
Plan a week, Best times, Repurpose content) seed the input — teaching
capability instead of a bare box.

## I3 ✅ Readable message column (A3)
Messages wrapper constrained to `max-w-[820px] mx-auto w-full` so long
threads stay readable on wide screens.

## I4 ⏳ Branded thinking indicator (A4)
Deferred — requires overriding CopilotKit internals; revisit after an
upgrade of @copilotkit packages.

## I5 ⏳ Platform-limit hint in input (A5)
Deferred — needs channel selection context inside the chat, larger change.
