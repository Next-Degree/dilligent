'use client';

import { Alert, AlertDescription, Button, Input, Textarea } from '@/components/ds';
import { callProxy } from '@/lib/post-json';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { LabeledField } from './LabeledField';

export const requestAccessSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name'),
  email: z.string().trim().email('Enter a valid work email'),
  company: z.string().trim().optional(),
  jobTitle: z.string().trim().optional(),
  purpose: z.string().trim().optional(),
});

export type RequestAccessValues = z.infer<typeof requestAccessSchema>;

/** Drops blank optional fields so the API's IsOptional validators pass. */
export function toRequestBody(values: RequestAccessValues) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== ''),
  );
}

export function RequestAccessForm({ friendlyUrl }: { friendlyUrl: string }) {
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RequestAccessValues>({ resolver: zodResolver(requestAccessSchema) });

  const handleValidSubmit = async (values: RequestAccessValues) => {
    setServerError(null);
    const result = await callProxy({
      path: `${encodeURIComponent(friendlyUrl)}/requests`,
      body: toRequestBody(values),
    });
    if (!result.ok) return setServerError(result.message);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <Alert variant="success">
        <AlertDescription>
          Request received. You will get an email with next steps once it has been reviewed.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit(handleValidSubmit)} noValidate className="max-w-xl space-y-4">
      <LabeledField id="name" label="Full name" error={errors.name?.message}>
        <Input id="name" autoComplete="name" {...register('name')} />
      </LabeledField>
      <LabeledField id="email" label="Work email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" {...register('email')} />
      </LabeledField>
      <LabeledField id="company" label="Company (optional)">
        <Input id="company" autoComplete="organization" {...register('company')} />
      </LabeledField>
      <LabeledField id="jobTitle" label="Job title (optional)">
        <Input id="jobTitle" autoComplete="organization-title" {...register('jobTitle')} />
      </LabeledField>
      <LabeledField id="purpose" label="Why do you need access? (optional)">
        <Textarea id="purpose" size="full" {...register('purpose')} />
      </LabeledField>
      {serverError ? (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" size="xl" disabled={isSubmitting}>
        {isSubmitting ? 'Sending…' : 'Request access'}
      </Button>
    </form>
  );
}
