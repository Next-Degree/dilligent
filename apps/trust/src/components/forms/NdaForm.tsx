'use client';

import { Alert, AlertDescription, Button, Checkbox, Input, Label } from '@/components/ds';
import { callProxy } from '@/lib/post-json';
import { ndaActionSchema } from '@/lib/schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { LabeledField } from './LabeledField';

export const ndaFormSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name'),
  email: z.string().trim().email('Enter a valid email'),
  accept: z.boolean().refine((value) => value, 'You must accept the NDA to continue'),
});

type NdaValues = z.infer<typeof ndaFormSchema>;

export function NdaForm(props: { token: string; defaultName: string; defaultEmail: string }) {
  const { token, defaultName, defaultEmail } = props;
  const base = `nda/${encodeURIComponent(token)}`;
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<NdaValues>({
    resolver: zodResolver(ndaFormSchema),
    defaultValues: { name: defaultName, email: defaultEmail, accept: false },
  });

  const handlePreview = async () => {
    setPreviewing(true);
    setError(null);
    const result = await callProxy({ path: `${base}/preview-nda` });
    setPreviewing(false);
    if (!result.ok) return setError(result.message);
    const parsed = ndaActionSchema.safeParse(result.data);
    if (parsed.success && parsed.data.pdfDownloadUrl) {
      window.open(parsed.data.pdfDownloadUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleValidSubmit = async (values: NdaValues) => {
    setError(null);
    const result = await callProxy({ path: `${base}/sign`, body: values });
    if (!result.ok) return setError(result.message);
    const parsed = ndaActionSchema.safeParse(result.data);
    setSignedUrl(parsed.success ? (parsed.data.portalUrl ?? '') : '');
  };

  if (signedUrl !== null) {
    return (
      <Alert variant="success">
        <AlertDescription>
          NDA signed. We emailed you a link to the documents.{' '}
          {signedUrl ? (
            <a href={signedUrl} className="underline underline-offset-4">
              Open documents
            </a>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit(handleValidSubmit)} noValidate className="max-w-xl space-y-4">
      <LabeledField id="nda-name" label="Full name" error={errors.name?.message}>
        <Input id="nda-name" autoComplete="name" {...register('name')} />
      </LabeledField>
      <LabeledField id="nda-email" label="Email" error={errors.email?.message}>
        <Input id="nda-email" type="email" autoComplete="email" {...register('email')} />
      </LabeledField>
      <div className="flex items-start gap-3">
        <Controller
          control={control}
          name="accept"
          render={({ field }) => (
            <Checkbox
              id="nda-accept"
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
          )}
        />
        <Label htmlFor="nda-accept">I have read and agree to the NDA</Label>
      </div>
      {errors.accept ? (
        <p role="alert" className="text-sm text-destructive">
          {errors.accept.message}
        </p>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          size="xl"
          disabled={previewing}
          onClick={handlePreview}
        >
          {previewing ? 'Preparing…' : 'Preview NDA'}
        </Button>
        <Button type="submit" size="xl" disabled={isSubmitting}>
          {isSubmitting ? 'Signing…' : 'Sign NDA'}
        </Button>
      </div>
    </form>
  );
}
