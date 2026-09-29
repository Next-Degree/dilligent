type Method = 'GET' | 'POST';

type Rule = { method: Method; pattern: readonly string[] };

const PARAM = ':';

/**
 * Only these public trust-access calls may be made from the browser through
 * the Next.js proxy route. Everything else (all admin routes included) is 404.
 */
const RULES: readonly Rule[] = [
  { method: 'POST', pattern: [':friendlyUrl', 'requests'] },
  { method: 'POST', pattern: [':friendlyUrl', 'reclaim'] },
  { method: 'POST', pattern: ['nda', ':token', 'preview-nda'] },
  { method: 'POST', pattern: ['nda', ':token', 'sign'] },
  { method: 'GET', pattern: ['access', ':token', 'policies', 'download-all'] },
  { method: 'GET', pattern: ['access', ':token', 'policies', ':id', 'download'] },
  { method: 'GET', pattern: ['access', ':token', 'documents', 'download-all'] },
  { method: 'GET', pattern: ['access', ':token', 'documents', ':id'] },
  { method: 'GET', pattern: ['access', ':token', 'compliance-resources', 'custom', ':id'] },
  { method: 'GET', pattern: ['access', ':token', 'compliance-resources', ':framework'] },
];

// Admin and listing segments that must never satisfy a `:friendlyUrl` slot.
const RESERVED_FIRST_SEGMENTS = new Set(['admin', 'access', 'nda']);

function matches(rule: Rule, segments: readonly string[]): boolean {
  if (rule.pattern.length !== segments.length) return false;
  return rule.pattern.every((part, index) => {
    const segment = segments[index];
    if (!segment) return false;
    if (!part.startsWith(PARAM)) return part === segment;
    return !(index === 0 && RESERVED_FIRST_SEGMENTS.has(segment));
  });
}

export function isAllowedProxyCall(params: {
  method: string;
  segments: readonly string[];
}): boolean {
  const { method, segments } = params;
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    return false;
  }
  return RULES.some((rule) => rule.method === method && matches(rule, segments));
}
