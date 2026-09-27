import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

// Same shape every provider returns (AnalyticsData): daily series per metric.
// "total" is a string in some providers and a number in others, so allow both.
const analyticsData = z.object({
  label: z.string().describe('Name of the metric (impressions, likes, clicks...)'),
  percentageChange: z.number().describe('Change compared to the previous period'),
  data: z
    .array(
      z.object({
        total: z.union([z.string(), z.number()]),
        date: z.string().describe('Day of the metric, YYYY-MM-DD'),
      })
    )
    .describe('Daily values of the metric'),
});

@Injectable()
export class PostAnalyticsTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postAnalyticsTool';

  run() {
    return createTool({
      id: 'postAnalyticsTool',
      mcp: {
        annotations: {
          title: 'Get Post Analytics',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      description: `
Fetch analytics (impressions, likes, clicks...) of one already PUBLISHED post on its platform.
Find the post with the postsList tool first and pass its id here - scheduled or draft posts have no analytics yet.
Most platforms only serve up to 90 days of history - larger ranges are capped.
An empty analytics array means the platform does not expose per-post analytics or the post has no data yet - tell the user that instead of retrying.
`,
      inputSchema: z.object({
        postId: z
          .string()
          .describe('The id of the published post to fetch analytics for'),
        days: z
          .number()
          .min(1)
          .max(90)
          .default(7)
          .describe(
            'How many days back from today to fetch (default 7, max 90 on most platforms)'
          ),
      }),
      outputSchema: z.object({
        output: z
          .object({
            analytics: z
              .array(analyticsData)
              .describe('One entry per metric, each with its daily series'),
          })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          const result = await this._postsService.checkPostAnalytics(
            organizationId,
            inputData.postId,
            inputData.days
          );

          if ((result as { missing?: boolean })?.missing) {
            return {
              output: {
                errors:
                  'The platform reports this post as missing - it may have been deleted on the platform.',
              },
            };
          }

          return { output: { analytics: result } };
        } catch (err: any) {
          return {
            output: {
              errors: err?.message || 'Failed to fetch the post analytics',
            },
          };
        }
      },
    });
  }
}
