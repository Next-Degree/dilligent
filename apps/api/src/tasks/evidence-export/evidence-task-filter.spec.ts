// hasExportableEvidence is pure; stub the module's I/O dependencies.
jest.mock('@db', () => ({ db: {} }));
jest.mock('./evidence-data-loader', () => ({}));
jest.mock('./evidence-json-builder', () => ({}));
jest.mock('./evidence-pdf-generator', () => ({}));
jest.mock('./evidence-attachment-streamer', () => ({}));
jest.mock('./evidence-comments', () => ({}));
jest.mock('./evidence-browser-automations', () => ({}));

import {
  hasExportableEvidence,
  type TaskEvidence,
} from './evidence-task-archive';

const at = new Date('2026-01-01T00:00:00Z');

function evidence(overrides: Partial<TaskEvidence> = {}): TaskEvidence {
  return {
    headers: {
      taskId: 'tsk_1',
      taskTitle: 'Task',
      organizationId: 'org_1',
      organizationName: 'Acme',
      automations: [],
      exportedAt: at,
    },
    attachments: [],
    comments: [],
    browserAutomations: [],
    ...overrides,
  };
}

describe('hasExportableEvidence', () => {
  it('is false for an empty task', () => {
    expect(hasExportableEvidence(evidence())).toBe(false);
  });

  it('is false when comments have text but no files', () => {
    expect(
      hasExportableEvidence(
        evidence({
          comments: [
            {
              id: 'c',
              content: 'hi',
              createdAt: at,
              authorName: 'A',
              attachments: [],
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('is true when a comment has a file', () => {
    expect(
      hasExportableEvidence(
        evidence({
          comments: [
            {
              id: 'c',
              content: 'see file',
              createdAt: at,
              authorName: 'A',
              attachments: [
                {
                  id: 'a',
                  name: 'f.pdf',
                  url: 'k',
                  type: 'document',
                  createdAt: at,
                },
              ],
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('is true when the task has browser automation runs', () => {
    expect(
      hasExportableEvidence(
        evidence({
          browserAutomations: [
            {
              id: 'b',
              name: 'Status',
              targetUrl: 'https://x',
              instruction: 'i',
              evaluationCriteria: null,
              runCount: 1,
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('is true for task attachments', () => {
    expect(
      hasExportableEvidence(
        evidence({
          attachments: [
            {
              id: 'a',
              name: 'f.pdf',
              url: 'k',
              type: 'document',
              createdAt: at,
            },
          ],
        }),
      ),
    ).toBe(true);
  });
});
