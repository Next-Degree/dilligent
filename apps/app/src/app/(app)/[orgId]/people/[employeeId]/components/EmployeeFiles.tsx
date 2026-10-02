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
  HStack,
  Input,
  Stack,
  Text,
} from '@trycompai/design-system';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { driveFolderSchema, type DriveFolderValues } from './driveFolderSchema';

/**
 * Points a member at the Google Drive folder that holds their own files
 * (contracts, onboarding paperwork). We only store the link: who can open the
 * folder is controlled by its sharing settings in Drive.
 */
export function EmployeeFiles({
  memberId,
  driveFolderUrl,
  canEdit,
}: {
  memberId: string;
  driveFolderUrl: string | null;
  canEdit: boolean;
}) {
  const api = useApi();
  const router = useRouter();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<DriveFolderValues>({
    resolver: zodResolver(driveFolderSchema),
    defaultValues: { driveFolderUrl: driveFolderUrl ?? '' },
  });

  const handleSave = handleSubmit(async (values) => {
    const url = values.driveFolderUrl.trim();
    const response = await api.patch(`/v1/people/${memberId}`, {
      driveFolderUrl: url === '' ? null : url,
    });
    if (response.error) {
      toast.error(response.error || 'Failed to save the Drive folder');
      return;
    }

    toast.success(url === '' ? 'Drive folder removed' : 'Drive folder saved');
    reset({ driveFolderUrl: url });
    // The page is server rendered, so refresh to pick up the stored value.
    router.refresh();
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Files</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} noValidate>
          <Stack gap="md">
            <Text size="sm" variant="muted">
              Link the Google Drive folder that holds this person&apos;s own files, such as
              contracts. Share the folder with them in Drive; access is controlled there.
            </Text>

            <Field>
              <FieldLabel htmlFor="driveFolderUrl">Google Drive folder link</FieldLabel>
              <Input
                id="driveFolderUrl"
                type="url"
                placeholder="https://drive.google.com/drive/folders/..."
                disabled={!canEdit}
                aria-invalid={errors.driveFolderUrl ? true : undefined}
                {...register('driveFolderUrl')}
              />
              {errors.driveFolderUrl && <FieldError>{errors.driveFolderUrl.message}</FieldError>}
            </Field>

            <HStack justify="between" align="center">
              {driveFolderUrl ? (
                <a href={driveFolderUrl} target="_blank" rel="noopener noreferrer">
                  <Text size="sm">Open folder in Google Drive</Text>
                </a>
              ) : (
                <Text size="sm" variant="muted">
                  No folder linked yet.
                </Text>
              )}
              {canEdit && (
                <Button
                  type="submit"
                  disabled={!isDirty || isSubmitting}
                  loading={isSubmitting}
                >
                  Save
                </Button>
              )}
            </HStack>
          </Stack>
        </form>
      </CardContent>
    </Card>
  );
}
