'use client';

import {
  useDiscoveredVendor,
  useDiscoveredVendorActions,
  type DiscoveredVendor,
} from '@/hooks/use-discovered-vendors';
import { useVendors } from '@/hooks/use-vendors';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Field,
  FieldError,
  FieldLabel,
  Input,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Stack,
  Textarea,
} from '@trycompai/design-system';
import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { GranteeList } from './GranteeList';
import {
  approveVendorSchema,
  type ApproveVendorFormValues,
} from './approve-vendor-schema';

interface ApproveVendorSheetProps {
  candidate: DiscoveredVendor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const normalizeForComparison = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function ApproveVendorSheet({
  candidate,
  open,
  onOpenChange,
}: ApproveVendorSheetProps) {
  const { approve, isSubmitting } = useDiscoveredVendorActions();
  // Detail carries the grantee list, which the queue rows do not.
  const { discoveredVendor: detail } = useDiscoveredVendor(open ? candidate?.id ?? null : null);
  const { data: vendorsResponse } = useVendors();

  const form = useForm<ApproveVendorFormValues>({
    resolver: zodResolver(approveVendorSchema),
    defaultValues: { name: '', website: '', description: '' },
  });

  const { control, handleSubmit, reset, watch } = form;

  // Prefill from whatever resolution found, while leaving every field editable — the
  // suggestion is a starting point, not a decision.
  useEffect(() => {
    if (!candidate) return;
    reset({
      name: candidate.resolvedName ?? candidate.displayName ?? '',
      website: candidate.resolvedWebsite ?? '',
      description: candidate.resolvedDescription ?? '',
    });
  }, [candidate, reset]);

  const enteredName = watch('name');

  /**
   * Warn when the register already holds something by this name.
   *
   * Resolution auto-links exact matches, so anything reaching here is a near-miss the
   * reviewer should look at rather than something the system should silently merge.
   */
  const duplicateVendor = useMemo(() => {
    const vendors = vendorsResponse?.data?.data;
    if (!Array.isArray(vendors) || !enteredName?.trim()) return null;

    const target = normalizeForComparison(enteredName);
    if (!target) return null;

    return (
      vendors.find(
        (vendor: { id: string; name: string }) =>
          normalizeForComparison(vendor.name) === target,
      ) ?? null
    );
  }, [vendorsResponse, enteredName]);

  const handleApprove = handleSubmit(async (values) => {
    if (!candidate) return;
    try {
      await approve(candidate.id, {
        name: values.name,
        website: values.website || undefined,
        description: values.description || undefined,
      });
      toast.success(`${values.name} added to your vendors`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not approve this application');
    }
  });

  const grantees = detail?.grants ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add as a vendor</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <form onSubmit={handleApprove}>
            <Stack gap="md">
              {duplicateVendor && (
                <Alert variant="warning">
                  <AlertTitle>You may already track this vendor</AlertTitle>
                  <AlertDescription>
                    &ldquo;{duplicateVendor.name}&rdquo; is already in your vendor list. Adding
                    this creates a second entry — consider ignoring this application instead.
                  </AlertDescription>
                </Alert>
              )}

              <Controller
                control={control}
                name="name"
                render={({ field, fieldState }) => (
                  <Field>
                    <FieldLabel htmlFor="approve-vendor-name">Name</FieldLabel>
                    <Input id="approve-vendor-name" {...field} />
                    {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
                  </Field>
                )}
              />

              <Controller
                control={control}
                name="website"
                render={({ field, fieldState }) => (
                  <Field>
                    <FieldLabel htmlFor="approve-vendor-website">Website</FieldLabel>
                    <Input
                      id="approve-vendor-website"
                      placeholder="https://example.com"
                      {...field}
                    />
                    {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
                  </Field>
                )}
              />

              <Controller
                control={control}
                name="description"
                render={({ field, fieldState }) => (
                  <Field>
                    <FieldLabel htmlFor="approve-vendor-description">Description</FieldLabel>
                    <Textarea
                      id="approve-vendor-description"
                      rows={3}
                      placeholder="Left blank, we record how and when this was discovered."
                      {...field}
                    />
                    {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
                  </Field>
                )}
              />

              <GranteeList grantees={grantees} />

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Adding…' : 'Add vendor'}
                </Button>
              </div>
            </Stack>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
