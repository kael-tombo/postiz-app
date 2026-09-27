import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
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
export class IntegrationAnalyticsTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'integrationAnalyticsTool';

  run() {
    return createTool({
      id: 'integrationAnalyticsTool',
      mcp: {
        annotations: {
          title: 'Get Channel Analytics',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      description: `
Fetch analytics (daily metrics like impressions, likes, clicks, followers) for one connected channel over the last N days.
Get the channel id with the integrationList tool first.
Most platforms only serve up to 90 days of history - larger ranges are capped.
An empty analytics array means the platform does not expose analytics for this channel (for example article channels like WordPress or Dev.to) or simply has no data in the window - tell the user that instead of retrying.
`,
      inputSchema: z.object({
        integrationId: z
          .string()
          .describe('The id of the integration (channel) to fetch analytics for'),
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
        const organization = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        try {
          const analytics = await this._integrationService.checkAnalytics(
            organization,
            inputData.integrationId,
            String(inputData.days)
          );

          return { output: { analytics } };
        } catch (err: any) {
          return {
            output: {
              errors: err?.message || 'Failed to fetch the channel analytics',
            },
          };
        }
      },
    });
  }
}
