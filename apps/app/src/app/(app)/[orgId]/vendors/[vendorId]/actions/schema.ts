import { TaskStatus, VendorContractTerm, VendorCostModel, VendorStatus } from '@db';
import {
  DATA_FLOW_ROLES,
  DATA_SERVICE_TYPES,
  VENDOR_CATEGORIES,
  VENDOR_DELIVERY_MODELS,
} from '@trycompai/utils/vendors';
import { z } from 'zod';

/**
 * The Prisma `VendorCategory` enum still carries four retired values so a rolling
 * deploy cannot fail on them. They are readable but never writable, so validation
 * uses the active vocabulary from `@trycompai/utils/vendors` rather than
 * `Object.values(VendorCategory)`.
 */
const activeCategory = z.enum([...VENDOR_CATEGORIES]);
const deliveryModel = z.enum([...VENDOR_DELIVERY_MODELS]);
const dataServiceType = z.enum([...DATA_SERVICE_TYPES]);
const dataFlowRole = z.enum([...DATA_FLOW_ROLES]);

export const createVendorTaskCommentSchema = z.object({
  vendorId: z.string().min(1, {
    message: 'Vendor ID is required',
  }),
  vendorTaskId: z.string().min(1, {
    message: 'Task ID is required',
  }),
  content: z.string().min(1, {
    message: 'Task content is required',
  }),
});

export const createVendorTaskSchema = z.object({
  vendorId: z.string().min(1, {
    message: 'Vendor ID is required',
  }),
  title: z.string().min(1, {
    message: 'Title is required',
  }),
  description: z.string().min(1, {
    message: 'Description is required',
  }),
  dueDate: z.date({ error: 'Due date is required' }),
  assigneeId: z.string().nullable(),
});

export const vendorContactSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  role: z.string().min(1, 'Role is required'),
});

export const createVendorSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  website: z.string().url('Must be a valid URL'),
  description: z.string().min(1, 'Description is required'),
  category: activeCategory,
  // A brand-new vendor must say how we consume it — that, not the category, is
  // what ISMS scoping reads.
  deliveryModels: z.array(deliveryModel).min(1, 'Select at least one delivery model').default([]),
  dataServiceTypes: z.array(dataServiceType).default([]),
  dataFlowRoles: z.array(dataFlowRole).default([]),
  assigneeId: z.string().nullable(),
  contacts: z.array(vendorContactSchema).min(1, 'At least one contact is required'),
});

export const MAX_SEATS = 10_000_000;
export const MAX_COST_DOLLARS = 20_000_000;
export const MAX_NOTICE_PERIOD_DAYS = 3650;

const optionalCount = (max: number, label: string) =>
  z
    .number()
    .int(`${label} must be a whole number`)
    .min(0, `${label} cannot be negative`)
    .max(max, `${label} is too large`)
    .nullable()
    .optional();

export const updateVendorSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
    category: activeCategory,
    // No `.min(1)` here: rows that predate the classification split legitimately
    // carry empty arrays, and an edit of an unrelated field must not be blocked
    // by history.
    deliveryModels: z.array(deliveryModel).default([]),
    dataServiceTypes: z.array(dataServiceType).default([]),
    dataFlowRoles: z.array(dataFlowRole).default([]),
    status: z.nativeEnum(VendorStatus),
    assigneeId: z.string().nullable(),
    website: z
      .union([z.string().url('Must be a valid URL (include https://)'), z.literal('')])
      .optional(),
    isSubProcessor: z.boolean().optional(),

    totalSeats: optionalCount(MAX_SEATS, 'Total seats'),
    usedSeats: optionalCount(MAX_SEATS, 'Used seats'),
    renewalDate: z.date().nullable().optional(),
    costDollars: z
      .number()
      .min(0, 'Cost cannot be negative')
      .max(MAX_COST_DOLLARS, 'Cost is too large')
      .nullable()
      .optional(),
    costModel: z.nativeEnum(VendorCostModel).nullable().optional(),
    contractTerm: z.nativeEnum(VendorContractTerm).nullable().optional(),
    noticePeriodDays: optionalCount(MAX_NOTICE_PERIOD_DAYS, 'Notice period'),
    ownerId: z.string().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      typeof value.totalSeats === 'number' &&
      typeof value.usedSeats === 'number' &&
      value.usedSeats > value.totalSeats
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['usedSeats'],
        message: 'Used seats cannot exceed total seats',
      });
    }

    if (typeof value.costDollars === 'number' && !value.contractTerm) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contractTerm'],
        message: 'Choose a contract term so the cost has a period',
      });
    }
  });

export const createVendorCommentSchema = z.object({
  vendorId: z.string(),
  content: z.string().min(1),
});

export const updateVendorRiskSchema = z.object({
  id: z.string(),
  inherent_risk: z.enum(['low', 'medium', 'high', 'unknown']).optional(),
  residual_risk: z.enum(['low', 'medium', 'high', 'unknown']).optional(),
});

export const updateVendorTaskSchema = z.object({
  id: z.string().min(1, {
    message: 'Task ID is required',
  }),
  vendorId: z.string().min(1, {
    message: 'Vendor ID is required',
  }),
  title: z.string().min(1, {
    message: 'Title is required',
  }),
  description: z.string().min(1, {
    message: 'Description is required',
  }),
  dueDate: z.date().optional(),
  status: z.nativeEnum(TaskStatus, { error: 'Task status is required' }),
  assigneeId: z.string().nullable(),
});
