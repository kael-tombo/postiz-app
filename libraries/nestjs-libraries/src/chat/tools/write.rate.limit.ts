import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// Per-organization fixed-window limit for the MCP write tools (schedule, edit
// content/settings, reschedule, status). The public API has route throttling;
// raw MCP automation did not, so one runaway agent loop could flood the queue
// and every downstream provider API. One tool call counts once, even when it
// batches many posts - legitimate bulk workflows stay a single call.
// Tune with MCP_WRITE_LIMIT (calls/window; 0 disables) and
// MCP_WRITE_WINDOW_SECONDS (default 60).
const LIMIT = Math.max(
  0,
  parseInt(process.env.MCP_WRITE_LIMIT || '', 10) || 30
);
const WINDOW_SECONDS = Math.max(
  1,
  parseInt(process.env.MCP_WRITE_WINDOW_SECONDS || '', 10) || 60
);
const DISABLED = LIMIT === 0;

export const orgWriteRateLimit = async (
  organizationId: string
): Promise<{ limited: boolean; message?: string }> => {
  const bucket = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  const key = `mcp:write-limit:${organizationId}:${bucket}`;
  try {
    if (DISABLED) {
      return { limited: false };
    }
    const count = await ioRedis.incr(key);
    if (count === 1) {
      // keep the key around a bit longer than the window so clock edges settle
      await ioRedis.expire(key, WINDOW_SECONDS * 2);
    }
    if (count > LIMIT) {
      return {
        limited: true,
        message: `Rate limit reached: at most ${LIMIT} post changes per ${WINDOW_SECONDS} seconds per organization. Wait a moment and try again.`,
      };
    }
    return { limited: false };
  } catch (err) {
    // Never block writes because the limiter itself failed (e.g. mock redis
    // in tests without REDIS_URL)
    return { limited: false };
  }
};
