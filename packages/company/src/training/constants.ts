/** Every training counts for a year, so each group renews annually. */
export const TRAINING_VALIDITY_DAYS = 365;

/**
 * How long before a completion expires the renewal is offered. Longer than the
 * monthly renewal scan interval, so every expiry is seen at least once.
 */
export const TRAINING_RENEWAL_WINDOW_DAYS = 60;

export const DAY_MS = 24 * 60 * 60 * 1000;
