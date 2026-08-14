'use client';

import { authClient } from '@/app/lib/auth-client';
import { ALLOWED_DOMAIN, isInternalUser } from '@/app/lib/internal-user';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@trycompai/ui/button';
import { Input } from '@trycompai/ui/input';
import { Loader2, Mail } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

const formSchema = z.object({
  email: z
    .string()
    .email('Enter a valid email address')
    // The editor is internal-only, so fail fast instead of emailing a link
    // that lands on the "you don't belong here" screen.
    .refine(isInternalUser, `Use your @${ALLOWED_DOMAIN} email address`),
});

type FormValues = z.infer<typeof formSchema>;

export function MagicLinkSignIn({ onMagicLinkSent }: { onMagicLinkSent: (email: string) => void }) {
  const [isLoading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '' },
  });

  const handleMagicLink = async ({ email }: FormValues) => {
    setLoading(true);

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL: `${origin}/`,
    });

    setLoading(false);

    if (error) {
      toast.error('Error sending email - try again?');
      return;
    }

    onMagicLinkSent(email);
  };

  return (
    <form onSubmit={handleSubmit(handleMagicLink)} className="flex w-full flex-col gap-2" noValidate>
      <Input
        {...register('email')}
        type="email"
        placeholder={`name@${ALLOWED_DOMAIN}`}
        aria-label="Email address"
        aria-invalid={!!errors.email}
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="h-[40px]"
      />

      {errors.email && (
        <p role="alert" className="text-destructive text-xs">
          {errors.email.message}
        </p>
      )}

      <Button
        type="submit"
        disabled={isLoading}
        className="flex h-[40px] w-full space-x-2 px-6 py-4 font-medium active:scale-[0.98]"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Mail className="h-4 w-4" />
            <span>Continue with email</span>
          </>
        )}
      </Button>
    </form>
  );
}
