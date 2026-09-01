import { VendorStatus } from '@db';
import {
  DATA_FLOW_ROLES,
  DATA_SERVICE_TYPES,
  VENDOR_CATEGORIES,
  VENDOR_DELIVERY_MODELS,
} from '@trycompai/utils/vendors';
import { z } from 'zod';

/**
 * `Object.values(VendorCategory)` still yields the four retired values (they stay
 * in the Postgres enum for rolling-deploy safety), so validation is pinned to the
 * active vocabulary instead. Spread into a mutable tuple because `z.enum` wants a
 * writable array.
 */
const activeCategory = z.enum([...VENDOR_CATEGORIES]);
const deliveryModel = z.enum([...VENDOR_DELIVERY_MODELS]);
const dataServiceType = z.enum([...DATA_SERVICE_TYPES]);
const dataFlowRole = z.enum([...DATA_FLOW_ROLES]);

export const createVendorSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  // Allow empty string in the input and treat it as "not provided"
  website: z
    .union([z.string().url('URL must be valid and start with https://'), z.literal('')])
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
  description: z.string().optional(),
  category: activeCategory,
  // Required on create only: a new vendor with no delivery model is unusable for
  // ISMS scoping. Existing rows legitimately have an empty array, so the update
  // schema deliberately has no `.min(1)`.
  deliveryModels: z.array(deliveryModel).min(1, 'Select at least one delivery model').default([]),
  dataServiceTypes: z.array(dataServiceType).default([]),
  dataFlowRoles: z.array(dataFlowRole).default([]),
  status: z.nativeEnum(VendorStatus),
  assigneeId: z.string().optional(),
});

export type CreateVendorFormValues = z.infer<typeof createVendorSchema>;
