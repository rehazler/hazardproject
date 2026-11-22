// Usage-meter math, kept separate so test.mjs can run it under plain Node.

export const BUDGET_USD = 100;
// Per-token prices live in supabase-migration-v6.sql (ai_usage.cost_usd).

// Start of the current credit cycle (UTC). ponytail: day 29-31 renewals clamp to
// the 28th; Console Billing page stays the source of truth.
export function cycleBounds(env, now = new Date()) {
    const day = Math.min(Math.max(parseInt(env.BILLING_CYCLE_DAY, 10) || 1, 1), 28);
    let start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
    if (start > now) start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, day));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, day));
    return { start, end };
}

