import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class MediaListTool implements AgentToolInterface {
  constructor(private _mediaService: MediaService) {}
  name = 'mediaListTool';

  run() {
    return createTool({
      id: 'mediaListTool',
      mcp: {
        annotations: {
          title: 'List Media Library',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Browse or search the organization's media library (uploaded images and videos).
Pass the "path" of an item into the attachments of the schedulePostTool to use it in a post.
Use "search" to filter by file name, "page" to walk through the library (18 items per page).
`,
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe('Optional text to filter media by file name'),
        page: z
          .number()
          .min(1)
          .default(1)
          .describe('Page number, starting at 1 (18 items per page)'),
      }),
      outputSchema: z.object({
        output: z.object({
          pages: z.number().describe('Total number of pages'),
          media: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              originalName: z.string(),
              path: z
                .string()
                .describe('Use this path as an attachment URL when scheduling'),
              thumbnail: z.string().nullable(),
              alt: z.string().nullable(),
            })
          ),
        }),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        const media = await this._mediaService.getMedia(
          organizationId,
          inputData.page || 1,
          inputData.search
        );

        return {
          output: {
            pages: (media as any)?.pages || 0,
            media: ((media as any)?.results || []).map((m: any) => ({
              id: m.id,
              name: m.name,
              originalName: m.originalName,
              path: m.path,
              thumbnail: m.thumbnail,
              alt: m.alt ?? null,
            })),
          },
        };
      },
    });
  }
}
