# StayBangla — Master Roadmap

> এটাই একমাত্র authoritative roadmap ফাইল। আগে দুটো আলাদা জায়গায় (agent memory-র
> `openspec_roadmap.md`, আর একটা conversation-only Stage 0/1/2/3 তালিকা) দুটো
> ভিন্ন, একে-অপরের সাথে না-মেলা roadmap ছিল — এই ফাইল দুটোকে মিলিয়ে একটাই সত্যে
> পরিণত করেছে। ভবিষ্যতে এই ফাইলটাই আপডেট হবে, নতুন কোনো ছায়া-roadmap তৈরি হবে না।

**Status legend:** ✅ সম্পূর্ণ ও merged | 🚧 পরবর্তী কাজ | ⬜ পরিকল্পিত, শুরু হয়নি

**Stack:** Next.js 16 (web) + NestJS (API) + PostgreSQL 16 + Redis + BullMQ + Prisma + MinIO. Monorepo: pnpm workspaces + Turborepo. Single-tenant, multi-role RBAC (TRAVELER, VENDOR, GUIDE, ADMIN, SUPER_ADMIN) — বিস্তারিত `docs/superpowers/specs/`-এর design doc-গুলোতে।

---

## Phase 0 — Foundation

| #   | Module                                                                                                                 | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------ |
| 0.1 | `setup-monorepo-foundation` (pnpm+Turborepo, Next/Nest skeleton, Prisma init, docker-compose postgres/redis/minio, CI) | ✅     |

## Phase 1 — Core MVP

| #    | Module                                                        | Status  | নোট                                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `add-auth-otp-rbac`                                           | ✅      | Traveler OTP + vendor/guide credential auth, JWT rotating-refresh, RolesGuard+CASL                                                                                                                                                    |
| 1.2  | `add-hotel-vehicle-booking-core`                              | ✅      | PR #9 — Booking lifecycle, GIST double-booking constraint, payment stub                                                                                                                                                               |
| 1.3  | `add-room-listing-enhancements` + vendor-approval             | ✅      | PR #12 (2026-07-25 merged) — District/RoomType/BedType enums, hotel/room photo upload, VendorVerificationLog audit trail                                                                                                              |
| 1.4  | `fix-shared-types-contract`                                   | ✅      | PR #16 (2026-07-25 merged) — Hotel/Room/Vehicle/Booking/User shared types, `BookingStatus.SELECTED` drift documented, `GET /hotels/:id`+`GET /vehicles/:id` added, passwordHash leak fixed in vendor-verification endpoints           |
| 1.5  | `add-rate-limiting`                                           | ✅      | PR #20 (2026-07-25 merged) — global ThrottlerModule+Redis storage (APP_GUARD), OTP-request 5/min + login/register 10/min overrides, health-check exempt                                                                               |
| 1.6  | **`add-payment-gateway-integration`** (SSLCommerz — চূড়ান্ত) | 🚧 next | Design সম্পূর্ণ (docs/superpowers/specs/2026-07-25-...) — redirect+webhook flow, `confirm-payment` সরানো হয়েছে design-এ, reconciliation job + append-only LedgerEntry + no-refund-on-CONFIRMED policy। Implementation plan এখনো বাকি |
| 1.7  | `add-observability`                                           | ⬜      | Health check Redis/MinIO/BullMQ পর্যন্ত সম্প্রসারণ                                                                                                                                                                                    |
| 1.8  | `add-api-versioning-docs`                                     | ⬜      | `/v1/` prefix + Swagger `@ApiTags`/`@ApiOperation`                                                                                                                                                                                    |
| 1.9  | `add-vendor-dashboard-basic`                                  | ⬜      | Vendor নিজের listing/booking/daily+monthly earnings দেখার dashboard API                                                                                                                                                               |
| 1.10 | `add-admin-panel-basic`                                       | ⬜      | Vendor suspension effect on bookings, broader audit-log (এখন শুধু vendor-verification-এর আছে)                                                                                                                                         |
| 1.11 | `add-marketing-landing-page`                                  | ⬜      | Public marketing/landing content                                                                                                                                                                                                      |

## Phase 2 — Guides / Payments / Analytics

| #   | Module                                                                                  | Status |
| --- | --------------------------------------------------------------------------------------- | ------ |
| 2.1 | `add-guide-module` (tour guide listing/approval/booking)                                | ⬜     |
| 2.2 | `add-packages-bundling` (hotel+vehicle+guide combo package)                             | ⬜     |
| 2.3 | `add-earnings-analytics-dashboard`                                                      | ⬜     |
| 2.4 | `add-reviews-notifications` (booking SMS/email confirmation, review/rating)             | ⬜     |
| 2.5 | Vehicle photo support (Hotel/Room-এর সাথে সামঞ্জস্য, যদি real product need নিশ্চিত হয়) | ⬜     |

## Phase 3 — Growth

| #   | Module                                             | Status |
| --- | -------------------------------------------------- | ------ |
| 3.1 | `add-vlog-module`                                  | ⬜     |
| 3.2 | `add-search-map-experience` (lat/long + map embed) | ⬜     |
| 3.3 | `add-promotions-loyalty`                           | ⬜     |
| 3.4 | `add-multi-currency-i18n`                          | ⬜     |
| 3.5 | `add-fraud-detection-analytics`                    | ⬜     |
| 3.6 | `add-mobile-app` (React Native)                    | ⬜     |

---

## Frontend (`apps/web`)

বর্তমানে শুধু `create-next-app` default boilerplate — কোনো real page/feature নেই।
**সিদ্ধান্ত (2026-07-25):** Phase 1 সম্পূর্ণ না হওয়া পর্যন্ত frontend শুরু হবে না।

## কীভাবে এই ফাইল ব্যবহার হবে

- প্রতিটা module brainstorming → writing-plans → subagent-driven-development চক্রে যাবে (প্রক্রিয়ার বিস্তারিত কোনো নির্দিষ্ট module brainstorm শুরুর সময়)।
- একটা module merge হলেই এই ফাইলে তার status ✅-তে বদলাতে হবে এবং পরের 🚧 ঠিক করতে হবে — conversation-only side roadmap আর বানানো যাবে না।
