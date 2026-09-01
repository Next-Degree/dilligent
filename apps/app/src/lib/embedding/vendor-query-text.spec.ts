import { describe, expect, it, vi } from 'vitest';

// `run-linkage` reaches for Postgres and Upstash at module load; neither is
// needed to exercise the pure query-text builder.
vi.mock('@db/server', () => ({
  db: {
    risk: { findMany: vi.fn(), update: vi.fn() },
    vendor: { findMany: vi.fn(), update: vi.fn() },
    task: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock('@upstash/vector', () => ({
  Index: vi.fn().mockImplementation(() => ({
    upsert: vi.fn(),
    query: vi.fn(),
    info: vi.fn(),
    delete: vi.fn(),
    range: vi.fn(),
  })),
}));

vi.mock('@ai-sdk/gateway', () => ({
  createGatewayProvider: () => ({ embedding: () => 'mock-embedding-model' }),
}));

import { computeEntityContentHash } from './index';
import { vendorQueryText } from './run-linkage';

const SLACK = {
  name: 'Slack',
  description: 'Team chat',
  category: 'collaboration_productivity',
  deliveryModels: ['saas'],
  dataServiceTypes: [],
  dataFlowRoles: [],
};

describe('vendorQueryText', () => {
  it('renders human labels for every recorded dimension', () => {
    const text = vendorQueryText({
      name: 'Clearbit',
      description: 'Company enrichment',
      category: 'data_enrichment',
      deliveryModels: ['api_service'],
      dataServiceTypes: ['company_data', 'enrichment'],
      dataFlowRoles: ['source', 'processor'],
    });

    expect(text).toBe(
      [
        'Clearbit',
        'Company enrichment',
        'Category: Data Enrichment',
        'Delivery model: API Service',
        'Data services: Company Data, Enrichment',
        'Data flow role: Source, Processor',
      ].join('\n'),
    );
    // Raw enum values are never embedded — they are poor retrieval signal and
    // they leak the storage representation into the vector.
    expect(text).not.toMatch(/data_enrichment|api_service|company_data/);
  });

  it('omits empty dimensions instead of emitting blank lines', () => {
    const text = vendorQueryText({
      name: 'Acme Legal',
      description: 'Outside counsel',
      category: 'legal',
      deliveryModels: [],
      dataServiceTypes: [],
      dataFlowRoles: [],
    });

    expect(text).toBe(['Acme Legal', 'Outside counsel', 'Category: Legal'].join('\n'));
    expect(text).not.toMatch(/\n\n/);
    expect(text).not.toMatch(/Delivery model|Data services|Data flow role/);
  });

  it('treats missing classification arrays the same as empty ones', () => {
    const withEmpty = vendorQueryText({
      name: 'Acme Legal',
      description: 'Outside counsel',
      category: 'legal',
      deliveryModels: [],
      dataServiceTypes: [],
      dataFlowRoles: [],
    });
    const withMissing = vendorQueryText({
      name: 'Acme Legal',
      description: 'Outside counsel',
      category: 'legal',
    });

    expect(withMissing).toBe(withEmpty);
  });
});

describe('vendor embedding hash', () => {
  // `embeddingHash` is the skip-if-unchanged guard: same hash means runLinkage
  // reuses the stored vector. Classification is now part of the embedded text,
  // so a reclassified vendor must re-embed rather than keep a vector that no
  // longer describes it.
  it('changes when deliveryModels change, forcing a re-embed', () => {
    const before = computeEntityContentHash({ text: vendorQueryText(SLACK) });
    const after = computeEntityContentHash({
      text: vendorQueryText({ ...SLACK, deliveryModels: ['saas', 'desktop_application'] }),
    });

    expect(after).not.toBe(before);
  });

  it('changes when the data flow role changes', () => {
    const before = computeEntityContentHash({ text: vendorQueryText(SLACK) });
    const after = computeEntityContentHash({
      text: vendorQueryText({ ...SLACK, dataFlowRoles: ['destination'] }),
    });

    expect(after).not.toBe(before);
  });

  it('is stable when nothing about the vendor changed', () => {
    expect(computeEntityContentHash({ text: vendorQueryText(SLACK) })).toBe(
      computeEntityContentHash({ text: vendorQueryText({ ...SLACK }) }),
    );
  });
});
