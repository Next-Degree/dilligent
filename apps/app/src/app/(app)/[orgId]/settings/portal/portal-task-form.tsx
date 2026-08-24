'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Switch,
  Textarea,
} from '@trycompai/design-system';
import { useMediaQuery } from '@trycompai/ui/hooks';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import type { PortalTaskInput, PortalTaskRow } from './hooks/use-portal-tasks';

const schema = z
  .object({
    title: z.string().min(1, 'Title is required').max(200),
    description: z.string().max(5000).optional(),
    kind: z.enum(['acknowledgement', 'link']),
    externalUrl: z.string().url('Enter a full URL, including https://').or(z.literal('')).optional(),
    acknowledgementText: z.string().max(2000).optional(),
    isRequired: z.boolean(),
  })
  // Mirrors the DB CHECK constraint: a link task without a destination is unusable.
  .refine((values) => values.kind !== 'link' || Boolean(values.externalUrl), {
    message: 'A link task needs a URL',
    path: ['externalUrl'],
  });

type PortalTaskFormValues = z.infer<typeof schema>;

interface PortalTaskFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: PortalTaskRow;
  onSubmit: (values: PortalTaskInput) => Promise<void>;
}

export function PortalTaskForm({
  open,
  onOpenChange,
  task,
  onSubmit,
}: PortalTaskFormProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PortalTaskFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: task?.title ?? '',
      description: task?.description ?? '',
      kind: task?.kind ?? 'acknowledgement',
      externalUrl: task?.externalUrl ?? '',
      acknowledgementText: task?.acknowledgementText ?? '',
      isRequired: task?.isRequired ?? true,
    },
  });

  const kind = watch('kind');

  const handleValid = async (values: PortalTaskFormValues) => {
    try {
      await onSubmit({
        title: values.title,
        description: values.description || undefined,
        kind: values.kind,
        externalUrl: values.externalUrl || undefined,
        acknowledgementText: values.acknowledgementText || undefined,
        isRequired: values.isRequired,
      });
    } catch {
      // The caller has already surfaced the failure; keep the form open with
      // the entered values so the save can be retried.
      return;
    }
    reset();
    onOpenChange(false);
  };

  const title = task ? 'Edit portal task' : 'New portal task';

  const form = (
    <form onSubmit={handleSubmit(handleValid)}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="portal-task-title">Title</FieldLabel>
          <Input
            id="portal-task-title"
            placeholder="e.g. Acknowledge the 2026 Code of Conduct"
            {...register('title')}
          />
          {errors.title && <FieldError>{errors.title.message}</FieldError>}
        </Field>

        <Field>
          <FieldLabel htmlFor="portal-task-description">Description</FieldLabel>
          <Textarea
            id="portal-task-description"
            rows={3}
            placeholder="What the employee needs to do"
            {...register('description')}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="portal-task-kind">Type</FieldLabel>
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="portal-task-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="acknowledgement">
                    Acknowledgement
                  </SelectItem>
                  <SelectItem value="link">Visit a link</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
          <FieldDescription>
            Acknowledgement asks the employee to read and confirm. Visit a link
            sends them somewhere first.
          </FieldDescription>
        </Field>

        {kind === 'link' && (
          <Field>
            <FieldLabel htmlFor="portal-task-url">Link URL</FieldLabel>
            <Input
              id="portal-task-url"
              placeholder="https://example.com/handbook"
              {...register('externalUrl')}
            />
            {errors.externalUrl && (
              <FieldError>{errors.externalUrl.message}</FieldError>
            )}
          </Field>
        )}

        <Field>
          <FieldLabel htmlFor="portal-task-ack">
            Acknowledgement wording
          </FieldLabel>
          <Textarea
            id="portal-task-ack"
            rows={2}
            placeholder="I have read and agree to the Code of Conduct."
            {...register('acknowledgementText')}
          />
          <FieldDescription>
            Saved with each completion, so later edits never rewrite what
            someone already agreed to.
          </FieldDescription>
        </Field>

        <Field orientation="horizontal">
          <Controller
            control={control}
            name="isRequired"
            render={({ field }) => (
              <Switch
                id="portal-task-required"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <FieldLabel htmlFor="portal-task-required">
            Required to complete
          </FieldLabel>
        </Field>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save task'}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );

  if (isDesktop) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <SheetBody>{form}</SheetBody>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
        </DrawerHeader>
        <div className="p-4">{form}</div>
      </DrawerContent>
    </Drawer>
  );
}
