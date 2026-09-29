import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { toUtcIso } from '@gitroom/nestjs-libraries/chat/tools/date.util';
import { orgWriteRateLimit } from '@gitroom/nestjs-libraries/chat/tools/write.rate.limit';
import { confirmWithUser } from '@gitroom/nestjs-libraries/chat/tools/confirm.elicit';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

@Injectable()
export class PostDateTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postDateTool';

  run() {
    return createTool({
      id: 'postDateTool',
      mcp: {
        annotations: {
          title: 'Reschedule Post',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Move a post to a different publish date (UTC). Find the post with the postsList tool first and pass its id.
The default action "update" ONLY changes the date and never touches the state - it is the safe choice.
The action "schedule" also (re)queues the post: it clears the release id, terminates the current publishing workflow and starts a new one at the new date.
Never use "schedule" on an already PUBLISHED post unless the user explicitly asked to republish it - it would publish the content again.
Show the user which post moves to which date and get their confirmation first.
The tool also asks the user to confirm through the MCP connection (elicitation) when the client supports it; a declined confirmation returns output.errors and nothing changes.
If validation fails, the result contains output.errors describing what to fix; the call can be retried with corrected parameters.
`,
      inputSchema: z.object({
        id: z.string().describe('The id of the post to reschedule'),
        date: z.string().describe('The new publish date in UTC time'),
        action: z
          .enum(['update', 'schedule'])
          .default('update')
          .describe(
            '"update" only changes the date (safe default). "schedule" also re-queues the post and restarts its publishing workflow - needed after a cancel, dangerous on published posts (republishes).'
          ),
      }),
      outputSchema: z.object({
        output: z
          .object({
            postId: z.string(),
            publishDate: z.string().describe('UTC time'),
            state: z.string().describe('The post state after the change'),
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

        // Pre-flight BEFORE the confirmation dialog: refuse doomed calls with
        // actionable errors instead of eliciting a confirmation and then
        // dying in the service (unknown id used to surface as a raw
        // "Cannot read properties of null" TypeError).
        const parsed = dayjs.utc(inputData.date);
        if (!inputData.date || !parsed.isValid()) {
          return {
            output: {
              errors: `Invalid date "${inputData.date}" - pass UTC wall time like 2026-01-31T14:30:00, or get a slot from the freeDateTime tool.`,
            },
          };
        }

        // Org-scoped fetch (same pattern as the content edit tool).
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
        if (root.state !== 'QUEUE' && root.state !== 'DRAFT') {
          return {
            output: {
              errors:
                'Only scheduled posts that were not published yet (or drafts) can be rescheduled',
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
                'The publish time of this post already passed, it cannot be rescheduled',
            },
          };
        }

        // Rescheduling is routine, but "schedule" re-queues the post: on an
        // already published post that republishes the content - confirm.
        // The routine "update" action is not worth a confirmation dialog.
        const confirm = await confirmWithUser(
          context,
          inputData.action === 'schedule'
            ? `Re-queue post "${inputData.id}" for publishing at ${inputData.date} UTC? On an already published post this publishes the content again.`
            : `Move post "${inputData.id}" to ${inputData.date} UTC?`
        );
        if (confirm.asked && !confirm.confirmed) {
          return {
            output: {
              errors: confirm.guidance
                ? `The user declined the date change. No changes were made. ${confirm.guidance}`
                : 'The user declined the date change. No changes were made.',
            },
          };
        }

        try {
          const updated = await this._postsService.changeDate(
            organizationId,
            inputData.id,
            // Z-less input is UTC wall time per the tool contract; the
            // repository parses with local-time dayjs() - normalize first.
            toUtcIso(inputData.date),
            inputData.action
          );

          return {
            output: {
              postId: inputData.id,
              publishDate: dayjs(updated.publishDate)
                .utc()
                .format('YYYY-MM-DDTHH:mm:ss'),
              state: updated.state,
            },
          };
        } catch (err: any) {
          return {
            output: {
              errors: err?.message || 'Failed to change the post date',
            },
          };
        }
      },
    });
  }
}
