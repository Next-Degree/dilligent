import { VendorStatus } from '@db';
import { z } from 'zod';
import {
  activeVendorCategoryEnum,
  dataFlowRoleEnum,
  dataServiceTypeEnum,
  vendorDeliveryModelEnum,
} from '../vendor-classification-enums';

// Only the "nothing picked" message is specific to this form; the vocabularies
// themselves are shared with the vendor action schemas.

export const createVendorSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  // Allow empty string in the input and treat it as "not provided"
  website: z
    .union([z.string().url('URL must be valid and start with https://'), z.literal('')])
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
  description: z.string().optional(),
  category: activeVendorCategoryEnum({ error: 'Select a category' }),
  // Required on create only: a new vendor with no delivery model is unusable for
  // ISMS scoping. Existing rows legitimately have an empty array, so the update
  // schema deliberately has no `.min(1)`. The arrays are plain (no `.default([])`)
  // so the schema's input and output types stay identical — react-hook-form
  // cannot infer a single `TFieldValues` when a default makes them diverge. The
  // form supplies `[]` through `defaultValues` instead.
  deliveryModels: z.array(vendorDeliveryModelEnum).min(1, 'Select at least one delivery model'),
  dataServiceTypes: z.array(dataServiceTypeEnum),
  dataFlowRoles: z.array(dataFlowRoleEnum),
  status: z.nativeEnum(VendorStatus),
  assigneeId: z.string().optional(),
});

export type CreateVendorFormValues = z.infer<typeof createVendorSchema>;
