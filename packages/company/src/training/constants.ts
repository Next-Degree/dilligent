/** Every training counts for a year, so each group renews annually. */
export const TRAINING_VALIDITY_DAYS = 365;

/**
 * How long before a completion expires the renewal is offered. Longer than the
 * monthly renewal scan interval, so every expiry is seen at least once.
 */
export const TRAINING_RENEWAL_WINDOW_DAYS = 60;

/**
 * In a training that is not finished, progress older than this no longer
 * counts and that module is done again. It is a year minus the renewal window,
 * so finishing a training always leaves it valid for longer than the renewal
 * window: it can never be due for renewal the moment it is finished.
 */
export const TRAINING_PROGRESS_LAPSE_DAYS = TRAINING_VALIDITY_DAYS - TRAINING_RENEWAL_WINDOW_DAYS;

/**
 * Cycles finished before this date are exempt from the lapse rule for finished
 * cycles. Data recorded before this change could finish a cycle whose videos
 * were more than the lapse period apart; such a cycle still counts, with its
 * year running from its oldest video, so those members keep the status and
 * certificate they had. Cycles finished from this date on are judged strictly,
 * because the write paths make members rewatch a lapsed video first.
 *
 * Set this to the day the code with this rule is fully deployed, and bump it
 * at merge time if the merge slips. Too early, and a spread cycle finished by
 * the previous code before the deploy is judged strictly; too late, and one
 * finished by this code without rewatching the lapsed video counts.
 */
export const TRAINING_STRICT_SPAN_SINCE = new Date('2026-11-19T00:00:00.000Z');

export const DAY_MS = 24 * 60 * 60 * 1000;
