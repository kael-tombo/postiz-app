import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { AllProvidersSettings } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/all.providers.settings';
import { Integration } from '@prisma/client';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { toUtcIso } from '@gitroom/nestjs-libraries/chat/tools/date.util';
import {
  ValidUrlExtension,
  ValidUrlPath,
} from '@gitroom/helpers/utils/valid.url.path';
import { orgWriteRateLimit } from '@gitroom/nestjs-libraries/chat/tools/write.rate.limit';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
import { confirmWithUser } from '@gitroom/nestjs-libraries/chat/tools/confirm.elicit';

const validUrlExtension = new ValidUrlExtension();
const validUrlPath = new ValidUrlPath();

// Same URL validation as MediaDto (valid.url.path) - each attachment must
// point to an allowed upload domain and a supported file extension.
const attachmentUrl = z
  .string()
  .refine((url) => validUrlPath.validate(url, {} as any), {
    message: validUrlPath.defaultMessage({} as any),
  })
  .refine((url) => validUrlExtension.validate(url, {} as any), {
    message: validUrlExtension.defaultMessage({} as any),
  });

@Injectable()
export class IntegrationSchedulePostTool implements AgentToolInterface {
  constructor(
    private _postsService: PostsService,
    private _integrationService: IntegrationService
  ) {}
  name = 'integrationSchedulePostTool';

  run() {
    return createTool({
      id: 'schedulePostTool',
      mcp: {
        annotations: {
          title: 'Schedule Social Media Post',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
Use this when the user wants to create a draft, scheduled, or immediate social media post on their connected channels, based on the integrationSchema tool.
Examples of the input shape:

A single LinkedIn post with one comment
- socialPost array length will be one
- postsAndComments array length will be two (one for the post, one for the comment)

20 Facebook posts each on individual days without comments
- socialPost array length will be 20
- postsAndComments array length will be one

Do not use this to update or delete existing posts.
If validation fails, the result contains output.errors describing what to fix; the call can be retried with corrected parameters.
The tool also asks the user to confirm the batch through the MCP connection (elicitation) when the client supports it; a declined confirmation returns output.errors and nothing is scheduled.
`,
      inputSchema: z.object({
        socialPost: z
          .array(
            z.object({
              integrationId: z
                .string()
                .describe('The id of the integration (not internal id)'),
              isPremium: z
                .boolean()
                .describe(
                  "If the integration is X, return if it's premium or not"
                ),
              date: z.string().describe('The date of the post in UTC time'),
              shortLink: z
                .boolean()
                .describe(
                  'If the post has a link inside, we can ask the user if they want to add a short link'
                ),
              type: z
                .enum(['draft', 'schedule', 'now'])
                .describe(
                  'The type of the post, if we pass now, we should pass the current date also'
                ),
              postsAndComments: z
                .array(
                  z.object({
                    content: z
                      .string()
                      .describe(
                        "The content of the post, HTML, Each line must be wrapped in <p> here is the possible tags: h1, h2, h3, u, strong, li, ul, p (you can't have u and strong together)"
                      ),
                    attachments: z
                      .array(attachmentUrl)
                      .describe('The image of the post (URLS)'),
                  })
                )
                .describe(
                  'first item is the post, every other item is the comments'
                ),
              settings: z
                .array(
                  z.object({
                    key: z
                      .string()
                      .describe('Name of the settings key to pass'),
                    value: z
                      .any()
                      .describe(
                        'Value of the key, always prefer the id then label if possible. When the settings schema says a field is an id, pass the id returned by the channel tools, never the display label'
                      ),
                  })
                )
                .describe(
                  'This relies on the integrationSchema tool to get the settings [input:settings]'
                ),
            })
          )
          .describe('Individual post'),
      }),
      outputSchema: z.object({
        output: z
          .array(
            z.object({
              postId: z.string(),
              integration: z.string(),
            })
          )
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

        // Pre-flights run BEFORE the confirmation dialog: refusals (bad date,
        // unknown/disabled channel, invalid settings) must never bother the
        // human with a confirm dialog for an action that is going to fail
        // anyway. This ordering also keeps the modern elicitation era honest:
        // the replay interrupt fires at the confirm step, so anything after
        // it would only be validated in round 2 - an unknown channel would
        // first pop a dialog, then error (parity bug found by the agentic-
        // loop suite, round 11).
        const finalOutput = [];

        // Date pre-flight: reject unparsable and (for schedule/now) already-
        // past dates BEFORE any post is created, with messages that tell the
        // agent how to recover (freeDateTimeTool / a future date).
        const now = Date.now();
        for (const platform of inputData.socialPost) {
          const parsed = dayjs.utc(platform.date);
          if (!platform.date || !parsed.isValid()) {
            return {
              output: {
                errors: `Invalid date "${platform.date}" - pass UTC wall time like 2026-01-31T14:30:00, or get a slot from the freeDateTime tool.`,
              },
            };
          }
          if (
            platform.type !== 'draft' &&
            parsed.valueOf() < now - 60 * 1000
          ) {
            return {
              output: {
                errors: `The date ${platform.date} is already in the past - pass a future UTC time (or type "draft" to save without a date), or get the next free slot from the freeDateTime tool.`,
              },
            };
          }
        }

        const integrations = {} as Record<string, Integration>;
        for (const platform of inputData.socialPost) {
          const integration =
            await this._integrationService.getIntegrationById(
              organizationId,
              platform.integrationId
            );
          if (!integration) {
            // Unknown channel: without this check the tool dies mid-write
            // with a raw error (or validates against nothing). Tell the
            // agent how to recover.
            return {
              output: {
                errors: `No channel found with id "${platform.integrationId}" in this organization - call the integrationList tool and use an id from its output.`,
              },
            };
          }
          if (integration.disabled) {
            return {
              output: {
                errors: `The channel "${integration.name}" (${integration.providerIdentifier}) is disabled - it cannot receive posts until it is reconnected in the Postiz app.`,
              },
            };
          }
          integrations[platform.integrationId] = integration;

          // Same server-side validation as the dashboard / public API
          // (settings DTO + media checkValidity + empty / too-long content).
          const settings = platform.settings.reduce(
            (acc: AllProvidersSettings, s: { key: string; value: any }) => ({
              ...acc,
              [s.key]: s.value,
            }),
            {} as AllProvidersSettings
          );

          const [validation] = await this._postsService.validatePosts(
            organizationId,
            [
              {
                integration: { id: platform.integrationId },
                settings,
                value: platform.postsAndComments.map((p: any) => ({
                  content: p.content,
                  image: (p.attachments || []).map((path: string) => ({
                    path,
                  })),
                })),
              },
            ]
          );

          if (validation.emptyContent) {
            return {
              output: {
                errors: `${validation.name}: Your post should have at least one character or one image.`,
              },
            };
          }

          if (platform.type !== 'draft') {
            if (!validation.valid) {
              return {
                output: {
                  errors: `${validation.name}: ${
                    validation.settingsError || 'Please fix your settings'
                  }, please fix it, and try integrationSchedulePostTool again.`,
                },
              };
            }

            if (validation.errors !== true) {
              return {
                output: {
                  errors: `${validation.name}: ${validation.errors}, please fix it, and try integrationSchedulePostTool again.`,
                },
              };
            }

            if (validation.tooLong) {
              return {
                output: {
                  errors: `${validation.name}: The maximum characters is ${validation.maximumCharacters}, please fix it, and try integrationSchedulePostTool again.`,
                },
              };
            }
          }
        }

        // One confirmation for the whole batch, BEFORE any createPost runs:
        // on the modern elicitation era the tool re-executes from the top when
        // the answer arrives, so everything after this point must stay
        // idempotent - "now" posts created here would double-publish.
        const count = inputData.socialPost.length;
        const hasNow = inputData.socialPost.some((p) => p.type === 'now');
        const earliest = inputData.socialPost
          .map((p) => p.date)
          .sort()[0];
        const confirm = await confirmWithUser(
          context,
          hasNow
            ? `Publish ${count} post(s) immediately to the connected channels?`
            : `Create ${count} scheduled post(s), earliest at ${earliest} UTC?`
        );
        if (confirm.asked && !confirm.confirmed) {
          return {
            output: {
              errors:
                'The user declined to create the posts. Nothing was scheduled.',
            },
          };
        }

        for (const post of inputData.socialPost) {
          const integration = integrations[post.integrationId];

          if (!integration) {
            throw new Error('Integration not found');
          }

          const output = await this._postsService.createPost(organizationId, {
            // Z-less input is UTC wall time per the tool contract; the
            // repository parses with local-time dayjs() - normalize first.
            date: toUtcIso(post.date),
            type: post.type as 'draft' | 'schedule' | 'now',
            shortLink: post.shortLink,
            tags: [],
            posts: [
              {
                integration,
                group: makeId(10),
                settings: post.settings.reduce(
                  (acc: AllProvidersSettings, s: { key: string; value: any }) => ({
                    ...acc,
                    [s.key]: s.value,
                  }),
                  {
                    __type: integration.providerIdentifier,
                  } as AllProvidersSettings
                ),
                value: post.postsAndComments.map((p: any) => ({
                  content: p.content,
                  id: makeId(10),
                  delay: 0,
                  image: p.attachments.map((p: any) => ({
                    id: makeId(10),
                    path: p,
                  })),
                })),
              },
            ],
          }, 'MCP');
          finalOutput.push(...output);
        }

        return {
          output: finalOutput,
        };
      },
    });
  }
}
