import { describe, expect, it } from 'vitest';
import { type InboxApiResponse, toInboxData } from './inbox-data';

describe('toInboxData', () => {
  it('returns undefined when there is no response body', () => {
    expect(toInboxData(undefined)).toBeUndefined();
  });

  it('unwraps the list envelope', () => {
    const response: InboxApiResponse = {
      data: [],
      count: 0,
      totals: { 'task-failed': 0 },
      unavailable: ['connection-error'],
    };

    expect(toInboxData(response)).toEqual({
      items: [],
      totals: { 'task-failed': 0 },
      unavailable: ['connection-error'],
    });
  });

  it('tolerates a malformed body instead of crashing the page', () => {
    const malformed = JSON.parse('{"data":null,"count":0}') as InboxApiResponse;

    expect(toInboxData(malformed)).toEqual({ items: [], totals: {}, unavailable: [] });
  });
});
