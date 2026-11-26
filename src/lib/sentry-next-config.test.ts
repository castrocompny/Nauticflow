import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

describe("Sentry Next.js config bootstrap", () => {
  it("loads the production Next config in the Node runtime", async () => {
    const configUrl = pathToFileURL(resolve(process.cwd(), "next.config.mjs")).href;
    const { default: config } = await import(/* @vite-ignore */ configUrl);

    expect(typeof config.headers).toBe("function");
  });
});
