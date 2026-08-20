'use client';

import { useApi } from '@/hooks/use-api';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  FieldError,
  FieldLabel,
  Grid,
  HStack,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
} from '@trycompai/design-system';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useSWRConfig } from 'swr';
import {
  SOURCE_NONE,
  SOURCE_OPTIONS,
  linkedAccountSchema,
  toSourceValue,
  type LinkedAccountValues,
} from './linkedAccountSchema';

/**
 * Links a member to the account they use on an external provider under a
 * different address — typically a personal GitHub account kept across work and
 * side projects. Employee Access checks match this email alongside the login
 * email, so that account resolves to this person instead of looking orphaned.
 */
export function EmployeeLinkedAccount({
  memberId,
  externalUserSource,
  externalUserId,
  canEdit,
}: {
  memberId: string;
  externalUserSource: string | null;
  externalUserId: string | null;
  canEdit: boolean;
}) {
  const api = useApi();
  const { mutate } = useSWRConfig();

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<LinkedAccountValues>({
    resolver: zodResolver(linkedAccountSchema),
    defaultValues: {
      externalUserSource: toSourceValue(externalUserSource),
      externalUserId: externalUserId ?? '',
    },
  });

  const handleSave = handleSubmit(async (values) => {
    const linked = values.externalUserSource !== SOURCE_NONE;
    // Both fields go on every request: the API rejects a half-set pair rather
    // than merging against the stored value, so the body states the full pair.
    const payload = {
      externalUserSource: linked ? values.externalUserSource : null,
      externalUserId: linked ? values.externalUserId.trim() : null,
    };

    const response = await api.patch(`/v1/people/${memberId}`, payload);
    if (response.error) {
      toast.error(response.error || 'Failed to save the linked account');
      return;
    }

    toast.success(linked ? 'Linked account saved' : 'Linked account removed');
    reset({
      externalUserSource: toSourceValue(payload.externalUserSource),
      externalUserId: payload.externalUserId ?? '',
    });
    // The access list matches on this email, so its results are now stale.
    void mutate(['member-access', memberId]);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Linked account</CardTitle>
      </CardHeader>
      <CardContent>
        {/* noValidate: the email field is validated against the same rules as
            the API, and native constraint validation would otherwise block
            submit before those messages could be shown. */}
        <form onSubmit={handleSave} noValidate>
          <Stack gap="md">
            <Text size="sm" variant="muted">
              If this person uses a different email on a connected provider, add it here so their
              access is recognized as theirs rather than reported as an unmatched account.
            </Text>

            <Grid cols={{ base: '1', md: '2' }} gap="4">
              <Controller
                name="externalUserSource"
                control={control}
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="externalUserSource">Provider</FieldLabel>
                    <Select
                      value={field.value}
                      disabled={!canEdit}
                      onValueChange={(value) => value && field.onChange(value)}
                    >
                      <SelectTrigger id="externalUserSource">
                        {/* SelectValue renders the raw value, so the label is
                            resolved here to show "GitHub", not "github". */}
                        <SelectValue>
                          {SOURCE_OPTIONS.find((o) => o.value === field.value)?.label ??
                            'Not linked'}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {SOURCE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.externalUserSource && (
                      <FieldError>{errors.externalUserSource.message}</FieldError>
                    )}
                  </Field>
                )}
              />

              <Field>
                <FieldLabel htmlFor="externalUserId">Email on that provider</FieldLabel>
                <Input
                  id="externalUserId"
                  type="email"
                  placeholder="jane@personal.example"
                  disabled={!canEdit}
                  aria-invalid={errors.externalUserId ? true : undefined}
                  {...register('externalUserId')}
                />
                {errors.externalUserId && <FieldError>{errors.externalUserId.message}</FieldError>}
              </Field>
            </Grid>

            <HStack justify="end">
              <Button
                type="submit"
                disabled={!canEdit || !isDirty || isSubmitting}
                loading={isSubmitting}
              >
                Save
              </Button>
            </HStack>
          </Stack>
        </form>
      </CardContent>
    </Card>
  );
}
