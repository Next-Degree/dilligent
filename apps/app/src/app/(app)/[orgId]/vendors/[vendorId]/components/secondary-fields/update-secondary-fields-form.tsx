'use client';

import { usePermissions } from '@/hooks/use-permissions';
import { useVendorActions } from '@/hooks/use-vendors';
import type { Member, User, Vendor } from '@db';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, HStack, Section, Stack } from '@trycompai/design-system';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { updateVendorSchema } from '../../actions/schema';
import {
  centsToDollars,
  dateToUtcDateOnly,
  dollarsToCents,
  utcDateOnlyToDate,
} from './contract-format';
import { VendorComplianceFields } from './vendor-compliance-fields';
import { VendorManagementFields } from './vendor-management-fields';

type VendorFormValues = z.infer<typeof updateVendorSchema>;

export function UpdateSecondaryFieldsForm({
  vendor,
  assignees,
  onUpdate,
}: {
  vendor: Vendor;
  assignees: (Member & { user: User })[];
  onUpdate?: () => void;
}) {
  const { updateVendor } = useVendorActions();
  const { hasPermission } = usePermissions();
  const canUpdate = hasPermission('vendor', 'update');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<VendorFormValues>({
    resolver: zodResolver(updateVendorSchema),
    defaultValues: {
      id: vendor.id,
      name: vendor.name,
      description: vendor.description,
      assigneeId: vendor.assigneeId,
      category: vendor.category,
      status: vendor.status,
      website: vendor.website ?? '',
      isSubProcessor: vendor.isSubProcessor,
      totalSeats: vendor.totalSeats,
      usedSeats: vendor.usedSeats,
      renewalDate: utcDateOnlyToDate(vendor.renewalDate),
      costDollars: centsToDollars(vendor.costCents),
      costModel: vendor.costModel,
      contractTerm: vendor.contractTerm,
      noticePeriodDays: vendor.noticePeriodDays,
      ownerId: vendor.ownerId,
    },
  });

  const handleSubmit = async (data: VendorFormValues) => {
    setIsSubmitting(true);
    try {
      await updateVendor(data.id, {
        name: data.name,
        description: data.description,
        assigneeId: data.assigneeId === '' ? null : data.assigneeId,
        category: data.category,
        status: data.status,
        website: data.website,
        isSubProcessor: data.isSubProcessor,
        totalSeats: data.totalSeats ?? null,
        usedSeats: data.usedSeats ?? null,
        renewalDate: dateToUtcDateOnly(data.renewalDate),
        costCents: dollarsToCents(data.costDollars),
        costModel: data.costModel ?? null,
        contractTerm: data.contractTerm ?? null,
        noticePeriodDays: data.noticePeriodDays ?? null,
        ownerId: data.ownerId === '' ? null : (data.ownerId ?? null),
      });
      toast.success('Vendor updated successfully');
      onUpdate?.();
    } catch {
      toast.error('Failed to update vendor');
    } finally {
      setIsSubmitting(false);
    }
  };

  const disabled = isSubmitting || !canUpdate;

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)}>
      <Stack gap="8">
        <Section
          title="Compliance"
          description="Who assesses this vendor, and where it sits in the risk register."
        >
          <VendorComplianceFields
            control={form.control}
            errors={form.formState.errors}
            assignees={assignees}
            disabled={disabled}
          />
        </Section>

        <Section
          title="Vendor Management"
          description="Who runs this system internally, and the commercial terms of its contract. All optional."
        >
          <VendorManagementFields
            control={form.control}
            errors={form.formState.errors}
            assignees={assignees}
            disabled={disabled}
          />
        </Section>

        {canUpdate && (
          <HStack justify="end">
            <Button type="submit" loading={isSubmitting}>
              Save
            </Button>
          </HStack>
        )}
      </Stack>
    </form>
  );
}
