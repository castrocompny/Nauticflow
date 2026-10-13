# Graph Report - Nauticflow  (2026-09-20)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1122 nodes · 2932 edges · 74 communities (67 shown, 7 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 28 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `fb4a9a43`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- admin/[id]/page.tsx
- partner-row.tsx
- saidas/actions.ts
- marketplace-api.ts
- ui.tsx
- asaas.ts
- public-api.ts
- reservation-alerts-settings.tsx
- app/page.tsx
- createClient
- payout-actions.ts
- provider.ts
- lib/types.ts
- new-reservation-form.tsx
- server.ts
- fmtDate
- departure-row.tsx
- createAdminClient
- passeios/[id]/page.tsx
- @sentry/nextjs
- payment/route.ts
- react
- schedule-actions.ts
- compilerOptions
- trial-identity.ts
- format.ts
- brl
- section.tsx
- equipe/actions.ts
- lucide-react
- dashboard/page.tsx
- automation.tsx
- mfa-challenge/page.tsx
- tour-schedule.ts
- passeios/actions.ts
- react-dom
- package.json
- admin/page.tsx
- getProfile
- publication-panel.tsx
- refund-provider-actions.ts
- devDependencies
- billing-actions.ts
- booking-models.tsx
- marketplace-ledger.ts
- send-reservation-voucher/index.ts
- asaas/route.ts
- photo-manager.tsx
- ecosystem.tsx
- dependencies
- createClient
- image-moderation.ts
- login/actions.ts
- manifesto/[id]/page.tsx
- sales-flow.tsx
- reservation-status-select.tsx
- redefinir-senha/page.tsx
- next
- app/layout.tsx
- clientes/actions.ts
- pricing.tsx
- proxy.ts
- (app)/layout.tsx
- login/page.tsx
- showcase.tsx
- scripts
- TourCard
- next-env.d.ts
- @supabase/supabase-js
- eslint.config.mjs
- tailwindcss
- vercel.json
- postcss.config.mjs

## God Nodes (most connected - your core abstractions)
1. `createClient()` - 129 edges
2. `next` - 87 edges
3. `react` - 77 edges
4. `lucide-react` - 69 edges
5. `getProfile` - 57 edges
6. `fmtDate()` - 40 edges
7. `createAdminClient()` - 35 edges
8. `brl()` - 35 edges
9. `Card()` - 31 edges
10. `react-dom` - 29 edges

## Surprising Connections (you probably didn't know these)
- `ClientEditForm()` --calls--> `updateClient()`  [EXTRACTED]
  src/app/(app)/clientes/client-edit-form.tsx → src/app/(app)/clientes/actions.ts
- `DepartureRow()` --indirect_call--> `cancelDeparture()`  [INFERRED]
  src/app/(app)/saidas/departure-row.tsx → src/app/(app)/saidas/actions.ts
- `DepartureRow()` --indirect_call--> `confirmDeparture()`  [INFERRED]
  src/app/(app)/saidas/departure-row.tsx → src/app/(app)/saidas/actions.ts
- `TourForm()` --indirect_call--> `updateTourFull()`  [INFERRED]
  src/app/(app)/passeios/[id]/tour-form.tsx → src/app/(app)/passeios/actions.ts
- `DeleteAccountForm()` --indirect_call--> `deleteMyAccount()`  [INFERRED]
  src/app/(app)/configuracoes/delete-account-form.tsx → src/app/(app)/configuracoes/actions.ts

## Import Cycles
- None detected.

## Communities (74 total, 7 thin omitted)

### Community 0 - "admin/[id]/page.tsx"
Cohesion: 0.11
Nodes (35): changePlan(), deleteCompanyPermanently(), deleteInvoice(), logAction(), registerInvoice(), renewSubscription(), revalidateAffectedCompany(), suspendCompany() (+27 more)

### Community 1 - "partner-row.tsx"
Cohesion: 0.08
Nodes (24): ClientEditForm(), ClientEditForm, ClientRow(), updateVessel(), VesselEditForm(), typeLabel, VesselEditForm, VesselRow() (+16 more)

### Community 2 - "saidas/actions.ts"
Cohesion: 0.10
Nodes (29): BulkCleanupPreview, cancelDeparture(), clearCompanyDepartures(), ClearRpcRow, companyId(), confirmDeparture(), createDeparture(), deleteDeparture() (+21 more)

### Community 3 - "marketplace-api.ts"
Cohesion: 0.11
Nodes (33): BookingRpcRow, CompanyEmbed, dynamic, fail(), onlyDigits(), POST(), TourEmbed, autoTotalCents() (+25 more)

### Community 4 - "ui.tsx"
Cohesion: 0.13
Nodes (20): Member, roleLabel, Partner, statusBadge, DepRow, FlexibleRuleRow, NewFormDepRow, ReservationsPage() (+12 more)

### Community 5 - "asaas.ts"
Cohesion: 0.08
Nodes (33): AsaasCustomer, AsaasCustomerSearchResult, asaasFetch(), AsaasMarketplacePayment, AsaasPaymentSearchResult, AsaasPaymentsList, AsaasPaymentWithRefunds, AsaasPixPayment (+25 more)

### Community 6 - "public-api.ts"
Cohesion: 0.11
Nodes (24): dynamic, GET(), dynamic, GET(), dynamic, GET(), dynamic, GET() (+16 more)

### Community 7 - "reservation-alerts-settings.tsx"
Cohesion: 0.17
Nodes (26): getPermissionSnapshot(), getServerNotificationPrefSnapshot(), getServerPermissionSnapshot(), getServerSoundSnapshot(), ReservationAlertsSettings(), testAlert(), toggleNotification(), toggleSound() (+18 more)

### Community 8 - "app/page.tsx"
Cohesion: 0.13
Nodes (16): jsonLd, metadata, AUDIENCE, FinalCta(), Hero(), MICROCOPY, MarketingMotionStyles(), CASTRO_COMPNY (+8 more)

### Community 9 - "createClient"
Cohesion: 0.14
Nodes (21): ClientsPage(), createVessel(), deleteVessel(), NewVesselForm(), VesselsPage(), FinanceiroPage(), getFinancialSummary(), listWithdrawals() (+13 more)

### Community 10 - "payout-actions.ts"
Cohesion: 0.15
Nodes (18): RFC-5322, PayoutAccountForm(), TYPE_LABELS, FinancialSummaryDTO, FinancialSummaryRpcRow, PayoutAccountDTO, setPayoutAccount(), SetPayoutAccountState (+10 more)

### Community 11 - "provider.ts"
Cohesion: 0.15
Nodes (18): ref_server_only, DepartureWindSummary, nearestWindForecast(), windSummaryForDeparture(), COMPASS_LABELS, degreesToCompassLabel(), fetchOpenMeteoWind(), OpenMeteoResponse (+10 more)

### Community 12 - "lib/types.ts"
Cohesion: 0.10
Nodes (21): updateBookingModel(), BookingModelSection(), choose(), OPTIONS, Company, Departure, DepartureStatus, FlexiblePricingMode (+13 more)

### Community 13 - "new-reservation-form.tsx"
Cohesion: 0.13
Nodes (19): getVesselOccupiedPeriods(), addMinutesToTime(), centsToReaisInput(), ClientHit, DepartureOption, flexAutoPriceCents(), FlexibleRuleOption, formatDurationHours() (+11 more)

### Community 14 - "server.ts"
Cohesion: 0.16
Nodes (15): getPaymentBreakdown(), PaymentBreakdownDTO, ReservationOutcome, SetOutcomeResult, setReservationOutcome(), OUTCOME_LABEL, OutcomeButtons(), set() (+7 more)

### Community 15 - "fmtDate"
Cohesion: 0.15
Nodes (15): AdminToursPage(), ClientDetail(), ResRow, DepRow, typeLabel, VesselDetail(), Partner, PartnerDetail() (+7 more)

### Community 16 - "departure-row.tsx"
Cohesion: 0.15
Nodes (16): booked(), DepartureRow(), ClientOption, DepOption, ReservationRow(), ResRow, sourceLabel, sourceTone (+8 more)

### Community 17 - "createAdminClient"
Cohesion: 0.18
Nodes (14): createWithdrawal(), CreateWithdrawalResult, dispatchWithdrawalToProvider(), WithdrawalDTO, STATUS_LABEL, STATUS_TONE, WithdrawalPanel(), cancelMarketplacePendingPayment() (+6 more)

### Community 18 - "passeios/[id]/page.tsx"
Cohesion: 0.16
Nodes (11): setFlexibleBookingRuleActive(), DAY_LABELS, FlexibleBookingSection(), toggle(), DAY_LABELS, QuickScheduleSetup(), ScheduleSection(), TourForm() (+3 more)

### Community 19 - "@sentry/nextjs"
Cohesion: 0.16
Nodes (10): csp, nextConfig, @sentry/nextjs, dsn, dsn, dsn, onRouterTransitionStart, onRequestError (+2 more)

### Community 20 - "payment/route.ts"
Cohesion: 0.16
Nodes (17): ref_crypto, dynamic, fail(), PaymentRpcRow, POST(), dynamic, fail(), GET() (+9 more)

### Community 21 - "react"
Cohesion: 0.18
Nodes (13): react, signOut(), AppShell(), Notif, NotificationsBell(), navGroups, Sidebar(), ThemeToggle() (+5 more)

### Community 22 - "schedule-actions.ts"
Cohesion: 0.19
Nodes (15): ActionResult, createOneOffDepartureForTour(), getScheduleRule(), pauseRecurringSchedule(), quickSetupSchedule(), reactivateRecurringSchedule(), saveRecurringSchedule(), DAY_LABELS (+7 more)

### Community 23 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 24 - "trial-identity.ts"
Cohesion: 0.18
Nodes (13): ref_node_crypto, signUp(), CNPJ_WEIGHTS_1, CNPJ_WEIGHTS_2, cnpjCheckDigit(), cpfCheckDigit(), detectDocumentKind(), DocumentKind (+5 more)

### Community 25 - "format.ts"
Cohesion: 0.23
Nodes (13): addDays(), AgendaPage(), Dep, filters, rangeFor(), PERIODS, periodStartFor(), RelatoriosPage() (+5 more)

### Community 26 - "brl"
Cohesion: 0.15
Nodes (12): ConfiguracoesPage(), Invoice, MONTH_NAMES, Res, WithdrawalHistory(), commonFeatures, Plan, PlanCards() (+4 more)

### Community 27 - "section.tsx"
Cohesion: 0.14
Nodes (13): ANTES, BeforeAfter(), DEPOIS, HowItWorks(), STEPS, CLIENTES, FROTA, OperationOverview() (+5 more)

### Community 28 - "equipe/actions.ts"
Cohesion: 0.21
Nodes (11): inviteTeamMember(), removeTeamMember(), resendInvite(), sendInviteEmail(), InviteForm(), RemoveButton(), onClick(), ResendInviteButton() (+3 more)

### Community 29 - "lucide-react"
Cohesion: 0.15
Nodes (9): lucide-react, DeleteAccountForm(), close(), onKey(), VoucherPrintButton(), FAQ, faqJsonLd, PasswordInput() (+1 more)

### Community 30 - "dashboard/page.tsx"
Cohesion: 0.20
Nodes (12): Dashboard(), MONTH_FULL, WEEKDAY_FULL, WEEKDAY_LABELS, CalendarDayData, CalendarDeparture, TourCalendar(), loadWeatherState() (+4 more)

### Community 31 - "automation.tsx"
Cohesion: 0.14
Nodes (13): AGENDA_BULLETS, Automation(), DIAS, DIAS_ATIVOS, GERADAS, STEPS, AGENDA, DashboardMockup() (+5 more)

### Community 32 - "mfa-challenge/page.tsx"
Cohesion: 0.19
Nodes (5): MfaChallengePage(), MfaSetupPage(), metadata, metadata, Logo()

### Community 33 - "tour-schedule.ts"
Cohesion: 0.18
Nodes (12): dynamic, GET(), ReconcileRow, GenerateRow, GenerateSummary, RecurringScheduleInput, RecurringScheduleValidated, ScheduleRpcOutcome (+4 more)

### Community 34 - "passeios/actions.ts"
Cohesion: 0.27
Nodes (13): APPROVED_STATUSES, companyId(), deleteTourPhoto(), getPublicationChecklist(), moveTourPhoto(), publishTour(), setCoverPhoto(), toNullableInt() (+5 more)

### Community 35 - "react-dom"
Cohesion: 0.18
Nodes (9): react-dom, createTourDraft(), NewTourForm(), updateReservation(), ClientOption, DepOption, ReservationEditForm(), ResRow (+1 more)

### Community 36 - "package.json"
Cohesion: 0.17
Nodes (11): name, private, version, autoprefixer, eslint, postcss, supabase, @types/node (+3 more)

### Community 37 - "admin/page.tsx"
Cohesion: 0.26
Nodes (9): FunnelChart(), NewCompaniesChart(), PlanDistributionChart(), AdminPage(), Company, latestSub(), MONTH_LABELS, situacao() (+1 more)

### Community 38 - "getProfile"
Cohesion: 0.23
Nodes (8): deleteMyAccount(), updateSettings(), SettingsForm(), EquipePage(), EditTourPage(), Plan, PlanosPage(), getProfile

### Community 39 - "publication-panel.tsx"
Cohesion: 0.23
Nodes (9): displayStatus(), FIELD_ANCHORS, IssueRow(), PublicationPanel(), revealField(), CONTENT_VIOLATION_MESSAGES, friendlyContentErrorMessage(), PublicationIssue (+1 more)

### Community 40 - "refund-provider-actions.ts"
Cohesion: 0.23
Nodes (10): initiateRealMarketplaceRefund(), InitiateRealRefundResult, RefundProviderContextRow, RefundRequestRow, ADR-0007, initiateMarketplacePaymentRefund(), interpretMarkProcessingResult(), MarkProcessingOutcome (+2 more)

### Community 41 - "devDependencies"
Cohesion: 0.18
Nodes (11): devDependencies, autoprefixer, eslint, eslint-config-next, postcss, supabase, tailwindcss, @types/node (+3 more)

### Community 42 - "billing-actions.ts"
Cohesion: 0.35
Nodes (8): cancelAsaasSubscription(), startAsaasCheckout(), PayPlanButton(), onClick(), CancelSubscriptionButton(), onClick(), cancelSubscription(), getFirstInvoiceUrl()

### Community 43 - "booking-models.tsx"
Cohesion: 0.22
Nodes (6): BookingModels(), FROTA_BASE, HORARIOS, TABS, DemoVideo(), Reveal()

### Community 44 - "marketplace-ledger.ts"
Cohesion: 0.20
Nodes (9): calculateRefund(), CalculateRefundInput, CalculateRefundOutput, CancellationPolicy, CancellationPolicyTier, isValidCancellationPolicy(), MarketplaceAmounts, MarketplaceFeeConfig (+1 more)

### Community 45 - "send-reservation-voucher/index.ts"
Cohesion: 0.24
Nodes (6): ref_https, corsHeaders, brl(), buildEmail(), corsHeaders, escapeHtml()

### Community 46 - "asaas/route.ts"
Cohesion: 0.27
Nodes (9): handleMarketplacePaymentEvent(), handleTransferEvent(), IN_PROGRESS_TRANSFER_EVENTS, MARKETPLACE_PAYMENT_EVENTS, POST(), REFUND_EVENTS, RELEVANT_EVENTS, safeEqual() (+1 more)

### Community 47 - "photo-manager.tsx"
Cohesion: 0.27
Nodes (9): addTourPhoto(), ALLOWED_TYPES, APPROVED_STATUSES, MODERATION_BADGE, PhotoManager(), handleUpload(), PhotoWithUrl, readImageDimensions() (+1 more)

### Community 48 - "ecosystem.tsx"
Cohesion: 0.22
Nodes (7): ADR-0013, COMO_VAI_FUNCIONAR, Ecosystem(), FLOW_STEPS, Item, NAUTICFLOW_ITEMS, TOURSFLOW_ITEMS

### Community 49 - "dependencies"
Cohesion: 0.22
Nodes (9): dependencies, lucide-react, next, react, react-dom, @sentry/nextjs, @supabase/ssr, @supabase/supabase-js (+1 more)

### Community 50 - "createClient"
Cohesion: 0.33
Nodes (4): MfaChallengeForm(), MfaSetupForm(), Step, createClient()

### Community 51 - "image-moderation.ts"
Cohesion: 0.36
Nodes (8): retryPhotoModeration(), callOpenAiModeration(), getImageModerationMode(), ImageModerationMode, interpretOpenAiModerationResponse(), ModerationOutcome, normalizeCategoryCode(), runPhotoModeration()

### Community 52 - "login/actions.ts"
Cohesion: 0.47
Nodes (6): forgotPassword(), signIn(), checkRateLimit(), getClientIp(), hashIdentifier(), SITE_URL

### Community 53 - "manifesto/[id]/page.tsx"
Cohesion: 0.25
Nodes (6): Dep, ManifestPage(), Passenger, Res, statusLabel, PrintButton()

### Community 54 - "sales-flow.tsx"
Cohesion: 0.28
Nodes (5): playDemoChime(), WithWebkit, CANAIS, SalesFlow(), STEPS

### Community 55 - "reservation-status-select.tsx"
Cohesion: 0.22
Nodes (4): OPTIONS, ReservationStatusSelect(), Result, Status

### Community 56 - "redefinir-senha/page.tsx"
Cohesion: 0.39
Nodes (4): updatePassword(), RedefinirSenhaPage(), SENHAS_COMUNS, validatePassword()

### Community 57 - "next"
Cohesion: 0.29
Nodes (3): next, dynamic, dynamic

### Community 58 - "app/layout.tsx"
Cohesion: 0.29
Nodes (5): @vercel/analytics, src_app_globals, inter, metadata, poppins

### Community 59 - "clientes/actions.ts"
Cohesion: 0.38
Nodes (4): createClientRecord(), deleteClient(), updateClient(), NewClientForm()

### Community 60 - "pricing.tsx"
Cohesion: 0.43
Nodes (6): MKT_PLANS, calcAnual(), CYCLES, formatBRL(), parseBRL(), Pricing()

### Community 61 - "proxy.ts"
Cohesion: 0.47
Nodes (4): @supabase/ssr, updateSession(), config, proxy()

### Community 62 - "(app)/layout.tsx"
Cohesion: 0.47
Nodes (4): AppLayout(), roleLabel, OverdueBanner(), startEndOfToday()

### Community 65 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, start

### Community 66 - "TourCard"
Cohesion: 0.60
Nodes (5): archiveTour(), TourCard(), close(), confirmDelete(), onKey()

### Community 67 - "next-env.d.ts"
Cohesion: 0.50
Nodes (3): NOTE: This file should not be edited, next_types_root_params_d, next_types_routes_d

### Community 68 - "@supabase/supabase-js"
Cohesion: 0.50
Nodes (3): @supabase/supabase-js, ALLOWED_NEXT_PATHS, GET()

## Knowledge Gaps
- **308 isolated node(s):** `Plan`, `Invoice`, `LogRow`, `Sub`, `Plan` (+303 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 398 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `next` to `admin/[id]/page.tsx`, `partner-row.tsx`, `saidas/actions.ts`, `marketplace-api.ts`, `ui.tsx`, `public-api.ts`, `reservation-alerts-settings.tsx`, `app/page.tsx`, `createClient`, `payout-actions.ts`, `lib/types.ts`, `new-reservation-form.tsx`, `server.ts`, `fmtDate`, `departure-row.tsx`, `createAdminClient`, `passeios/[id]/page.tsx`, `@sentry/nextjs`, `payment/route.ts`, `react`, `schedule-actions.ts`, `format.ts`, `brl`, `equipe/actions.ts`, `dashboard/page.tsx`, `mfa-challenge/page.tsx`, `tour-schedule.ts`, `passeios/actions.ts`, `package.json`, `admin/page.tsx`, `getProfile`, `publication-panel.tsx`, `refund-provider-actions.ts`, `billing-actions.ts`, `booking-models.tsx`, `asaas/route.ts`, `photo-manager.tsx`, `createClient`, `login/actions.ts`, `manifesto/[id]/page.tsx`, `redefinir-senha/page.tsx`, `app/layout.tsx`, `clientes/actions.ts`, `proxy.ts`, `(app)/layout.tsx`, `login/page.tsx`, `@supabase/supabase-js`?**
  _High betweenness centrality (0.348) - this node is a cross-community bridge._
- **Why does `createClient()` connect `createClient` to `admin/[id]/page.tsx`, `partner-row.tsx`, `saidas/actions.ts`, `ui.tsx`, `payout-actions.ts`, `new-reservation-form.tsx`, `server.ts`, `fmtDate`, `departure-row.tsx`, `createAdminClient`, `passeios/[id]/page.tsx`, `react`, `schedule-actions.ts`, `trial-identity.ts`, `format.ts`, `brl`, `equipe/actions.ts`, `dashboard/page.tsx`, `mfa-challenge/page.tsx`, `passeios/actions.ts`, `react-dom`, `getProfile`, `refund-provider-actions.ts`, `billing-actions.ts`, `login/actions.ts`, `manifesto/[id]/page.tsx`, `redefinir-senha/page.tsx`, `clientes/actions.ts`, `(app)/layout.tsx`, `@supabase/supabase-js`?**
  _High betweenness centrality (0.127) - this node is a cross-community bridge._
- **Why does `react` connect `react` to `admin/[id]/page.tsx`, `partner-row.tsx`, `saidas/actions.ts`, `ui.tsx`, `reservation-alerts-settings.tsx`, `app/page.tsx`, `createClient`, `payout-actions.ts`, `lib/types.ts`, `new-reservation-form.tsx`, `server.ts`, `departure-row.tsx`, `createAdminClient`, `passeios/[id]/page.tsx`, `@sentry/nextjs`, `schedule-actions.ts`, `brl`, `section.tsx`, `equipe/actions.ts`, `lucide-react`, `react-dom`, `package.json`, `getProfile`, `publication-panel.tsx`, `billing-actions.ts`, `booking-models.tsx`, `photo-manager.tsx`, `createClient`, `sales-flow.tsx`, `reservation-status-select.tsx`, `redefinir-senha/page.tsx`, `clientes/actions.ts`, `pricing.tsx`, `login/page.tsx`?**
  _High betweenness centrality (0.101) - this node is a cross-community bridge._
- **What connects `Plan`, `Invoice`, `LogRow` to the rest of the system?**
  _308 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `admin/[id]/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.10638297872340426 - nodes in this community are weakly interconnected._
- **Should `partner-row.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.08232118758434548 - nodes in this community are weakly interconnected._
- **Should `saidas/actions.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09672830725462304 - nodes in this community are weakly interconnected._