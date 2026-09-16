import type { CheckContext } from '../../types';
import type { VercelFirewallConfig, VercelFirewallConfigResponse } from './types';

export const FIREWALL_DENIED_REMEDIATION =
  'Check that the Vercel access token was created by an account with Owner or Security access to this team, and confirm your Vercel plan includes the Web Application Firewall.';

/** The endpoint returns the config directly on some versions, wrapped on others. */
export function unwrapFirewallConfig(raw: unknown): VercelFirewallConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const wrapped = (raw as VercelFirewallConfigResponse).active;
  if (wrapped && typeof wrapped === 'object') return wrapped;
  return 'firewallEnabled' in raw ? (raw as VercelFirewallConfig) : null;
}

/**
 * Read a project's active firewall config. Vercel serves it under two path
 * variants depending on the account's API version — the versioned form with
 * the literal `active`, and the bare form that wraps it in `{ active }` — so a
 * 404/400 on the first is retried against the second before giving up.
 */
export async function fetchActiveFirewallConfig(
  ctx: CheckContext,
  params: URLSearchParams,
): Promise<VercelFirewallConfig | null> {
  try {
    return unwrapFirewallConfig(
      await ctx.fetch<unknown>(`/v1/security/firewall/config/active?${params.toString()}`),
    );
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    if (status !== 404 && status !== 400) {
      throw error;
    }
    return unwrapFirewallConfig(
      await ctx.fetch<unknown>(`/v1/security/firewall/config?${params.toString()}`),
    );
  }
}

export interface FirewallSummary {
  firewallEnabled: boolean | null;
  configVersion: number | null;
  updatedAt: string | null;
  botIdEnabled: boolean;
  activeManagedRules: string[];
  customRuleCount: number;
  activeCustomRuleCount: number;
  ipRuleCount: number;
  /** IP rules that deny or challenge traffic rather than allowing it. */
  denyingIpRuleCount: number;
}

/** IP-rule actions that stop or interrogate traffic rather than letting it in. */
const BLOCKING_IP_ACTIONS: ReadonlySet<string> = new Set(['deny', 'challenge', 'block']);

export function summarizeFirewallConfig(config: VercelFirewallConfig): FirewallSummary {
  const managedRules = config.managedRules ?? {};
  return {
    firewallEnabled: config.firewallEnabled ?? null,
    configVersion: config.version ?? null,
    updatedAt: config.updatedAt ?? null,
    botIdEnabled: config.botIdEnabled ?? false,
    activeManagedRules: Object.entries(managedRules)
      .filter(([, rule]) => rule?.active)
      .map(([name]) => name),
    customRuleCount: config.rules?.length ?? 0,
    activeCustomRuleCount: config.rules?.filter((rule) => rule.active !== false).length ?? 0,
    ipRuleCount: config.ips?.length ?? 0,
    denyingIpRuleCount:
      config.ips?.filter((rule) => BLOCKING_IP_ACTIONS.has(String(rule.action ?? '').toLowerCase()))
        .length ?? 0,
  };
}
