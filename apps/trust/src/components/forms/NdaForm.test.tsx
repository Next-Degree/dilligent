import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NdaForm, ndaFormSchema } from './NdaForm';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ndaFormSchema', () => {
  it('requires the NDA to be accepted', () => {
    const result = ndaFormSchema.safeParse({
      name: 'Ada Lovelace',
      email: 'ada@acme.com',
      accept: false,
    });
    expect(result.success).toBe(false);
  });
});

describe('NdaForm', () => {
  it('blocks signing until the NDA is accepted', async () => {
    render(<NdaForm token="tok_1" defaultName="Ada Lovelace" defaultEmail="ada@acme.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign NDA' }));

    expect(await screen.findByText('You must accept the NDA to continue')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signs through the proxy route once accepted', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"portalUrl":"https://acme.com/access/abc"}', { status: 200 }),
    );
    render(<NdaForm token="tok_1" defaultName="Ada Lovelace" defaultEmail="ada@acme.com" />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign NDA' }));

    expect(await screen.findByText(/NDA signed/)).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/trust/nda/tok_1/sign');
    expect(JSON.parse(init.body)).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@acme.com',
      accept: true,
    });
  });
});
