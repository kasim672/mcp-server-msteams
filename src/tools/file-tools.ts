/**
 * File-related tool handlers: list files shared in a conversation, and
 * download a SharePoint file using the authenticated local Teams browser.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { RegisteredTool, ToolResult } from './index.js';
import { handleApiResult } from './index.js';
import { getSharedFiles } from '../api/files-api.js';
import { downloadFile } from '../api/browser-files-api.js';
import {
  DEFAULT_FILES_PAGE_SIZE,
  MAX_FILES_PAGE_SIZE,
} from '../constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const GetSharedFilesInputSchema = z.object({
  conversationId: z.string().min(1),
  pageSize: z.number().min(1).max(MAX_FILES_PAGE_SIZE).optional().default(DEFAULT_FILES_PAGE_SIZE),
  skipToken: z.string().optional(),
});

export const DownloadFileInputSchema = z.object({
  url: z.string().url(),
  outputPath: z.string().min(1),
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const getSharedFilesToolDefinition: Tool = {
  name: 'teams_get_shared_files',
  description: 'Get files and links shared in a Teams conversation. Returns file names, URLs, extensions, sizes, and who shared them. Works for channels, group chats, 1:1 chats, and meeting chats. Use the conversationId from other tools (teams_get_favorites, teams_search, teams_find_channel, teams_get_chat). Supports pagination via skipToken for conversations with many files. To save the contents of a File item locally, pass its webUrl to teams_download_file.',
  inputSchema: {
    type: 'object',
    properties: {
      conversationId: {
        type: 'string',
        description: 'The conversation ID to get shared files for (e.g., "19:abc@thread.tacv2" for a channel, or a chat conversation ID).',
      },
      pageSize: {
        type: 'number',
        description: `Number of items per page (default: ${DEFAULT_FILES_PAGE_SIZE}, max: ${MAX_FILES_PAGE_SIZE})`,
      },
      skipToken: {
        type: 'string',
        description: 'Continuation token from a previous response to get the next page of results.',
      },
    },
    required: ['conversationId'],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleGetSharedFiles(
  input: z.infer<typeof GetSharedFilesInputSchema>
): Promise<ToolResult> {
  const result = await getSharedFiles(input.conversationId, {
    pageSize: input.pageSize,
    skipToken: input.skipToken,
  });

  return handleApiResult(result, (value) => ({
    conversationId: value.conversationId,
    returned: value.returned,
    files: value.files,
    ...(value.skipToken ? { skipToken: value.skipToken, hasMore: true } : { hasMore: false }),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export const getSharedFilesTool: RegisteredTool<typeof GetSharedFilesInputSchema> = {
  definition: getSharedFilesToolDefinition,
  schema: GetSharedFilesInputSchema,
  handler: handleGetSharedFiles,
};

const downloadFileToolDefinition: Tool = {
  name: 'teams_download_file',
  description:
    "Download a file shared through Teams from a trusted HTTPS SharePoint webUrl, using the existing signed-in local browser. No Graph token or Azure app setup is involved. Accepts a SharePoint URL from teams_get_shared_files; Graph drive-item URLs returned for some education attachments cannot be downloaded by this browser-only tool. This operation saves to an absolute path on the local MCP machine, never overwrites an existing file, and returns name, size and SHA-256. Some SharePoint viewer layouts do not expose a usable download action to Playwright; in that case open the SharePoint link manually.",
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: "An HTTPS SharePoint webUrl from teams_get_shared_files (not a Graph API URL)." },
      outputPath: { type: 'string', description: 'Absolute destination file path on the MCP server machine. Must not already exist; the parent directory must exist.' },
    },
    required: ['url', 'outputPath'],
  },
};

async function handleDownloadFile(
  input: z.infer<typeof DownloadFileInputSchema>
): Promise<ToolResult> {
  const result = await downloadFile(input.url, input.outputPath);
  return handleApiResult(result, (value) => ({ ...value }));
}

export const downloadFileTool: RegisteredTool<typeof DownloadFileInputSchema> = {
  definition: downloadFileToolDefinition,
  schema: DownloadFileInputSchema,
  handler: handleDownloadFile,
};

/** All file-related tools. */
export const fileTools = [getSharedFilesTool, downloadFileTool];
