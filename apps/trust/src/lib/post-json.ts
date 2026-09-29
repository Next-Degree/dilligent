export type PostResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function readMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'message' in body) {
      const { message } = body;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join(', ');
    }
  } catch {
    // fall through to the generic message
  }
  return 'Something went wrong. Please try again.';
}

/** Browser side call to the allowlisted Next.js proxy route. */
export async function callProxy(params: {
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
}): Promise<PostResult<unknown>> {
  const { path, method = 'POST', body } = params;
  try {
    const response = await fetch(`/api/trust/${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) return { ok: false, message: await readMessage(response) };
    const text = await response.text();
    const data: unknown = text ? JSON.parse(text) : null;
    return { ok: true, data };
  } catch {
    return { ok: false, message: 'Network error. Please try again.' };
  }
}
