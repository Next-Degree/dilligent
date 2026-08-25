// Canonical identifier lists the seeded catalogs are validated against.
// SOC 2: 2017 Trust Services Criteria (with 2022 points of focus).
// ISO 27001: 2022 edition — management clauses + Annex A.

const range = (prefix: string, from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);

/** TSC category → criteria identifiers. CC + A are in audit scope; the rest
 * are seeded for future-proofing and validated at warning level. */
export const TSC_CRITERIA: Record<string, string[]> = {
  CC: [
    ...range('CC1.', 1, 5),
    ...range('CC2.', 1, 3),
    ...range('CC3.', 1, 4),
    ...range('CC4.', 1, 2),
    ...range('CC5.', 1, 3),
    ...range('CC6.', 1, 8),
    ...range('CC7.', 1, 5),
    'CC8.1',
    ...range('CC9.', 1, 2),
  ],
  A: range('A1.', 1, 3),
  C: range('C1.', 1, 2),
  PI: range('PI1.', 1, 5),
  P: [
    'P1.1',
    'P2.1',
    'P3.1',
    'P3.2',
    ...range('P4.', 1, 3),
    ...range('P5.', 1, 2),
    ...range('P6.', 1, 7),
    'P7.1',
    'P8.1',
  ],
};

/** TSC categories that must be fully covered (error on a gap). */
export const TSC_ERROR_CATEGORIES = ['CC', 'A'];

/** ISO 27001:2022 management clauses (validated at warning level — the ISMS
 * document templates cover several of these outside the requirements table). */
export const ISO_CLAUSES: string[] = [
  ...range('4.', 1, 4),
  ...range('5.', 1, 3),
  '6.1.1',
  '6.1.2',
  '6.1.3',
  '6.2',
  '6.3',
  ...range('7.', 1, 4),
  '7.5.1',
  '7.5.2',
  '7.5.3',
  ...range('8.', 1, 3),
  ...range('9.', 1, 3),
  '10.1',
  '10.2',
];

/** ISO 27001:2022 Annex A — 93 controls (error on a gap). */
export const ISO_ANNEX_A: string[] = [
  ...range('A.5.', 1, 37),
  ...range('A.6.', 1, 8),
  ...range('A.7.', 1, 14),
  ...range('A.8.', 1, 34),
];
