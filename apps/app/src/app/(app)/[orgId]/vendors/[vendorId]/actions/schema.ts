import { TaskStatus, VendorCategory, VendorContractTerm, VendorStatus } from '@db';
import { z } from 'zod';

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
  category: z.nativeEnum(VendorCategory),
  assigneeId: z.string().nullable(),
  contacts: z.array(vendorContactSchema).min(1, 'At least one contact is required'),
});

/**
 * Contract fields are all optional and nullable — the vendor Overview tab
 * clears an emptied input to `null` rather than leaving a stale value behind.
 * Bounds mirror `VendorContractFieldsDto` on the API so a value the form
 * accepts can never be rejected server-side.
 */
export const MAX_SEATS = 10_000_000;
export const MAX_ANNUAL_COST = 20_000_000; // dollars
export const MAX_NOTICE_PERIOD_DAYS = 3650; // 10 years

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
    category: z.nativeEnum(VendorCategory),
    status: z.nativeEnum(VendorStatus),
    assigneeId: z.string().nullable(),
    website: z
      .union([z.string().url('Must be a valid URL (include https://)'), z.literal('')])
      .optional(),
    isSubProcessor: z.boolean().optional(),

    totalSeats: optionalCount(MAX_SEATS, 'Total seats'),
    usedSeats: optionalCount(MAX_SEATS, 'Used seats'),
    renewalDate: z.date().nullable().optional(),
    // Dollars in the form, converted to cents before it reaches the API.
    annualCost: z
      .number()
      .min(0, 'Annual cost cannot be negative')
      .max(MAX_ANNUAL_COST, 'Annual cost is too large')
      .nullable()
      .optional(),
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
