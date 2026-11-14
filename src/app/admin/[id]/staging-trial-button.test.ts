import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ grantStagingTrial: vi.fn() }));

import { StagingTrialButton } from "./staging-trial-button";

describe("StagingTrialButton", () => {
  it("clearly labels a no-charge seven-day test access and requires an audit reason", () => {
    const html = renderToStaticMarkup(
      createElement(StagingTrialButton, { companyId: "11111111-1111-4111-8111-111111111111" }),
    );

    expect(html).toContain("Liberar 7 dias de teste");
    expect(html).toContain("sem cobrança e sem Asaas");
    expect(html).toContain("Motivo obrigatório");
    expect(html).toContain("required");
  });
});
