# SocialFlow — UI/UX Assessment: Agent (AI Chat)

> **2026-10 redesign update:** the modern-minimal redesign (docs/redesign/plan.md, commit 4e98302f) re-pointed all theme tokens to the neutral zinc/slate system with hairline cards and soft shadows. Per-item resolution status lives in the companion `-improvements.md`.

**Scope:** `agents/agent.chat.tsx`, `agents/agent.input.tsx`, `agents/agent.tsx`, `agents/[id]/page.tsx`
**Verdict:** 6.5/10 — a functional CopilotKit chat with editor integration, but the chat surface has only two theme hooks wired, empty state is bare, and there is no visible conversation management (new/switch threads) inside the chat itself.

## Findings

| ID | Severity | Finding |
|----|----------|---------|
| A1 | High | CopilotKit CSS custom props set `--copilot-kit-primary-color` to `--new-btn-text` (white) — primary actions in the chat UI are theme-blind, not brand teal. |
| A2 | Medium | Empty chat shows only the input; no starter prompts / example tasks to teach what the agent can do. |
| A3 | Medium | Messages area has no max-width centering — long threads stretch full width and hurt readability. |
| A4 | Low | Typing/loading state relies on CopilotKit defaults; no brand-styled thinking indicator. |
| A5 | Low | Input lacks a visible character hint for platform limits when composing for a specific channel. |
