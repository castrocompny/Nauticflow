export const STAGING_TRIAL_DAYS = 7;

const STAGING_SUPABASE_PROJECT_REF = "ddlgkrpjzmtgmoucangh";

export function isStagingTrialGrantEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.NAUTICFLOW_STAGING_TRIALS_ENABLED !== "true") return false;

  const configuredUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configuredUrl) return false;

  try {
    const url = new URL(configuredUrl);
    return (
      url.protocol === "https:" &&
      url.hostname === `${STAGING_SUPABASE_PROJECT_REF}.supabase.co` &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      (url.pathname === "" || url.pathname === "/") &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

type StagingTrialEligibility = {
  status: string;
  paidUntil: string | null;
  asaasSubscriptionId: string | null;
  now: Date;
};

export function canGrantStagingTrial({
  status,
  paidUntil,
  asaasSubscriptionId,
  now,
}: StagingTrialEligibility): boolean {
  if (status !== "ativa" || asaasSubscriptionId !== null || !paidUntil) return false;

  const expiry = Date.parse(paidUntil);
  return Number.isFinite(expiry) && expiry <= now.getTime();
}
