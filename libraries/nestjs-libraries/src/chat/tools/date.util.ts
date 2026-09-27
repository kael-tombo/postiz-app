import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

// The post repository parses dates with local-time dayjs(), so a Z-less string
// like "2026-09-27T06:40:00" would be read as LOCAL time and land hours off on
// non-UTC hosts. Every date crossing the MCP boundary is normalized here:
// Z-less input is interpreted as UTC wall time (what the tools promise), and
// strings that already carry an offset keep their instant.
export const toUtcIso = (date: string) => dayjs.utc(date).toISOString();
