'use client';

import { Button } from '@/components/ds';
import { callProxy } from '@/lib/post-json';
import { downloadSchema } from '@/lib/schemas';
import { Download } from '@trycompai/design-system/icons';
import { useState } from 'react';

export function DownloadButton(props: {
  path: string;
  label: string;
  variant?: 'default' | 'outline';
}) {
  const { path, label, variant = 'outline' } = props;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    setError(null);
    const result = await callProxy({ path, method: 'GET' });
    setBusy(false);

    if (!result.ok) return setError(result.message);
    const parsed = downloadSchema.safeParse(result.data);
    if (!parsed.success || !parsed.data) return setError('Download unavailable.');
    window.location.assign(parsed.data);
  };

  return (
    <div className="space-y-1">
      <Button type="button" variant={variant} size="lg" disabled={busy} onClick={handleClick}>
        <Download />
        {busy ? 'Preparing…' : label}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
