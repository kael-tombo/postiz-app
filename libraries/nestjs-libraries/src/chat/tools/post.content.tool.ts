import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { orgWriteRateLimit } from '@gitroom/nestjs-libraries/chat/tools/write.rate.limit';
import { confirmWithUser } from '@gitroom/nestjs-libraries/chat/tools/confirm.elicit';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  ValidUrlExtension,
  ValidUrlPath,
} from '@gitroom/helpers/utils/valid.url.path';

dayjs.extend(utc);

const validUrlExtension = new ValidUrlExtension();
const validUrlPath = new ValidUrlPath();

// Same URL validation as MediaDto - each attachment must point to an allowed
// upload domain and a supported file extension.
const attachmentUrl = z
  .string()
  .refine((url) => validUrlPath.validate(url, {} as any), {
    message: validUrlPath.defaultMessage({} as any),
  })
  .refine((url) => validUrlExtension.validate(url, {} as any), {
    message: validUrlExtension.defaultMessage({} as any),
  });

@Injectable()
export class PostContentTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postContentTool';

  run() {
    return createTool({
      id: 'postContentTool',
      mcp: {
        annotations: {
          title: 'Edit Post Content',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Edit the text and/or media of an existing post that was NOT published yet (scheduled or draft). The state and the publish date stay exactly as they are - only the content changes.
Find the post with the postsList tool first and pass its id.
"content" is one entry per message part: the first item is the post text, every additional item is a comment/thread reply (a single post takes a single-item array). The HTML format is the same as when scheduling: each line wrapped in <p>, possible tags h1, h2, h3, u, strong, li, ul, p.
"attachments" replaces the media of the main post (URLs from the mediaList tool or uploads); pass an empty array to remove all media.
Settings, tags, the publish date and the scheduled state are preserved. Show the user the new content and get their confirmation first.
The tool also asks the user to confirm through the MCP connection (elicitation) when the client supports it; a declined confirmation returns output.errors and nothing changes.
If validation fails, the result contains output.errors describing what to fix; the call can be retried with corrected parameters.
`,
      inputSchema: z.object({
        id: z.string().describe('The id of the post to edit'),
        content: z
          .array(
            z.string().describe('New text of the message part (HTML, <p>-wrapped lines)')
          )
          .optional()
          .describe(
            'New texts, one per message part (post first, then comments). Omit to keep the existing text.'
          ),
        attachments: z
          .array(attachmentUrl)
          .optional()
          .describe(
            'New media for the main post (URLs). Replaces the current media - pass [] to remove it. Omit to keep the existing media.'
          ),
      }),
      outputSchema: z.object({
        output: z
          .object({
            postId: z.string(),
            state: z.string(),
            publishDate: z.string().describe('UTC time'),
          })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        const rate = await orgWriteRateLimit(organizationId);
        if (rate.limited) {
          return { output: { errors: rate.message! } };
        }

        const confirm = await confirmWithUser(
          context,
          `Replace the content/media of post "${inputData.id}"?`
        );
        if (confirm.asked && !confirm.confirmed) {
          return {
            output: {
              errors: 'The user declined the content edit. No changes were made.',
            },
          };
        }

        try {
          // Org-scoped fetch: ordered as root post -> comments, root carries
          // integration + tags (same call updatePostSettings relies on).
          const ordered = await this._postsService.getPostsRecursively(
            inputData.id,
            true,
            organizationId,
            true
          );
          const root: any = ordered[0];
          if (!root) {
            return { output: { errors: 'Post not found' } };
          }
          if (root.parentPostId) {
            return {
              output: {
                errors:
                  'This id belongs to a comment, pass the id of the main post',
              },
            };
          }
          if (root.state !== 'QUEUE' && root.state !== 'DRAFT') {
            return {
              output: {
                errors:
                  'Only scheduled posts that were not published yet (or drafts) can be edited',
              },
            };
          }
          if (
            root.state === 'QUEUE' &&
            dayjs.utc(root.publishDate).isBefore(dayjs.utc())
          ) {
            return {
              output: {
                errors:
                  'The publish time of this post already passed, it cannot be edited',
              },
            };
          }

          if (inputData.content && inputData.content.length > ordered.length) {
            return {
              output: {
                errors: `This post has ${ordered.length} message part(s), but ${inputData.content.length} texts were passed`,
              },
            };
          }

          const contentPassed = !!inputData.content?.length;
          const attachmentsPassed = Array.isArray(inputData.attachments);

          // value[].id keeps every row updating in place instead of forking
          // (createOrUpdatePost upserts by value[].id).
          const value = ordered.map((row: any, i: number) => ({
            id: row.id,
            content: contentPassed
              ? inputData.content![Math.min(i, inputData.content!.length - 1)]
              : row.content,
            delay: row.delay || 0,
            image:
              i === 0 && attachmentsPassed
                ? inputData.attachments!.map((path: string) => ({
                    id: makeId(10),
                    path,
                  }))
                : JSON.parse(row.image || '[]'),
          }));

          const settings = JSON.parse(root.settings || '{}');
          await this._postsService.createPost(
            organizationId,
            {
              type: 'update',
              // type "update" keeps publishDate/state anyway; pass the current
              // one so the DTO is complete - as an absolute ISO instant, because
              // the repository parses it with local-time dayjs()
              date: new Date(root.publishDate).toISOString(),
              shortLink: false,
              inter: root.intervalInDays || undefined,
              tags: ((root.tags || []) as any[])
                .map((t) => ({
                  value: t?.tag?.value ?? t?.value,
                  label: t?.tag?.label ?? t?.label,
                }))
                .filter((f) => f.label),
              posts: [
                {
                  integration: { id: root.integration.id },
                  group: root.group,
                  settings,
                  value,
                },
              ],
            } as any,
            'MCP',
            // keep the existing group so clients holding it stay valid
            true
          );

          return {
            output: {
              postId: root.id,
              state: root.state,
              publishDate: dayjs.utc(root.publishDate).format('YYYY-MM-DDTHH:mm:ss'),
            },
          };
        } catch (err: any) {
          return {
            output: {
              errors: err?.message || 'Failed to update the post content',
            },
          };
        }
      },
    });
  }
}
