import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

// Mirrors postsListTool's per-item mapping (kept in sync with it):
// the image column is a JSON array of { id, path }, platform publish errors
// can embed huge dumps - cap what agents see.
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
export class PostDetailsTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postDetailsTool';

  run() {
    return createTool({
      id: 'postDetailsTool',
      mcp: {
        annotations: {
          title: 'Post Details',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Get one post by id: full content of every message part (main post and comments/thread replies), media attachments, publish date, state (QUEUE, DRAFT, PUBLISHED, ERROR), the live publishedUrl for published posts, the publishing error for failed ones, provider settings, tags and how it was created.
Use it when you already have a post id (from postsListTool, a previous tool result or the user) and need its current details - it does not need a date window. For browsing many posts use the postsList tool.
`,
      inputSchema: z.object({
        id: z.string().describe('The id of the post to fetch'),
      }),
      outputSchema: z.object({
        output: z
          .object({
            id: z.string(),
            group: z.string(),
            state: z.string().describe('QUEUE, DRAFT, PUBLISHED or ERROR'),
            publishDate: z.string().describe('UTC time'),
            creationMethod: z.string(),
            intervalInDays: z
              .number()
              .nullable()
              .describe('Recurring posts repeat every N days; null otherwise'),
            parts: z
              .array(
                z.object({
                  id: z.string().describe('The message part id'),
                  content: z.string(),
                  attachments: z.array(z.string()),
                  isComment: z
                    .boolean()
                    .describe(
                      'True when this part is a comment/thread reply of the main post'
                    ),
                })
              )
              .describe('Main post first, then comments/thread replies'),
            settings: z.any().describe('The post current provider settings'),
            tags: z.array(z.object({ label: z.string(), value: z.string() })),
            platform: z.string(),
            integrationId: z.string(),
            integrationName: z.string(),
            error: z
              .string()
              .nullable()
              .describe(
                'Publishing error reported by the platform (ERROR state posts)'
              ),
            publishedUrl: z
              .string()
              .nullable()
              .describe('Live URL on the platform (PUBLISHED posts only)'),
            releaseId: z
              .string()
              .nullable()
              .describe("The platform's id of the published post"),
          })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          // Org-scoped fetch, ordered root post -> comments (same call the
          // content edit tool relies on for its in-place update).
          const ordered = await this._postsService.getPostsRecursively(
            inputData.id,
            true,
            organizationId,
            true
          );
          const root: any = ordered[0];
          if (!root) {
            return {
              output: {
                errors:
                  'Post not found - ids are the postId returned by the postsList tool; call postsList (startDate/endDate/page) and retry with an id from its output.',
              },
            };
          }
          if (root.parentPostId) {
            return {
              output: {
                errors:
                  'This id belongs to a comment, pass the id of the main post',
              },
            };
          }

          return {
            output: {
              id: root.id,
              group: root.group,
              state: root.state,
              publishDate: dayjs.utc(root.publishDate).format('YYYY-MM-DDTHH:mm:ss'),
              creationMethod: root.creationMethod || 'UNKNOWN',
              intervalInDays: root.intervalInDays ?? null,
              parts: (ordered || []).map((row: any) => ({
                id: row.id,
                content: row.content || '',
                attachments: parseAttachments(row.image),
                isComment: !!row.parentPostId,
              })),
              settings: (() => {
                try {
                  return JSON.parse(root.settings || '{}');
                } catch {
                  return {};
                }
              })(),
              tags: ((root.tags || []) as any[])
                .map((t) => ({
                  label: t?.tag?.label ?? t?.label,
                  value: t?.tag?.value ?? t?.value,
                }))
                .filter((f) => f.label),
              platform: root.integration?.providerIdentifier,
              integrationId: root.integration?.id,
              integrationName: root.integration?.name,
              error: root.error
                ? `${String(root.error).slice(0, MAX_ERROR_LENGTH)}${
                    String(root.error).length > MAX_ERROR_LENGTH ? '…' : ''
                  }`
                : null,
              publishedUrl: root.releaseURL || null,
              releaseId: root.releaseId || null,
            },
          };
        } catch (err: any) {
          return {
            output: {
              errors: err?.message || 'Failed to fetch the post details',
            },
          };
        }
      },
    });
  }
}
