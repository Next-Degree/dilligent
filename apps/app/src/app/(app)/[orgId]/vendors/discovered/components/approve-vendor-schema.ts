import { z } from 'zod';

export const approveVendorSchema = z.object({
  name: z.string().trim().min(1, 'A vendor name is required'),
  website: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || /^https?:\/\//i.test(value),
      'Include the full address, starting with http:// or https://',
    ),
  description: z.string().trim(),
});

export type ApproveVendorFormValues = z.infer<typeof approveVendorSchema>;
