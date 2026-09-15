import * as Sentry from "@sentry/nextjs";
import { getValidSentryDsn } from "@/lib/sentry-dsn";

const dsn = getValidSentryDsn();

Sentry.init({
  dsn,
  tracesSampleRate: 0.2,
  enabled: !!dsn,
});
