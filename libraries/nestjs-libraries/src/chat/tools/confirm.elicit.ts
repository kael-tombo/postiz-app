/**
 * Elicitation-backed confirmation for the destructive MCP write tools.
 *
 * The helper is opt-in per tool call: it asks the human on the other end of the
 * MCP connection to confirm an action through `context.mcp.elicitation`
 * (Mastra's `sendRequest`). It is wired into the five mutating tools
 * (schedule post, edit content, reschedule, status/cancel, settings).
 *
 * When it actually asks:
 * - the request is served on the 2026-07-28 protocol revision. Detected via the
 *   reserved `_meta['io.modelcontextprotocol/protocolVersion']` envelope that
 *   every modern client attaches to each request; and
 * - the client declared the `elicitation` capability at initialize time (it
 *   also rides the per-request `_meta` envelope on this era).
 *   Mastra's `createReplayElicitation` turns an unanswered `sendRequest` into an
 *   `input_required` tool result (an embedded elicitation/create form) and the
 *   client retries the call with the answer attached — this works on the
 *   stateless HTTP mounts (`/mcp`, `/mcp/:id`, OAuth) where a legacy-era
 *   server->client request cannot be delivered (the SDK's JSON-response
 *   transport silently drops it and the call would hang).
 *
 * Everything else fails OPEN (no confirmation asked): legacy-era sessions
 * (2025-03-26 / 2025-06-18), hosts that did not declare elicitation, and any
 * elicitation runtime error. The per-tool descriptions already teach
 * "get the user's confirmation first", so this is defense in depth, not the
 * only line.
 *
 * `MCP_CONFIRM_MODE=off` disables the gate globally (host may already confirm).
 *
 * Hang safety valve: the gate only works while Mastra's replay elicitation is
 * actually wired into the tool context. If that ever stops being true (an SDK
 * upgrade changing internals, a mount dispatching modern requests without
 * replay support), `sendRequest` would block FOREVER and the agent would hang
 * on the write tool. The call is therefore raced against
 * `MCP_CONFIRM_TIMEOUT_MS` (default 30s); a timeout fails OPEN - the worst
 * case becomes an unconfirmed write (the tool descriptions still ask the
 * model to get consent), never a hung agent.
 */
import { Logger } from '@nestjs/common';

const MODE = (process.env.MCP_CONFIRM_MODE || 'on').toLowerCase();
const CONFIRM_DISABLED = MODE === 'off' || MODE === 'false';

const CONFIRM_TIMEOUT_MS = (() => {
  const n = Number(process.env.MCP_CONFIRM_TIMEOUT_MS || 30000);
  return Number.isFinite(n) && n > 0 ? n : 30000;
})();

const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';
const CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities';
const MODERN_ERA = '2026-07-28';

// ---------- F28 decline telemetry ----------
// Repeated declines of the SAME action are a signal, not noise: the agent
// is stuck in a confirm/decline loop and must change its question instead
// of retrying. Declines are counted per organization + normalized action
// message (quoted values stripped so different post ids count together);
// after DECLINE_THRESHOLD declines of the same action within the TTL, the
// tools append a guidance sentence to their decline error. Recording is
// best-effort and never affects the decision itself.
const DECLINE_TTL_MS = 10 * 60 * 1000;
const DECLINE_THRESHOLD = 3;
type DeclineEntry = { count: number; lastAt: number };
const declineRegistry = new Map<string, DeclineEntry>();

const declineSignature = (message: string): string =>
  message.replace(/"[^"]*"/g, '""').replace(/\s+/g, ' ').trim().toLowerCase();

const orgIdFromContext = (context: any): string => {
  try {
    return (
      JSON.parse((context?.requestContext as any)?.get('organization') as string)
        ?.id || 'unknown'
    );
  } catch {
    return 'unknown';
  }
};

const declineKey = (organizationId: string, message: string): string =>
  `${organizationId}::${declineSignature(message)}`;

const recordDecline = (organizationId: string, message: string): void => {
  try {
    const key = declineKey(organizationId, message);
    const now = Date.now();
    const entry = declineRegistry.get(key);
    if (!entry || now - entry.lastAt > DECLINE_TTL_MS) {
      declineRegistry.set(key, { count: 1, lastAt: now });
      return;
    }
    entry.count += 1;
    entry.lastAt = now;
  } catch {
    // telemetry must never break the confirmation flow
  }
};

/** Guidance for the agent when this same action was declined repeatedly. */
const declineGuidanceFor = (
  organizationId: string,
  message: string
): string | undefined => {
  try {
    const entry = declineRegistry.get(declineKey(organizationId, message));
    if (
      !entry ||
      entry.count < DECLINE_THRESHOLD ||
      Date.now() - entry.lastAt > DECLINE_TTL_MS
    ) {
      return undefined;
    }
    return (
      'The user has declined this same action several times recently - do not ' +
      'keep retrying it. Ask them what should change about the request instead.'
    );
  } catch {
    return undefined;
  }
};

// Mirrors @mastra/mcp's own isModernEraRequest(): the reserved per-request
// `_meta` envelope only exists on requests the modern codec parsed. This is
// exactly the condition under which Mastra wires the replay-based elicitation
// into the tool (input_required round-trip), so gating on it can never hang a
// legacy session: there, sendRequest would go out as a server->client request
// that the stateless JSON transports silently drop.

// The documented ElicitResult action is "accept" | "decline" | "cancel";
// the extra aliases tolerate loose hosts.
const ACCEPT_ACTIONS = new Set(['accept', 'confirm', 'yes']);
const DECLINE_ACTIONS = new Set(['decline', 'cancel', 'deny', 'no']);

export type ConfirmDecision =
  | { asked: false }
  | { asked: true; confirmed: true; guidance?: string }
  | { asked: true; confirmed: false; guidance?: string };

/** Per-post decisions from a batch confirmation form. */
export type BatchConfirmDecision =
  | { asked: false; allowed: boolean[] }
  | { asked: true; allowed: boolean[] };

/**
 * Above this size the per-post form becomes unusable for a human (26+
 * checkboxes), so the batch dialog falls back to the simple accept/decline
 * confirmWithUser dialog.
 */
const MAX_BATCH_ITEMS = 25;

/**
 * Summary line for one post in a batch confirmation form.
 * Kept terse: it is rendered inside a form the human clicks through.
 */
const batchItemLabel = (post: {
  date: string;
  type: string;
  preview: string;
}): string => {
  const text = post.preview.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return `${post.type} @ ${post.date} UTC - ${text.slice(0, 60)}${text.length > 60 ? '...' : ''}`;
};

/**
 * Per-post batch confirmation through MCP elicitation (modern era only).
 *
 * For 2+ posts the human gets ONE form with a checkbox per post: they can
 * accept a subset (keep 18 of 20, drop 2) instead of the old all-or-nothing
 * dialog. The result maps to `allowed[i]` for `posts[i]`; unchecked posts
 * are never created and the tool reports them as declined. Single posts keep
 * the simple boolean dialog via confirmWithUser; hosts without elicitation,
 * legacy-era sessions, MCP_CONFIRM_MODE=off and channel timeouts all fail
 * OPEN (allowed = all true) exactly like confirmWithUser.
 *
 * Replay contract: the answer arrives as { [mastra_elicit_0]: { action,
 * content: { posts: boolean[] } } }. Unknown/missing shapes decline ALL
 * (never write on a vague answer) - except the fail-open conditions above.
 */
export const confirmBatchWithUser = async (
  context: any,
  posts: { date: string; type: string; preview: string }[],
  options: { hasNow?: boolean } = {}
): Promise<BatchConfirmDecision> => {
  const allAllowed = posts.map(() => true);
  if (CONFIRM_DISABLED || posts.length < 2 || posts.length > MAX_BATCH_ITEMS) {
    // Single posts and oversized batches are handled by the caller's simple
    // confirmWithUser dialog instead.
    return { asked: false, allowed: allAllowed };
  }

  const message = options.hasNow
    ? `Publish ${posts.length} posts immediately? Uncheck any you do not want.`
    : `Schedule ${posts.length} posts? Uncheck any you do not want.`;

  try {
    const extra: any = context?.mcp?.extra;
    const envelope: any = extra?.mcpReq?.envelope;
    if (!envelope || typeof envelope !== 'object') {
      return { asked: false, allowed: allAllowed };
    }
    if (envelope[PROTOCOL_VERSION_META_KEY] !== MODERN_ERA) {
      return { asked: false, allowed: allAllowed };
    }
    const caps = envelope[CLIENT_CAPABILITIES_META_KEY];
    if (!caps || typeof caps !== 'object' || !caps.elicitation) {
      return { asked: false, allowed: allAllowed };
    }

    const postProperties: Record<string, any> = {};
    for (const [i, post] of posts.entries()) {
      postProperties[`post_${i}`] = {
        type: 'boolean',
        title: `Post ${i + 1} of ${posts.length}`,
        description: batchItemLabel(post),
        default: true,
      };
    }

    let timeoutTimer: any;
    const result: any = await Promise.race([
      context.mcp.elicitation.sendRequest({
        mode: 'form',
        message,
        requestedSchema: {
          type: 'object',
          properties: postProperties,
          required: Object.keys(postProperties),
        },
      }),
      // Same hang valve as confirmWithUser: an unwired replay channel must
      // degrade to fail-open, never hang the write tool.
      new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(
          () =>
            reject(
              Object.assign(new Error('batch elicitation timed out'), {
                name: 'ElicitationTimeout',
              })
            ),
          CONFIRM_TIMEOUT_MS
        );
      }),
    ]).finally(() => clearTimeout(timeoutTimer));

    const action = String(result?.action || '').toLowerCase();
    if (!ACCEPT_ACTIONS.has(action)) {
      // Decline / cancel / unknown shape -> nothing is created.
      recordDecline(orgIdFromContext(context), message);
      return { asked: true, allowed: posts.map(() => false) };
    }
    const answers: any[] = Array.isArray(result?.content?.posts)
      ? result.content.posts
      : [];
    return {
      asked: true,
      allowed: posts.map((_, i) => answers[i] !== false),
    };
  } catch (err: any) {
    if (err?.name === 'ElicitationReplayInterrupt') {
      throw err;
    }
    new Logger('McpConfirm').warn(
      `Batch confirmation elicitation failed (${err?.message || err}) - proceeding without confirmation`
    );
    return { asked: false, allowed: allAllowed };
  }
};

/**
 * Best-effort confirmation through MCP elicitation.
 * Never throws; returns whether the action may proceed.
 */
export const confirmWithUser = async (
  context: any,
  message: string
): Promise<ConfirmDecision> => {
  if (CONFIRM_DISABLED) {
    return { asked: false };
  }

  try {
    const extra: any = context?.mcp?.extra;
    // Legacy-era request (no per-request envelope) -> gate stays closed: the
    // answer could not be routed back through these transports anyway.
    // NOTE: the reserved envelope keys are lifted OUT of params._meta by the
    // 2026 codec before handlers run - they only exist on mcpReq.envelope.
    const envelope: any = extra?.mcpReq?.envelope;
    if (!envelope || typeof envelope !== 'object') {
      return { asked: false };
    }
    if (envelope[PROTOCOL_VERSION_META_KEY] !== MODERN_ERA) {
      return { asked: false };
    }
    const caps = envelope[CLIENT_CAPABILITIES_META_KEY];
    if (!caps || typeof caps !== 'object' || !caps.elicitation) {
      return { asked: false };
    }

    let timeoutTimer: any;
    const result: any = await Promise.race([
      context.mcp.elicitation.sendRequest({
        mode: 'form',
        message,
        requestedSchema: {
          type: 'object',
          properties: {
            confirm: {
              type: 'boolean',
              title: 'Confirm',
              description: 'Confirm to run the action, or decline.',
            },
          },
          required: ['confirm'],
        },
      }),
      // Never trust the channel to answer: a permanently-pending sendRequest
      // (unwired replay elicitation) must degrade to fail-open, not hang the
      // agent's write tool for the rest of the session.
      new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(
          () =>
            reject(
              Object.assign(new Error('elicitation confirmation timed out'), {
                name: 'ElicitationTimeout',
              })
            ),
          CONFIRM_TIMEOUT_MS
        );
      }),
    ]).finally(() => clearTimeout(timeoutTimer));

    const action = String(result?.action || '').toLowerCase();
    if (ACCEPT_ACTIONS.has(action)) {
      const confirmed = result?.content?.confirm !== false;
      return { asked: true, confirmed };
    }
    if (DECLINE_ACTIONS.has(action)) {
      const organizationId = orgIdFromContext(context);
      recordDecline(organizationId, message);
      return {
        asked: true,
        confirmed: false,
        guidance: declineGuidanceFor(organizationId, message),
      };
    }
    // Unknown shape -> treat as a decline (do not write on a vague answer).
    {
      const organizationId = orgIdFromContext(context);
      recordDecline(organizationId, message);
      return {
        asked: true,
        confirmed: false,
        guidance: declineGuidanceFor(organizationId, message),
      };
    }
  } catch (err: any) {
    // Mastra's modern-era replay elicitation signals "show the form" by
    // throwing this internal error out of sendRequest; the tools/call handler
    // converts it into the input_required result. It MUST propagate - swallowing
    // it would run the write on the first round without any confirmation.
    if (err?.name === 'ElicitationReplayInterrupt') {
      throw err;
    }
    // No elicitation support, transport replay quirks, host disconnects...
    // Never block a write because the confirmation channel failed.
    new Logger('McpConfirm').warn(
      `Confirmation elicitation failed (${err?.message || err}) - proceeding without confirmation`
    );
    return { asked: false };
  }
};
