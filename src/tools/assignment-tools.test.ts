import { describe, expect, it } from 'vitest';
import {
  ListAssignmentsInputSchema,
  GetAssignmentInputSchema,
  SubmissionActionInputSchema,
  AttachAssignmentFileInputSchema,
  RemoveAssignmentAttachmentInputSchema,
} from './index.js';

describe('Assignments tool input validation', () => {
  it('rejects fractional page sizes while accepting integer bounds', () => {
    expect(ListAssignmentsInputSchema.safeParse({ top: 2.5 }).success).toBe(false);
    expect(ListAssignmentsInputSchema.safeParse({ top: 1 }).success).toBe(true);
    expect(ListAssignmentsInputSchema.safeParse({ top: 100 }).success).toBe(true);
  });

  it.each(['..', '../assignment', 'id?x=y', 'id#hash', '%2f'])('rejects path manipulation: %s', (id) => {
    expect(GetAssignmentInputSchema.safeParse({ classId: id, assignmentId: 'a1' }).success).toBe(false);
    expect(
      SubmissionActionInputSchema.safeParse({
        action: 'submit',
        classId: 'c1',
        assignmentId: 'a1',
        submissionId: id,
      }).success
    ).toBe(false);
  });

  it('validates attach file input', () => {
    expect(AttachAssignmentFileInputSchema.safeParse({ filePath: 'C:/test.pdf' }).success).toBe(true);
    expect(AttachAssignmentFileInputSchema.safeParse({}).success).toBe(false);
  });

  it.each([
    'https://example.org/assignments',
    'http://teams.microsoft.com/l/assignment',
    'https://teams.microsoft.com.evil.example/assignment',
    'https://user:pass@teams.microsoft.com/assignment',
    'file:///etc/passwd',
  ])('rejects untrusted assignment link: %s', (assignmentUrl) => {
    expect(AttachAssignmentFileInputSchema.safeParse({ filePath: 'C:/test.pdf', assignmentUrl }).success).toBe(false);
    expect(RemoveAssignmentAttachmentInputSchema.safeParse({ assignmentUrl }).success).toBe(false);
  });

  it.each([
    'https://teams.microsoft.com/l/assignment',
    'https://teams.cloud.microsoft/l/assignment',
    'https://assignments.edu.cloud.microsoft/assignment',
  ])('accepts Teams assignment link: %s', (assignmentUrl) => {
    expect(AttachAssignmentFileInputSchema.safeParse({ filePath: 'C:/test.pdf', assignmentUrl }).success).toBe(true);
    expect(RemoveAssignmentAttachmentInputSchema.safeParse({ assignmentUrl }).success).toBe(true);
  });

  it('validates remove attachment input', () => {
    expect(
      RemoveAssignmentAttachmentInputSchema.safeParse({
        assignmentUrl: 'https://teams.microsoft.com/test',
      }).success
    ).toBe(true);
    expect(RemoveAssignmentAttachmentInputSchema.safeParse({ fileName: 'file.pdf' }).success).toBe(true);
  });
});
