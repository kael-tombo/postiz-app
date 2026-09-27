import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

const parseSettings = (settings: string | null) => {
  try {
    return JSON.parse(settings || '{}');
  } catch (err) {
    return {};
  }
};

// The image column is a JSON array of { id, path } (path is the media-library
// URL the scheduling tools accept back as an attachment).
// Platform publish errors can embed huge stack/JSON dumps - cap what agents see.
const MAX_ERROR_LENGTH = 300;
const parseAttachments = (image: string | null) => {
  try {
    return (JSON.parse(image || '[]') || [])
      .map((i: any) => i?.path)
      .filter((p: any): p is string => !!p);
  } catch (err) {
    return [];
  }
};

@Injectable()
export class PostsListTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postsListTool';

  run() {
    return createTool({
      id: 'postsListTool',
      mcp: {
        annotations: {
          title: 'List Posts',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
List the organization's posts scheduled to be published between two dates (the same data as the "List Posts" API endpoint).
Returns every post in the window whatever its state (scheduled, draft, published, errored) unless you pass "state" to filter.
"startDate" and "endDate" are required (UTC) - to list all upcoming posts, pass a wide window (for example from now to a year ahead).
Large windows can hold many posts: the result is paginated - walk it with "page" (PAGE_SIZE items per page) and stop when you have what you need ("hasMore" tells you if more pages exist).
Each item has an "id", its publish date, state, content, media attachments, channel, current provider settings and the full threadParts list (main post plus comments/thread replies).
A non-null "error" on an ERROR post explains why publishing failed. PUBLISHED posts carry "publishedUrl" - the live link on the platform.
"creationMethod" tells you how the post was made (MCP, DASHBOARD, API, AGENT...). "intervalInDays" marks recurring posts - they repeat every N days and appear as several items; edits to one repeat do not touch the others.
Posts cannot be deleted through the Postiz tools - if the user wants to delete a post, tell them to do it themselves in the Postiz app; never offer to delete a post.
To inspect ONE post by id (instead of paging through windows), use the postDetails tool.
`,
      inputSchema: z.object({
        startDate: z
          .string()
          .describe('Start of the window (UTC), for example 2026-07-20T00:00:00'),
        endDate: z
          .string()
          .describe('End of the window (UTC), for example 2026-08-20T00:00:00'),
        customer: z
          .string()
          .optional()
          .describe('Optional customer (group) id to filter the channels by'),
        state: z
          .enum(['all', 'scheduled', 'draft', 'published', 'error'])
          .default('all')
          .describe(
            'Optional state filter - use it instead of filtering client-side when the user asks only for scheduled, draft, published or errored posts'
          ),
        page: z
          .number()
          .min(1)
          .default(1)
          .describe(
            'Page number, starting at 1 - pass a larger page to see the next posts of a large window'
          ),
      }),
      outputSchema: z.object({
        output: z.object({
          posts: z.array(
            z.object({
              id: z
                .string()
                .describe('The post id'),
              publishDate: z.string().describe('UTC time'),
              state: z.string().describe('QUEUE, DRAFT, PUBLISHED or ERROR'),
              content: z.string(),
              settings: z
                .any()
                .describe('The post current provider settings'),
              attachments: z
                .array(z.string())
                .describe(
                  'Media file paths attached to the post - pass them back to the edit tool (postContentTool) to keep or change them'
                ),
              error: z
                .string()
                .nullable()
                .describe(
                  'Publishing error reported by the platform (ERROR state posts)'
                ),
              publishedUrl: z
                .string()
                .nullable()
                .describe(
                  'Live URL on the platform after the post was published (PUBLISHED posts only)'
                ),
              threadParts: z
                .array(
                  z.object({
                    content: z.string(),
                    attachments: z.array(z.string()),
                  })
                )
                .describe(
                  'All message parts in publishing order - first is the main post, the rest are comments or thread replies. The other fields describe the main post (first part).'
                ),
              group: z.string(),
              integrationId: z.string(),
              platform: z.string(),
              integrationName: z.string(),
              creationMethod: z
                .string()
                .describe(
                  'How the post was created - e.g. "MCP" (via these tools), "DASHBOARD", "API", "AGENT"'
                ),
              intervalInDays: z
                .number()
                .nullable()
                .describe(
                  'For recurring posts: they repeat every N days (each repeat is a separate list item). Null for one-off posts.'
                ),
            })
          ),
          page: z
            .number()
            .describe('The page number this result is (starts at 1)'),
          total: z
            .number()
            .describe('Total posts matching the window and state filter'),
          hasMore: z
            .boolean()
            .describe(
              'True when another page exists - call again with page+1 if needed'
            ),
        }),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        const all = await this._postsService.getPosts(organizationId, {
          startDate: inputData.startDate,
          endDate: inputData.endDate,
          customer: inputData.customer,
        } as any);

        // State filter ('error' is an MCP-only view: it maps to the ERROR state,
        // which the REST state filter does not expose)
        const stateFilter = inputData.state || 'all';
        const stateMap: Record<string, string[]> = {
          all: [],
          scheduled: ['QUEUE'],
          draft: ['DRAFT'],
          published: ['PUBLISHED'],
          error: ['ERROR'],
        };
        const wanted = stateMap[stateFilter];
        const filtered = wanted?.length
          ? (all || []).filter((p: any) => wanted.includes(p.state))
          : all || [];

        // Sort oldest first (REST calendar order) and paginate in the tool so
        // large windows cannot blow the agent's context window
        const PAGE_SIZE = 20;
        const sorted = [...filtered].sort(
          (a: any, b: any) =>
            new Date(a.publishDate).getTime() - new Date(b.publishDate).getTime()
        );
        const page = Math.max(1, inputData.page || 1);
        const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

        // Threaded posts are separate rows (comment = child post row); expand
        // them here so agents see the whole thread in one item.
        const expandThread = async (p: any) => {
          const parts = await this._postsService.getPostsRecursively(
            p.id,
            false,
            organizationId,
            true
          );
          return {
            id: p.id,
            publishDate: dayjs(p.publishDate)
              .utc()
              .format('YYYY-MM-DDTHH:mm:ss'),
            state: p.state,
            content: p.content || '',
            settings: parseSettings(p.settings),
            attachments: parseAttachments(p.image),
            error: p.error
              ? `${String(p.error).slice(0, MAX_ERROR_LENGTH)}${
                  String(p.error).length > MAX_ERROR_LENGTH ? '…' : ''
                }`
              : null,
            publishedUrl: p.releaseURL || null,
            threadParts: (parts || []).map((row: any) => ({
              content: row.content || '',
              attachments: parseAttachments(row.image),
            })),
            group: p.group,
            integrationId: p.integration?.id,
            platform: p.integration?.providerIdentifier,
            integrationName: p.integration?.name,
            creationMethod: p.creationMethod || 'UNKNOWN',
            intervalInDays: p.intervalInDays ?? null,
          };
        };

        return {
          output: {
            posts: await Promise.all(paged.map(expandThread)),
            page,
            total: sorted.length,
            hasMore: page * PAGE_SIZE < sorted.length,
          },
        };
      },
    });
  }
}
