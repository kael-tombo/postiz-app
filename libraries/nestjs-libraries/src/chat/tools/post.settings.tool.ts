import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { orgWriteRateLimit } from '@gitroom/nestjs-libraries/chat/tools/write.rate.limit';
import { confirmWithUser } from '@gitroom/nestjs-libraries/chat/tools/confirm.elicit';

@Injectable()
export class PostSettingsTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postSettingsTool';

  run() {
    return createTool({
      id: 'postSettingsTool',
      mcp: {
        annotations: {
          title: 'Update Post Settings',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Update the provider settings of an existing post (scheduled or draft) that was NOT published yet.
Only the settings change - the content and the publish date stay exactly as they are.
Find the post first (list your posts) and pass its "id" here.
The settings are merged into the existing ones, so only pass the keys you want to change; anything you don't pass stays as it is.
This relies on the integrationSchema tool [input:settings] to know which keys exist for the platform.
If validation fails, the result contains output.errors describing what to fix; the call can be retried with corrected parameters.
The tool also asks the user to confirm through the MCP connection (elicitation) when the client supports it; a declined confirmation returns output.errors and nothing changes.
`,
      inputSchema: z.object({
        id: z
          .string()
          .describe('The "id" of the post to update its settings'),
        settings: z
          .array(
            z.object({
              key: z.string().describe('Name of the settings key to change'),
              value: z
                .any()
                .describe(
                  'New value of the key, always prefer the id then label if possible. When the settings schema says a field is an id, pass the id returned by the channel tools, never the display label'
                ),
            })
          )
          .describe(
            'Settings keys to change, merged into the existing settings. This relies on the integrationSchema tool [input:settings]'
          ),
      }),
      outputSchema: z.object({
        output: z
          .object({
            postId: z.string(),
            publishDate: z.string(),
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

        // Pre-flight BEFORE the confirmation dialog (same ordering as
        // postDate/postStatus/postContent): refuse doomed calls with
        // actionable errors instead of asking the user to confirm a settings
        // change that cannot succeed (unknown ids used to die inside the
        // service after the dialog).
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
                'Only scheduled posts that were not published yet (or drafts) can be updated',
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
                'The publish time of this post already passed, its settings cannot be changed',
            },
          };
        }

        const keys = (inputData.settings || []).map((s: { key: string }) => s.key).join(', ');
        const confirm = await confirmWithUser(
          context,
          `Update the settings (${keys}) of post "${inputData.id}"?`
        );
        if (confirm.asked && !confirm.confirmed) {
          return {
            output: {
              errors: 'The user declined the settings update. No changes were made.',
            },
          };
        }

        const settings = (inputData.settings || []).reduce(
          (acc: Record<string, any>, s: { key: string; value: any }) => ({
            ...acc,
            [s.key]: s.value,
          }),
          {} as Record<string, any>
        );

        try {
          const output = await this._postsService.updatePostSettings(
            organizationId,
            inputData.id,
            settings,
            'MCP'
          );

          return { output };
        } catch (err: any) {
          return {
            output: {
              errors: err?.message || 'Failed to update the post settings',
            },
          };
        }
      },
    });
  }
}
