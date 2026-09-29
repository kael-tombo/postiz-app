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
import { confirmWithUser, confirmBatchWithUser } from '@gitroom/nestjs-libraries/chat/tools/confirm.elicit';

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
                .describe(
                  'The "id" field of a channel from the integrationList tool output (not the internalId)'
                ),
              isPremium: z
                .boolean()
                .describe(
                  "Only relevant for X (Twitter): whether the account is premium (longer posts). Pass false when unsure."
                ),
              date: z
                .string()
                .describe(
                  'Publish time in UTC wall time, format YYYY-MM-DDTHH:mm:ss (for example 2026-01-31T14:30:00, no timezone suffix). Get a free slot from the freeDateTime tool when the user did not specify an exact time.'
                ),
              shortLink: z
                .boolean()
                .describe(
                  'If the post contains a link, true lets SocialFlow shorten it through the organization\'s short-link provider'
                ),
              type: z
                .enum(['draft', 'schedule', 'now'])
                .describe(
                  '"draft" saves the post without queuing it (date may be in the past, nothing publishes), "schedule" queues it for publishing at "date" (must be in the future), "now" publishes immediately (pass the current time as "date")'
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
                      .describe(
                        'Media urls for this part (images/videos already in the media library or uploaded) - pass [] for a text-only post'
                      ),
                  })
                )
                .describe(
                  'First item is the post text, every additional item is a comment/thread reply on it - a post without comments is a single-item array'
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
                  'Provider settings as key/value pairs from the integrationSchema tool settings section (for example WordPress needs title/type/status). Pass [] for drafts - drafts skip provider settings validation.'
                ),
            })
          )
          .describe(
            'One entry per channel+date combination: each object schedules one post on one channel at one time; repeat the same content with different dates (or channel ids) by adding more entries'
          ),
      }),
      outputSchema: z.object({
        output: z
          .array(
            z.object({
              postId: z.string(),
              integration: z.string(),
            })
          )
          .describe('The posts that were created')
          .or(
            z.object({
              errors: z.string(),
              created: z
                .array(
                  z.object({
                    postId: z.string(),
                    integration: z.string(),
                  })
                )
                .optional()
                .describe('Posts created before the failure, if any'),
              declined: z
                .array(z.number().int())
                .optional()
                .describe('0-based indices of socialPost entries the user unchecked in the confirmation dialog'),
            })
          ),
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
                errors: `The channel "${integration.name}" (${integration.providerIdentifier}) is disabled - it cannot receive posts until it is reconnected in the SocialFlow app.`,
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

        // Confirmation BEFORE any createPost runs: on the modern elicitation
        // era the tool re-executes from the top when the answer arrives, so
        // everything after this point must stay idempotent - "now" posts
        // created here would double-publish. Batches (2+) get ONE dialog
        // with a checkbox per post so the user can keep a subset; single
        // posts keep the simple accept/decline dialog.
        const count = inputData.socialPost.length;
        const hasNow = inputData.socialPost.some((p) => p.type === 'now');
        const earliest = inputData.socialPost
          .map((p) => p.date)
          .sort()[0];
        const batchDecision = await confirmBatchWithUser(
          context,
          inputData.socialPost.map((p) => ({
            date: p.date,
            type: p.type,
            preview: p.postsAndComments?.[0]?.content || '',
          })),
          { hasNow }
        );
        let allowed: boolean[];
        let confirm: { asked: boolean; confirmed: boolean } | { asked: false };
        if (batchDecision.asked) {
          allowed = batchDecision.allowed;
          confirm = {
            asked: true,
            confirmed: allowed.some(Boolean),
          };
        } else {
          const single = await confirmWithUser(
            context,
            hasNow
              ? `Publish ${count} post(s) immediately to the connected channels?`
              : `Create ${count} scheduled post(s), earliest at ${earliest} UTC?`
          );
          allowed = inputData.socialPost.map(() => true);
          confirm = single;
        }
        if (confirm.asked && !confirm.confirmed) {
          const declinedAll = allowed
            .map((ok, i) => (ok ? -1 : i))
            .filter((i) => i >= 0);
          return {
            output: {
              errors:
                'The user declined to create the posts. Nothing was scheduled.',
              declined: declinedAll.length === count ? undefined : declinedAll,
              created: [],
            },
          };
        }

        const declinedIndices: number[] = [];
        for (const [postIndex, post] of inputData.socialPost.entries()) {
          if (confirm.asked && !allowed[postIndex]) {
            // User unchecked this post in the batch dialog - skip it and
            // report the index back to the agent.
            declinedIndices.push(postIndex);
            continue;
          }
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

        if (declinedIndices.length > 0) {
          // Partial creation: report what was created AND which entries the
          // user unchecked, so the agent can retry just the declined ones.
          return {
            output: {
              errors: `The user unchecked ${declinedIndices.length} of ${count} posts; the other ${finalOutput.length} were created. Declined socialPost indices: [${declinedIndices.join(', ')}].`,
              created: finalOutput,
              declined: declinedIndices,
            },
          };
        }

        return {
          output: finalOutput,
        };
      },
    });
  }
}
