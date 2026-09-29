import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { orgWriteRateLimit } from '@gitroom/nestjs-libraries/chat/tools/write.rate.limit';
import { confirmWithUser } from '@gitroom/nestjs-libraries/chat/tools/confirm.elicit';

@Injectable()
export class PostStatusTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postStatusTool';

  run() {
    return createTool({
      id: 'postStatusTool',
      mcp: {
        annotations: {
          title: 'Change Post Status',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Change the status of an existing post between draft and scheduled.
Use status "draft" to CANCEL a scheduled post: it is taken out of the queue, its pending publish run is terminated and it becomes an editable draft (posts cannot be deleted through the tools - cancelling to draft is the closest safe action).
Use status "schedule" to queue a draft (or a previously cancelled post) for publishing at its existing publish date.
Find the post with the postsList tool first and pass its id. Show the user which post is affected and get their confirmation first.
The tool also asks the user to confirm through the MCP connection (elicitation) when the client supports it; a declined confirmation returns output.errors and nothing changes.
If validation fails, the result contains output.errors describing what to fix; the call can be retried with corrected parameters.
`,
      inputSchema: z.object({
        id: z.string().describe('The id of the post to change the status of'),
        status: z
          .enum(['draft', 'schedule'])
          .describe(
            '"draft" cancels a scheduled post (safe cancel - deletion is not possible through the tools), "schedule" queues it again'
          ),
      }),
      outputSchema: z.object({
        output: z
          .object({
            postId: z.string(),
            state: z.string().describe('DRAFT or QUEUE'),
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

        // Pre-flight BEFORE the confirmation: refuse doomed calls with
        // actionable errors (the service throws a bare "Post not found" on
        // unknown ids and would otherwise accept a comment id).
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
                'Post not found - find the post with the postsList tool and pass its id',
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
        // Republish hazard: re-queueing a PUBLISHED (or ERROR) post would
        // publish the content again. Only the safe cancel to DRAFT may pass.
        if (
          inputData.status === 'schedule' &&
          root.state !== 'QUEUE' &&
          root.state !== 'DRAFT'
        ) {
          return {
            output: {
              errors:
                'This post is already published - re-queueing it would publish the content again. To publish new content, create a new post with the integrationSchedulePostTool.',
            },
          };
        }

        // Confirm the status change with the user over MCP elicitation
        // (modern-era hosts that declared the capability; no-op otherwise).
        const confirm = await confirmWithUser(
          context,
          inputData.status === 'draft'
            ? `Cancel the scheduled post "${inputData.id}" and turn it back into a draft?`
            : `Queue the post "${inputData.id}" for publishing at its existing date?`
        );
        if (confirm.asked && !confirm.confirmed) {
          return {
            output: {
              errors: confirm.guidance
                ? `The user declined the status change. No changes were made. ${confirm.guidance}`
                : 'The user declined the status change. No changes were made.',
            },
          };
        }

        try {
          const result = await this._postsService.changePostStatus(
            organizationId,
            inputData.id,
            inputData.status
          );

          return { output: { postId: result.id, state: result.state } };
        } catch (err: any) {
          return {
            output: {
              errors: err?.message || 'Failed to change the post status',
            },
          };
        }
      },
    });
  }
}
