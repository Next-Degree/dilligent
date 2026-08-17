'use client';

import { Button } from '@trycompai/ui';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { GoogleSignIn } from './google-sign-in';
import { MagicLinkSignIn } from './magic-link-sign-in';

export function SignInOptions() {
  const [sentTo, setSentTo] = useState<string | null>(null);

  const handleMagicLinkSent = (email: string) => setSentTo(email);
  const handleUseAnotherMethod = () => setSentTo(null);

  if (sentTo) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <CheckCircle2 className="h-12 w-12" />
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-medium">Magic link sent</h3>
          <p className="text-muted-foreground text-sm break-words">
            Check your inbox at <span className="text-foreground font-medium">{sentTo}</span> for a
            link to sign in.
          </p>
        </div>
        <Button variant="link" onClick={handleUseAnotherMethod}>
          Use another method
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <GoogleSignIn />

      <div className="relative flex items-center justify-center">
        <span className="absolute inset-x-0 top-1/2 border-t" />
        <span className="bg-background text-muted-foreground relative px-2 text-xs uppercase">
          or
        </span>
      </div>

      <MagicLinkSignIn onMagicLinkSent={handleMagicLinkSent} />
    </div>
  );
}
