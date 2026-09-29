import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestAccessForm, requestAccessSchema, toRequestBody } from './RequestAccessForm';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('toRequestBody', () => {
  it('drops blank optional fields', () => {
    const values = requestAccessSchema.parse({
      name: ' Ada ',
      email: 'ada@acme.com',
      company: '',
      jobTitle: undefined,
      purpose: 'Vendor review',
    });
    expect(toRequestBody(values)).toEqual({
      name: 'Ada',
      email: 'ada@acme.com',
      purpose: 'Vendor review',
    });
  });
});

describe('RequestAccessForm', () => {
  it('shows validation errors and does not call the API', async () => {
    render(<RequestAccessForm friendlyUrl="acme" />);
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));

    expect(await screen.findByText('Enter your name')).toBeTruthy();
    expect(screen.getByText('Enter a valid work email')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the proxy route and shows confirmation', async () => {
    fetchMock.mockResolvedValue(new Response('{"id":"req_1"}', { status: 201 }));
    render(<RequestAccessForm friendlyUrl="acme" />);

    fill('Full name', 'Ada Lovelace');
    fill('Work email', 'ada@acme.com');
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));

    expect(await screen.findByText(/Request received/)).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/trust/acme/requests');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'Ada Lovelace', email: 'ada@acme.com' });
  });

  it('surfaces the API error message', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"message":"Portal is not accepting requests"}', { status: 400 }),
    );
    render(<RequestAccessForm friendlyUrl="acme" />);

    fill('Full name', 'Ada Lovelace');
    fill('Work email', 'ada@acme.com');
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));

    await waitFor(() => expect(screen.getByText('Portal is not accepting requests')).toBeTruthy());
  });
});
