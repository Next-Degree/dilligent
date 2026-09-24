'use client';

import { Text } from '@trycompai/design-system';

/**
 * Where an access card's data came from.
 *
 * The employee page shows two access cards side by side that answer different questions:
 * one reports what a connected tool says about this person's account there, the other
 * reports what this person authorized third parties to do with their work Google account.
 * For a vendor that is both — Slack connected as an integration *and* signed into with
 * Google — the two cards legitimately show different people and different counts.
 *
 * Rendered unconditionally, including while loading and when empty. That is precisely when
 * someone is most likely to wonder why one card is populated and the other is not.
 */
export function AccessSourceNote({ children }: { children: React.ReactNode }) {
  return (
    <Text size="xs" variant="muted">
      {children}
    </Text>
  );
}
