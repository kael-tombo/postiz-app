// Regression test for the findFreeDateTime infinite-recursion bug.
//
// Bug: with zero posting times (org without connected channels),
// findFreeDateTimeRecursive re-cursed day-by-day forever, hanging
// GET /posts/find-slot and the public API /find-slot endpoint.
//
// Run: node .freebuff/regression-find-free-date-time.mjs
import { pathToFileURL } from 'node:url';

const serviceUrl = pathToFileURL(
  'apps/backend/dist/libraries/nestjs-libraries/src/database/prisma/posts/posts.service.js'
).href;

const { PostsService } = await import(serviceUrl);

// Case 1: zero channels -> integration service returns no posting times.
// The day-by-day recursion must be skipped entirely (guard) and a default returned.
const DAY_MS = 86400000;
let repositoryCalls = 0;
const integrationServiceEmpty = {
  findFreeDateTime: async () => [],
};
const postRepository = {
  getPostsCountsByDates: async () => {
    repositoryCalls++;
    return [];
  },
};

// Only the first three constructor deps are used by the method under test.
const service = new PostsService(
  postRepository, null, integrationServiceEmpty, null, null, null, null, null
);

const started = Date.now();
const result1 = await service.findFreeDateTime('org-1');
const elapsed1 = Date.now() - started;
if (elapsed1 > 2000 || repositoryCalls > 0) {
  console.error(`FAIL empty-times: ${elapsed1}ms, ${repositoryCalls} repo calls (guard not hit / recursion not terminated)`);
  process.exit(1);
}
if (typeof result1 !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(result1)) {
  console.error(`FAIL empty-times: unexpected result ${JSON.stringify(result1)}`);
  process.exit(1);
}
console.log(`PASS empty posting times -> ${result1} (${elapsed1}ms, no repo calls needed)`);

// Case 2: slots exist but day 0 is full -> advance to day 1 and return that slot.
// getPostsCountsByDates returns free "minutes-of-day" offsets; we simulate
// day 0 having nothing free and day 1 having a free slot at minute 600 (10:00 UTC).
let call = 0;
const integrationServiceWithTimes = {
  findFreeDateTime: async () => [540, 600],  // channels post at 09:00 and 10:00
};
const postRepository2 = {
  getPostsCountsByDates: async (_orgId, times, date) => {
    call++;
    if (call === 1) return [];           // day 0: nothing free -> recurse
    return [600];                         // day 1: free slot at 10:00
  },
};
const service2 = new PostsService(postRepository2, null, integrationServiceWithTimes, null, null, null, null, null);
const result2 = await service2.findFreeDateTime('org-1');
const expectedPrefix = new Date(Date.now() + DAY_MS).toISOString().slice(0, 10);
if (!result2.startsWith(expectedPrefix) || !result2.includes('T10:00:00')) {
  console.error(`FAIL slot-day-advance: expected ${expectedPrefix}T10:00:00, got ${result2}`);
  process.exit(1);
}
console.log(`PASS occupied day advances to next day -> ${result2}`);

console.log('\nAll regression checks passed.');
