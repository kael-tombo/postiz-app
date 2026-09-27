import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class FreeDateTimeTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'freeDateTimeTool';

  run() {
    return createTool({
      id: 'freeDateTimeTool',
      mcp: {
        annotations: {
          title: 'Find Free Posting Slot',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Find the next free posting slot for the organization (or for one channel), based on the configured posting times and the posts already scheduled.
Use it when the user does not specify an exact date and time: fetch a slot here and pass it as the "date" of the schedulePostTool call.
Pass an integrationId to get the best slot for that specific channel.
`,
      inputSchema: z.object({
        integrationId: z
          .string()
          .optional()
          .describe(
            'Optional channel id to find the slot for; omit it for the organization-wide best slot'
          ),
      }),
      outputSchema: z.object({
        output: z
          .object({
            date: z
              .string()
              .describe(
                'The next free slot in UTC (YYYY-MM-DDTHH:mm:ss, no offset) - pass it straight to the scheduling tool date'
              ),
          })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          const date = await this._postsService.findFreeDateTime(
            organizationId,
            inputData.integrationId
          );

          return { output: { date } };
        } catch (err: any) {
          return {
            output: {
              errors: err?.message || 'Failed to find a free slot',
            },
          };
        }
      },
    });
  }
}
