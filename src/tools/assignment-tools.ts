/**
 * EDU Assignments tool handlers.
 *
 * Surface the Teams "Assignments" feature: list the signed-in user's
 * assignments, read a single assignment's detail and attachments, act on
 * the user's own submission (turn in, undo turn-in, mark viewed), attach local files,
 * and remove attached files using browser automation.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { RegisteredTool, ToolResult } from './index.js';
import { handleApiResult } from './index.js';
import {
  listMyAssignments,
  ASSIGNMENT_ID_PATTERN,
  getAssignment,
  actOnSubmission,
} from '../api/assignments-api.js';
import {
  attachAssignmentFile,
  removeAssignmentAttachment,
} from '../browser/assignments.js';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const ListAssignmentsInputSchema = z.object({
  statusFilter: z.enum(['active', 'completed', 'all']).optional().default('active'),
  nextLink: z.string().url().optional(),
  top: z.number().int().min(1).max(MAX_PAGE_SIZE).optional().default(DEFAULT_PAGE_SIZE),
});

export const GetAssignmentInputSchema = z.object({
  classId: z.string().regex(ASSIGNMENT_ID_PATTERN),
  assignmentId: z.string().regex(ASSIGNMENT_ID_PATTERN),
});

export const SubmissionActionInputSchema = z.object({
  action: z.enum(['submit', 'unsubmit', 'view']),
  classId: z.string().regex(ASSIGNMENT_ID_PATTERN),
  assignmentId: z.string().regex(ASSIGNMENT_ID_PATTERN),
  submissionId: z.string().regex(ASSIGNMENT_ID_PATTERN),
});

export const AttachAssignmentFileInputSchema = z.object({
  filePath: z.string().describe('Absolute local file path on this machine to upload and attach.'),
  assignmentUrl: z.string().url().optional().describe('Direct Teams assignment deep link (webUrl). If omitted, classId and assignmentId must be provided.'),
  classId: z.string().regex(ASSIGNMENT_ID_PATTERN).optional().describe('Class ID (required if assignmentUrl is not provided).'),
  assignmentId: z.string().regex(ASSIGNMENT_ID_PATTERN).optional().describe('Assignment ID (required if assignmentUrl is not provided).'),
  submissionId: z.string().regex(ASSIGNMENT_ID_PATTERN).optional().describe('Submission ID (optional, used if turnIn is true).'),
  turnIn: z.boolean().optional().default(false).describe('Whether to turn in (submit) the assignment immediately after attaching the file.'),
});

export const RemoveAssignmentAttachmentInputSchema = z.object({
  assignmentUrl: z.string().url().optional().describe('Direct Teams assignment deep link (webUrl). If omitted, classId and assignmentId must be provided.'),
  classId: z.string().regex(ASSIGNMENT_ID_PATTERN).optional().describe('Class ID (required if assignmentUrl is not provided).'),
  assignmentId: z.string().regex(ASSIGNMENT_ID_PATTERN).optional().describe('Assignment ID (required if assignmentUrl is not provided).'),
  fileName: z.string().optional().describe('Specific file name to remove (e.g. "report.pdf"). If omitted, the first removable attachment is removed.'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const listAssignmentsToolDefinition: Tool = {
  name: 'teams_list_assignments',
  description:
    "List the signed-in user's Microsoft Teams assignments across all their classes (the Teams \"Assignments\" tab, for EDU tenants). Active work is ordered earliest due first. Results are paged: pass nextLink back until it is absent. The service applies the page size before the status filter, so any page (not only the last) may be short or empty while more follow; keep following nextLink, or use a larger top (e.g. 100) to need fewer calls. nextLink preserves the original query, status slice and page size, and the returned statusFilter always reflects the slice actually queried. If the service cannot page further, the call returns an API_ERROR rather than repeating results. Returns each assignment's title, class ID, due date, status, max points, instructions, a Teams deep link (webUrl), and the user's own submission summary including submission state and any grade/feedback. Use statusFilter to choose which slice: 'active' (assigned and not yet completed — the default), 'completed' (turned in or returned), or 'all'. To act on or read the full detail of one result, pass its classId + id to teams_get_assignment or its submission's id to teams_submission_action. Only available on education tenants that use Assignments; on other accounts it returns an ACCESS_DENIED or AUTH_INTERACTION_REQUIRED error. That does not affect any other Teams tool, and teams_login is not needed.",
  inputSchema: {
    type: 'object',
    properties: {
      statusFilter: {
        type: 'string',
        enum: ['active', 'completed', 'all'],
        description: "Which assignments to return: 'active' (default), 'completed', or 'all'.",
      },
      nextLink: { type: 'string', description: 'Continuation URL returned by the previous call. This URL determines the query, status slice and page size; statusFilter is ignored when it is given.' },
      top: {
        type: 'integer',
        description: 'Maximum number of assignments to return (default 25, max 100).',
      },
    },
    required: [],
  },
};

const getAssignmentToolDefinition: Tool = {
  name: 'teams_get_assignment',
  description:
    "Get the full detail of a single Teams assignment, including instructions, due/close dates, max points, a Teams deep link, teacher attachments (name, type, and a fileUrl for files or a url for forms and links), and the signed-in user's own submission (state, grade, feedback, and their own working and turned-in files, including personal copies of attachments marked copiedForEachStudent). Download any attachment with a fileUrl using teams_download_file. Requires the classId and assignmentId, both available from teams_list_assignments (fields classId and id). Only available on education tenants that use Assignments; on other accounts it returns an ACCESS_DENIED or AUTH_INTERACTION_REQUIRED error. That does not affect any other Teams tool, and teams_login is not needed.",
  inputSchema: {
    type: 'object',
    properties: {
      classId: {
        type: 'string',
        description: 'The class (group) ID the assignment belongs to (the classId field from teams_list_assignments).',
      },
      assignmentId: {
        type: 'string',
        description: 'The assignment ID (the id field from teams_list_assignments).',
      },
    },
    required: ['classId', 'assignmentId'],
  },
};

const submissionActionToolDefinition: Tool = {
  name: 'teams_submission_action',
  description:
    "Act on the signed-in user's OWN submission for a Teams assignment. action='submit' turns it in, action='unsubmit' undoes a turn-in, action='view' marks it as viewed. This changes state on the user's real Teams account, so confirm the user's intent before calling with 'submit' or 'unsubmit'. Requires classId, assignmentId and submissionId — get classId and assignmentId from teams_list_assignments (fields classId and id) and submissionId from the submission.id in that result or from teams_get_assignment. Only available on education tenants that use Assignments; on other accounts it returns an ACCESS_DENIED or AUTH_INTERACTION_REQUIRED error. That does not affect any other Teams tool, and teams_login is not needed.",
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['submit', 'unsubmit', 'view'],
        description: "The action: 'submit' (turn in), 'unsubmit' (undo turn-in), or 'view' (mark viewed).",
      },
      classId: {
        type: 'string',
        description: 'The class (group) ID (the classId field from teams_list_assignments).',
      },
      assignmentId: {
        type: 'string',
        description: 'The assignment ID (the id field from teams_list_assignments).',
      },
      submissionId: {
        type: 'string',
        description: "The submission ID (the submission.id field from teams_list_assignments or teams_get_assignment).",
      },
    },
    required: ['action', 'classId', 'assignmentId', 'submissionId'],
  },
};

const attachAssignmentFileToolDefinition: Tool = {
  name: 'teams_attach_file',
  description:
    "Attach a local file from this device to a Microsoft Teams assignment submission using browser automation with the user's persistent Teams session. Supports PDF, Office documents, zip, and any file allowed by Teams. Accepts either assignmentUrl (the webUrl from teams_list_assignments) or both classId and assignmentId. Can optionally turn in the assignment immediately after attaching.",
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Absolute local file path on the machine to attach.',
      },
      assignmentUrl: {
        type: 'string',
        description: 'The Teams assignment deep link (the webUrl field from teams_list_assignments).',
      },
      classId: {
        type: 'string',
        description: 'Class ID (required if assignmentUrl is not passed).',
      },
      assignmentId: {
        type: 'string',
        description: 'Assignment ID (required if assignmentUrl is not passed).',
      },
      submissionId: {
        type: 'string',
        description: 'Submission ID (optional, passed to API turn-in if turnIn is true).',
      },
      turnIn: {
        type: 'boolean',
        description: 'Whether to turn in (submit) the assignment after attaching the file (default false).',
      },
    },
    required: ['filePath'],
  },
};

const removeAssignmentAttachmentToolDefinition: Tool = {
  name: 'teams_remove_attachment',
  description:
    "Remove an attached file from an unsubmitted / working Microsoft Teams assignment submission using browser automation. Accepts either assignmentUrl or both classId and assignmentId. If fileName is given, removes that specific attachment; otherwise removes the first removable attachment.",
  inputSchema: {
    type: 'object',
    properties: {
      assignmentUrl: {
        type: 'string',
        description: 'The Teams assignment deep link (webUrl).',
      },
      classId: {
        type: 'string',
        description: 'Class ID (required if assignmentUrl is not passed).',
      },
      assignmentId: {
        type: 'string',
        description: 'Assignment ID (required if assignmentUrl is not passed).',
      },
      fileName: {
        type: 'string',
        description: 'Optional file name to remove (e.g. "BCG Matrix.pdf").',
      },
    },
    required: [],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleListAssignments(
  input: z.infer<typeof ListAssignmentsInputSchema>
): Promise<ToolResult> {
  const result = await listMyAssignments({
    statusFilter: input.statusFilter,
    top: input.top,
    nextLink: input.nextLink,
  });
  return handleApiResult(result, (value) => ({
    statusFilter: value.statusFilter,
    returned: value.returned,
    assignments: value.assignments,
    nextLink: value.nextLink,
  }));
}

async function handleGetAssignment(
  input: z.infer<typeof GetAssignmentInputSchema>
): Promise<ToolResult> {
  const result = await getAssignment(input.classId, input.assignmentId);
  return handleApiResult(result, (value) => ({ assignment: value }));
}

async function handleSubmissionAction(
  input: z.infer<typeof SubmissionActionInputSchema>
): Promise<ToolResult> {
  const result = await actOnSubmission(
    input.action,
    input.classId,
    input.assignmentId,
    input.submissionId,
  );
  return handleApiResult(result, (value) => ({
    action: value.action,
    submissionId: value.submissionId,
    status: value.status,
    succeeded: true,
  }));
}

async function handleAttachAssignmentFile(
  input: z.infer<typeof AttachAssignmentFileInputSchema>
): Promise<ToolResult> {
  const result = await attachAssignmentFile({
    filePath: input.filePath,
    assignmentUrl: input.assignmentUrl,
    classId: input.classId,
    assignmentId: input.assignmentId,
    submissionId: input.submissionId,
    turnIn: input.turnIn,
  });
  return handleApiResult(result, (value) => ({ ...value }));
}

async function handleRemoveAssignmentAttachment(
  input: z.infer<typeof RemoveAssignmentAttachmentInputSchema>
): Promise<ToolResult> {
  const result = await removeAssignmentAttachment({
    assignmentUrl: input.assignmentUrl,
    classId: input.classId,
    assignmentId: input.assignmentId,
    fileName: input.fileName,
  });
  return handleApiResult(result, (value) => ({ ...value }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export const listAssignmentsTool: RegisteredTool<typeof ListAssignmentsInputSchema> = {
  definition: listAssignmentsToolDefinition,
  schema: ListAssignmentsInputSchema,
  handler: handleListAssignments,
};

export const getAssignmentTool: RegisteredTool<typeof GetAssignmentInputSchema> = {
  definition: getAssignmentToolDefinition,
  schema: GetAssignmentInputSchema,
  handler: handleGetAssignment,
};

export const submissionActionTool: RegisteredTool<typeof SubmissionActionInputSchema> = {
  definition: submissionActionToolDefinition,
  schema: SubmissionActionInputSchema,
  handler: handleSubmissionAction,
};

export const attachAssignmentFileTool: RegisteredTool<typeof AttachAssignmentFileInputSchema> = {
  definition: attachAssignmentFileToolDefinition,
  schema: AttachAssignmentFileInputSchema,
  handler: handleAttachAssignmentFile,
};

export const removeAssignmentAttachmentTool: RegisteredTool<typeof RemoveAssignmentAttachmentInputSchema> = {
  definition: removeAssignmentAttachmentToolDefinition,
  schema: RemoveAssignmentAttachmentInputSchema,
  handler: handleRemoveAssignmentAttachment,
};

/** All assignment-related tools. */
export const assignmentTools = [
  listAssignmentsTool,
  getAssignmentTool,
  submissionActionTool,
  attachAssignmentFileTool,
  removeAssignmentAttachmentTool,
];
