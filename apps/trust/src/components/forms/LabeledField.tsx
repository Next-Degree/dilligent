import { Field, FieldError, FieldLabel } from '@/components/ds';
import type { ReactNode } from 'react';

export function LabeledField(props: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  const { id, label, error, children } = props;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}
