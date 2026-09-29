'use client';

import { Alert, AlertDescription, Button, Input } from '@/components/ds';
import { callProxy } from '@/lib/post-json';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { LabeledField } from './LabeledField';

const reclaimSchema = z.object({
  email: z.string().trim().email('Enter the email you requested access with'),
});

type ReclaimValues = z.infer<typeof reclaimSchema>;

export function ReclaimForm({ friendlyUrl }: { friendlyUrl: string }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ReclaimValues>({ resolver: zodResolver(reclaimSchema) });

  const handleValidSubmit = async (values: ReclaimValues) => {
    setMessage(null);
    const result = await callProxy({
      path: `${encodeURIComponent(friendlyUrl)}/reclaim`,
      body: values,
    });
    setMessage(
      result.ok
        ? { ok: true, text: 'If that email has active access, a fresh link is on its way.' }
        : { ok: false, text: result.message },
    );
  };

  return (
    <form onSubmit={handleSubmit(handleValidSubmit)} noValidate className="max-w-xl space-y-4">
      <LabeledField id="reclaim-email" label="Email" error={errors.email?.message}>
        <Input id="reclaim-email" type="email" autoComplete="email" {...register('email')} />
      </LabeledField>
      {message ? (
        <Alert variant={message.ok ? 'success' : 'destructive'}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" variant="outline" size="xl" disabled={isSubmitting}>
        {isSubmitting ? 'Sending…' : 'Email me a new link'}
      </Button>
    </form>
  );
}
