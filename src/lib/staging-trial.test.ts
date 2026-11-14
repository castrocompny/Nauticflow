import { describe, expect, it } from "vitest";
import { canGrantStagingTrial, isStagingTrialGrantEnabled } from "./staging-trial";

const STAGING_URL = "https://ddlgkrpjzmtgmoucangh.supabase.co";
const NOW = new Date("2026-11-12T15:00:00.000Z");

describe("Staging trial safeguards", () => {
  it("is disabled unless the server-only flag is explicitly enabled", () => {
    expect(isStagingTrialGrantEnabled({ NEXT_PUBLIC_SUPABASE_URL: STAGING_URL })).toBe(false);
    expect(
      isStagingTrialGrantEnabled({
        NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
        NAUTICFLOW_STAGING_TRIALS_ENABLED: "true",
      })
    ).toBe(true);
  });

  it.each([
    ["production project", "https://gggpihphjjxndpfntnvm.supabase.co"],
    ["different Supabase project", "https://another-project.supabase.co"],
    ["insecure URL", "http://ddlgkrpjzmtgmoucangh.supabase.co"],
    ["malformed URL", "not-a-url"],
  ])("rejects %s even when the flag is enabled", (_label, url) => {
    expect(
      isStagingTrialGrantEnabled({
        NEXT_PUBLIC_SUPABASE_URL: url,
        NAUTICFLOW_STAGING_TRIALS_ENABLED: "true",
      })
    ).toBe(false);
  });

  it("permits only an expired active trial with no Asaas subscription", () => {
    expect(
      canGrantStagingTrial({
        status: "ativa",
        paidUntil: "2026-11-01T00:00:00.000Z",
        asaasSubscriptionId: null,
        now: NOW,
      })
    ).toBe(true);

    expect(
      canGrantStagingTrial({
        status: "ativa",
        paidUntil: "2026-11-13T00:00:00.000Z",
        asaasSubscriptionId: null,
        now: NOW,
      })
    ).toBe(false);
    expect(
      canGrantStagingTrial({
        status: "cancelada",
        paidUntil: "2026-11-01T00:00:00.000Z",
        asaasSubscriptionId: null,
        now: NOW,
      })
    ).toBe(false);
    expect(
      canGrantStagingTrial({
        status: "ativa",
        paidUntil: "2026-11-01T00:00:00.000Z",
        asaasSubscriptionId: "asaas_sub_example",
        now: NOW,
      })
    ).toBe(false);
    expect(
      canGrantStagingTrial({
        status: "ativa",
        paidUntil: null,
        asaasSubscriptionId: null,
        now: NOW,
      })
    ).toBe(false);
  });
});
