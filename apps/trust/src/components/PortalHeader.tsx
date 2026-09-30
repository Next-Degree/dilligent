import type { Summary } from '@/lib/schemas';
import { CheckmarkFilled } from '@trycompai/design-system/icons';

/** Floating dark-teal pill, like the Pickle landing page navigation. */
export function PortalHeader({ summary }: { summary: Summary }) {
  return (
    <div className="sticky top-0 z-40 px-4 pt-4 md:px-8">
      <header className="mx-auto flex h-15 w-full max-w-300 items-center justify-between gap-3 rounded-full border border-white/10 bg-brand-dark/95 px-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] backdrop-blur-sm md:px-8">
        <div className="flex min-w-0 items-center gap-3">
          {summary.logoUrl ? (
            <span className="flex h-9 shrink-0 items-center rounded-full bg-white px-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={summary.logoUrl}
                alt={`${summary.organizationName} logo`}
                className="h-4 w-auto max-w-28 object-contain md:h-5"
              />
            </span>
          ) : null}
          <span className="truncate text-sm font-medium text-white/90">
            {summary.organizationName}
          </span>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground">
          <CheckmarkFilled size={14} />
          Verified
        </span>
      </header>
    </div>
  );
}
