import { z } from 'zod';

const DRIVE_HOSTS = ['drive.google.com', 'docs.google.com'];

/**
 * Mirrors the API's @IsUrl on UpdatePeopleDto.driveFolderUrl: https only, and
 * only Google Drive hosts. An empty value is valid and clears the link.
 */
export const driveFolderSchema = z.object({
  driveFolderUrl: z
    .string()
    .trim()
    .refine(
      (value) => {
        if (value === '') return true;
        try {
          const url = new URL(value);
          return url.protocol === 'https:' && DRIVE_HOSTS.includes(url.hostname);
        } catch {
          return false;
        }
      },
      { message: 'Enter a valid https://drive.google.com link.' },
    ),
});

export type DriveFolderValues = z.infer<typeof driveFolderSchema>;
