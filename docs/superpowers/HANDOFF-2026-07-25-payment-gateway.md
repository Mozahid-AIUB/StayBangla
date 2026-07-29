# Handoff — resume `add-payment-gateway-integration` here

> লেখা হয়েছে: 2026-07-25। ব্যবহারকারী পরীক্ষার কারণে ৪-৫ দিন বিরতি নিচ্ছেন।
> এই ফাইলটা পড়ে, নতুন session-এ, একদম যেখানে ছেড়েছিলাম সেখান থেকে চালিয়ে
> যাওয়ার জন্য যথেষ্ট তথ্য এখানে আছে — brief/report ফাইলগুলো git-ignored
> স্ক্র্যাচ (`.superpowers/sdd/`), তাই ওগুলোর ওপর নির্ভর না করে এই একটা
> committed ফাইল থেকেই পুরো ছবি বোঝা যাবে।

## এক লাইনে অবস্থা

Branch `feat/payment-gateway-integration` GitHub-এ push করা আছে (PR এখনো
খোলা হয়নি)। 12-টাস্কের plan-এর মধ্যে **Task 1-4 সম্পূর্ণ ও review-approved,
commit করা আছে। Task 5 থেকে বাকি।** কোনো uncommitted change নেই — working
tree clean ছিল break নেওয়ার সময়।

## নতুন session-এ প্রথমে যা করতে হবে

```bash
cd d:/Way_To_Job/StayBangla
git status                      # clean থাকার কথা
git branch --show-current        # feat/payment-gateway-integration হওয়ার কথা
git log --oneline -6             # নিচের commit hash-গুলোর সাথে মিলিয়ে দেখো
```

যদি branch/commit না মেলে (কেউ অন্য কিছু করেছে), থেমে user-কে জিজ্ঞেস করো —
নিচের সব তথ্য এই ৫টা commit-এর ওপর ভিত্তি করে লেখা:

```
21eb7a1 feat(api): add SslcommerzPaymentProviderService, wire as the real PaymentProviderPort
5f15cea feat(api): replace PaymentProviderPort.charge with createSession/validateTransaction
8a55254 feat(api): add SSLCOMMERZ_*/FRONTEND_URL env vars
c95b714 feat(api): add PaymentStatus/LedgerEntry schema for payment gateway integration
a50fa46 docs: add implementation plan for add-payment-gateway-integration (#24)
```

তারপর `.superpowers/sdd/progress.md` পড়ো (git-ignored, কিন্তু এই মেশিনে এখনো
আছে) — Task 1-4-এর বিস্তারিত review-notes সেখানে আছে। **যদি ওই ফাইল না
থাকে** (নতুন মেশিন, বা কেউ `.superpowers/` মুছে ফেলেছে), নিচের "Task 1-4
সংক্ষিপ্ত সারাংশ" সেকশনই যথেষ্ট — নতুন করে ওই টাস্কগুলো re-verify করার দরকার
নেই, কমিটগুলো itself প্রমাণ।

## ⚠️ জরুরি সতর্কতা: `.superpowers/sdd/` ফোল্ডার সম্পর্কে

এই ফোল্ডারটা **git-ignored** (`.superpowers/sdd/.gitignore` নিজেই সব বাদ
দেয়, শুধু `progress.md`-ও আসলে বাদ — যাচাই করে দেখেছি
`git check-ignore` দিয়ে)। এখানে এই প্রজেক্টের **সব মডিউলের** (rate-limiting,
room-listing, ইত্যাদি — সব আগেই merged) leftover `task-N-brief.md`/
`task-N-report.md`/`review-*.diff` ফাইল একসাথে পড়ে আছে, কারণ
`subagent-driven-development` স্কিলের script সবসময় `task-N-brief.md` নামেই
লেখে, প্ল্যান যেটাই হোক।

**এর মানে:** `task-5-brief.md` নামের ফাইলটা এখন যেটা আছে সেটা payment-gateway
প্ল্যানেরই সঠিক Task 5 (আমি নিজে just এখন রিজেনারেট করে confirm করেছি) —
কিন্তু এই সেশন শুরুর দিকে ওই একই ফাইলনামে **rate-limiting মডিউলের পুরনো Task 5
রিপোর্ট** পড়ে ছিল ভুলবশত (আরেকটা তুলনীয় ঘটনা: `task-4-report.md`ও একবার stale
rate-limiting রিপোর্ট বহন করছিল)। **তাই এখন থেকে যেকোনো `task-N-brief.md`
পড়ার আগে অবশ্যই আগে রিজেনারেট করে নাও:**

```bash
SKILL_DIR="/c/Users/MOZAHID/.claude/plugins/cache/claude-plugins-official/superpowers/6.1.1/skills/subagent-driven-development"
"$SKILL_DIR/scripts/task-brief" docs/superpowers/plans/2026-07-25-payment-gateway-integration.md <N>
```

এটা ফাইলটা ওভাররাইট করে সঠিক কন্টেন্ট দিয়ে লিখে দেয় — cache-এ থাকা পুরনো
কন্টেন্ট নিয়ে confuse হওয়ার ঝুঁকি থাকে না যদি প্রতিবার আগে এই কমান্ড চালানো
হয়।

## এই session-এ কী workflow অনুসরণ করা হয়েছে (পুরো প্রজেক্টের standard)

প্রতিটা ROADMAP module এই চক্রে যায়:

```
1. brainstorming (superpowers:brainstorming স্কিল, এক এক প্রশ্ন) → design doc
2. design doc-এর adversarial review (Opus/সবচেয়ে capable model দিয়ে independent
   subagent — "real-world/enterprise-grade জাস্টিফাই করো" ধরনের প্রশ্ন)
3. design doc self-review + commit + PR + CI ("verify" check) pass + merge
4. writing-plans স্কিল দিয়ে implementation plan লেখা (docs/superpowers/plans/)
5. plan-এর নিজস্ব self-review, commit + PR + CI + merge
6. subagent-driven-development স্কিল দিয়ে টাস্ক-বাই-টাস্ক বাস্তবায়ন:
   প্রতিটা টাস্কে: implementer subagent dispatch → task-reviewer subagent
   dispatch (spec-compliance + code-quality, দুটো verdict) → দরকার হলে fix
   subagent → আবার review → clean হলে পরের টাস্ক
7. সব টাস্ক শেষে: সবচেয়ে capable model দিয়ে পুরো-branch final review
8. commit + PR + CI ("verify") + merge
9. ROADMAP.md আপডেট (মডিউল ✅, পরের মডিউল 🚧 next)
10. পরের মডিউল brainstorm শুরু — আলাদা permission লাগে না (এইটা user-এর
    স্ট্যান্ডিং instruction)
```

**গুরুত্বপূর্ণ constraint যা সবসময় মানতে হবে:**

- **কোনো hardcoded value না** — সব env-variable বা database-driven হতে হবে।
- প্রতিটা কাজের আগে দরকারি skill load করা (Skill tool)।
- সবসময় TodoWrite দিয়ে progress track করা।
- ROADMAP.md + অন্য docs সবসময় আপডেট রাখা।
- Branch protection: `main`-এ direct push হয় না, PR + passing `verify`
  CI check লাগে (`[[memory: project_branch_protection]]`)।
- বাংলা লিপিতে সবসময় কথা বলা (user-এর স্থায়ী preference)।

## Subagent dispatch করার কমান্ড-প্যাটার্ন (হুবহু যেভাবে করা হয়েছে)

```bash
SKILL_DIR="/c/Users/MOZAHID/.claude/plugins/cache/claude-plugins-official/superpowers/6.1.1/skills/subagent-driven-development"

# ধাপ ১: brief বের করো (N = task number, প্ল্যান ফাইলের নিচে যে ক্রমে আছে)
"$SKILL_DIR/scripts/task-brief" docs/superpowers/plans/2026-07-25-payment-gateway-integration.md <N>
# → লেখে .superpowers/sdd/task-<N>-brief.md, path প্রিন্ট করে

# ধাপ ২: base commit রেকর্ড করো (dispatch করার ঠিক আগে), তারপর Agent tool দিয়ে
# implementer dispatch করো — prompt-এ brief-path + report-path (task-<N>-report.md)
# + scene-setting context দাও, পুরো প্ল্যান ফাইল পড়তে বলো না।
# Model selection: মেকানিক্যাল/সম্পূর্ণ-কোড-দেওয়া টাস্ক হলে "haiku", ইন্টিগ্রেশন/
# জাজমেন্ট লাগলে "sonnet" (default), আর্কিটেকচার-লেভেল হলে সবচেয়ে capable model।

# ধাপ ৩: implementer শেষ হলে (DONE status), review package বানাও
"$SKILL_DIR/scripts/review-package" <base-commit> <head-commit>
# → লেখে .superpowers/sdd/review-<base>..<head>.diff, path প্রিন্ট করে

# ধাপ ৪: Agent tool দিয়ে task-reviewer dispatch করো — brief path + report path +
# review-diff path দাও, দুটো verdict চাও (spec compliance + code quality)।
# পূর্ব-বিচার করে দিও না ("do not flag X" জাতীয় কিছু prompt-এ লিখো না)।

# ধাপ ৫: reviewer-এর ⚠️/Important finding নিজে (controller হিসেবে) resolve করো
# যেগুলো diff-only view থেকে বোঝা যায় না (যেমন .env gitignore false-positive)।

# ধাপ ৬: clean হলে .superpowers/sdd/progress.md-এ এক লাইন যোগ করো, TodoWrite
# আপডেট করো, পরের টাস্কে যাও।
```

সব টাস্ক শেষে (Task 12): সবচেয়ে capable model দিয়ে পুরো-branch final review
(`scripts/review-package <merge-base> HEAD`), তারপর PR খোলা, CI pass
নিশ্চিত করা (`gh pr checks --watch`), merge, ROADMAP.md আপডেট।

## Task 1-4 সংক্ষিপ্ত সারাংশ (সম্পূর্ণ, review-approved, আর ছোঁয়ার দরকার নেই)

**Task 1 — Prisma schema** (`c95b714`): `PaymentStatus`
(PENDING/PAID/FAILED), `LedgerEntryType`
(GROSS_PAYMENT/PLATFORM_FEE/VENDOR_OWED) enum; `User.commissionRatePercent`
(Int, default 10); `Booking.paymentStatus/gatewayTranId(unique)/
gatewayValId/vendorOwedMinor` + নতুন `LedgerEntry` টেবিল। Migration
non-interactive `prisma migrate dev` refuse করায় `prisma migrate diff` +
manual migration folder + `prisma migrate deploy` দিয়ে resolve করা হয়েছে
(এই টেকনিক ভবিষ্যতেও লাগতে পারে — নিচে "কারিগরি নোট" দেখো)।

**Task 2 — Env vars** (`8a55254`): `SSLCOMMERZ_STORE_ID`,
`SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_SANDBOX` (boolean,
`z.enum(["true","false"]).transform(...)` প্যাটার্ন — `z.coerce.boolean()`
ব্যবহার করলে না বলেও `"false"` string true হয়ে যায়, এই বাগ আগেও একবার
`MINIO_USE_SSL`-এ হয়েছিল), `FRONTEND_URL`।

**Task 3 — PaymentProviderPort নতুন interface** (`5f15cea`): পুরনো একমাত্র
`charge()` মেথড সরিয়ে `createSession(bookingId, amountMinor, currency):
Promise<PaymentSession>` এবং `validateTransaction(valId):
Promise<ValidationResult>` — এটাই আসল SSLCommerz redirect+webhook ফ্লো-র
সাথে সঙ্গতিপূর্ণ শেপ। `StubPaymentProviderService` (টেস্টের জন্য) নতুন শেপে
আপডেট হয়েছে।

**Task 4 — SslcommerzPaymentProviderService** (`21eb7a1`): real
implementation — `createSession` SSLCommerz-এর session-init API কল করে
(`fetch`), amount minor→major unit কনভার্সন (`toFixed(2)`); `validateTransaction`
Order Validation API কল করে, কখনো throw করে না (network/non-VALID দুটোতেই
`valid:false` রিটার্ন — IPN handler/reconciliation job crash না করার জন্য
ইচ্ছাকৃত সেফ ডিফল্ট)। `payments.module.ts` এখন এটাকেই real
`PaymentProviderPort` হিসেবে wire করে (stub শুধু ইউনিট টেস্টে সরাসরি
কনস্ট্রাক্ট হয়)।

- ছোট, non-blocking নোট (reviewer থেকে): `createSession`-এর customer fields
  (`cus_name`/`cus_email`/`cus_phone`) এখন placeholder string — brief-এর
  নিজের কোড অনুযায়ীই, তাই Task 4-এর defect না, কিন্তু production traffic-এর
  আগে real booking/user data দিয়ে replace করা উচিত হবে — এটা কোনো ভবিষ্যৎ
  টাস্কে (সম্ভবত Task 6, যেখানে `BookingsService` booking/user রেকর্ড থেকে
  ডেটা পাবে) মনে রাখতে হবে।

## এরপর যা বাকি (Task 5-12, প্ল্যান ফাইল:

docs/superpowers/plans/2026-07-25-payment-gateway-integration.md)

- **Task 5**: `bookings.types.ts`-এ `paymentStatus: string` field যোগ
  (ছোট, মেকানিক্যাল — brief রিজেনারেট করা আছে, উপরের সতর্কতা দেখো)।
- **Task 6**: `BookingsService` — `initiatePayment`, `confirmIfValid`,
  cancel policy পরিবর্তন (HELD=trivial refund, CONFIRMED=no-refund-with-
  `acknowledgeNoRefund`-gate), পুরনো `confirmPayment` মুছে ফেলা। এখানেই
  `bookings.service.spec.ts`/`bookings.controller.spec.ts`-এর বর্তমান
  failing টেস্ট (পুরনো `.charge()` রেফারেন্স) ঠিক হবে — Task 3/4 থেকে
  জানা expected failure।
- **Task 7**: `BookingsController` — নতুন রুট, `confirm-payment` রুট মুছে
  ফেলা।
- **Task 8**: `PaymentsController` — public IPN webhook
  (`POST /payments/sslcommerz/ipn`), `confirmIfValid` কল করে।
- **Task 9**: Reconciliation job (BullMQ repeatable, প্রতি ২ মিনিটে, ১ মিনিট
  grace period) — এই টাস্কেই `PaymentProviderPort`-এ retroactively
  `queryByTranId()` মেথড ও `ValidationResult`-এ `valId` field যোগ হবে
  (Task 3/4/6-এর interface-এর ৩য় amendment, প্ল্যানেই আগে থেকে documented)।
- **Task 10**: Admin commission-rate endpoint (`User.commissionRatePercent`
  আপডেট করার জন্য)।
- **Task 11**: E2e কভারেজ (redirect flow, webhook, reconciliation,
  refund-policy)।
- **Task 12**: পুরো monorepo verification (lint+typecheck+test+build),
  final whole-branch review (সবচেয়ে capable model), PR খোলা, CI green
  নিশ্চিত করা, merge, **ROADMAP.md-এ 1.6 ✅ করা এবং 1.7 (`add-observability`)
  🚧 next করা** — এটাই মডিউলের একদম শেষ ধাপ।

## কারিগরি নোট যা মনে রাখা দরকার (এই সেশনে শেখা)

1. **`prisma migrate dev` non-interactive শেলে কাজ করে না** (Windows
   Git Bash/এই Bash tool-এ, কোনো TTY নেই)। Task 1-এ এটা হয়েছিল এবং সমাধান:

   ```bash
   pnpm --filter @staybangla/api exec prisma migrate diff \
     --from-schema-datasource prisma/schema.prisma \
     --to-schema-datamodel prisma/schema.prisma --script \
     > apps/api/prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql
   pnpm --filter @staybangla/api exec prisma migrate deploy
   ```

   (dev DB আর `staybangla_test` দুটোতেই আলাদা করে `migrate deploy` চালাতে
   হবে — `.env.test` দিয়ে dotenv-cli ব্যবহার করে)। যদি Task 6+ কোনো নতুন
   schema change আনে (সন্দেহ নেই, আনবেই না — schema Task 1-এই শেষ), এই
   একই টেকনিক লাগবে।

2. **Zod env boolean coercion বাগ**: `z.coerce.boolean()` লিটারেল
   `"false"` স্ট্রিং-কেও `true` বানিয়ে ফেলে। সঠিক প্যাটার্ন:
   `z.enum(["true","false"]).transform((v) => v === "true")`।

3. **`.env`/`.env.test` gitignored** — diff-এ এই ফাইল না দেখা মানেই গ্যাপ
   না, এটা confirm করতে `git check-ignore -v` চালিয়ে তারপর ফাইল সরাসরি
   পড়ে verify করতে হয়েছিল (Task 2-এ reviewer-এর false-positive finding)।

4. **Implementer subagent মাঝপথে session-limit-এ পড়তে পারে** (Task 4-এ
   হয়েছিল) — commit ইতিমধ্যে হয়ে গেলে কাজ হারায় না, কিন্তু নিজের report
   ফাইল লিখতে পারে না। এমন হলে: commit hash সরাসরি `git show --stat`
   দিয়ে verify করো, প্রয়োজনীয় টেস্ট নিজে চালাও, তারপর নিজেই (controller
   হিসেবে) report ফাইল লিখে দাও যাতে reviewer subagent-এর কাছে দেওয়ার
   মতো কিছু থাকে।

## Money/payment ডিজাইনের মূল সিদ্ধান্তগুলো (context হারিয়ে গেলে মনে করিয়ে

দেওয়ার জন্য)

- সব টাকা **integer minor-unit** (paisa/poisha) — কখনো float না।
- Commission **per-vendor** (`User.commissionRatePercent`, integer percent,
  default 10), per-listing না।
- `PLATFORM_FEE = floor(total * rate / 100)`, `VENDOR_OWED = total -
PLATFORM_FEE` (বিয়োগ দিয়ে, যাতে exact sum গ্যারান্টি থাকে)।
- টাকা **super admin-এর কাছে আসে**, পরে admin manually vendor-কে পাঠাবে
  (কোনো automated payout না — এটা design-এ explicit decision)।
- Refund policy: **HELD cancel = পুরো refund** (কোনো চার্জই হয়নি), **CONFIRMED
  cancel = কোনো refund না**, `{acknowledgeNoRefund: true}` body flag ছাড়া
  400 error — এটা design doc-এ explicitly "accepted business risk, needs
  revisit soon" হিসেবে লেখা আছে, permanent সিদ্ধান্ত না।
- `confirmIfValid(bookingId, valId)` — **একমাত্র** কোড-পাথ যেটা booking
  HELD→CONFIRMED করতে পারে, IPN webhook আর reconciliation job দুটোই এটাই
  কল করবে (duplicate logic এড়ানোর জন্য)।
- Reconciliation job লাগে কারণ IPN webhook হারিয়ে যেতে পারে (network issue,
  webhook delivery guarantee নেই) — এটা webhook-only approach-এর একটা real
  gap ছিল, adversarial review-তে ধরা পড়েছিল।

## Design/Plan ডকুমেন্ট (সব merged, main-এ আছে)

- `docs/superpowers/specs/2026-07-25-payment-gateway-integration-design.md`
  — পুরো ডিজাইন (adversarially reviewed)।
- `docs/superpowers/plans/2026-07-25-payment-gateway-integration.md` —
  ১২-টাস্কের সম্পূর্ণ কোড-সহ plan (2814 লাইন)। **এটাই Task 5+ implement
  করার একমাত্র সোর্স অফ ট্রুথ।**
- `ROADMAP.md` — item 1.6 এখনো `🚧 next` (মডিউল পুরো শেষ না হওয়া পর্যন্ত এটা
  বদলাবে না — Task 12-এই বদলাবে)।

## নতুন session শুরু করার সবচেয়ে ছোট checklist

1. `git status` + `git log --oneline -6` দিয়ে উপরের commit hash মিলিয়ে
   দেখো।
2. এই ফাইল (`docs/superpowers/HANDOFF-2026-07-25-payment-gateway.md`) পড়ো —
   সেটাই এখন করছ।
3. `.superpowers/sdd/progress.md` থাকলে পড়ো (extra detail, optional)।
4. Task 5-এর brief রিজেনারেট করো (উপরের কমান্ড), পড়ো।
5. TodoWrite দিয়ে Task 5-12-এর তালিকা আবার বসাও (এই ফাইলের "এরপর যা বাকি"
   সেকশনটাই যথেষ্ট রেফারেন্স)।
6. Task 5 dispatch করো — মেকানিক্যাল, ছোট, haiku/cheap tier যথেষ্ট।
7. চালিয়ে যাও Task 6, 7, ... 12 পর্যন্ত, প্রতিটাতে implementer→reviewer
   চক্র মেনে, Task 12-এ ROADMAP.md আপডেট দিয়ে শেষ করো।

এই মডিউল শেষ হলে (Task 12 merge + ROADMAP আপডেটের পর), পরের মডিউল
`add-observability` (1.7) — brainstorming থেকে আবার শুরু, আলাদা অনুমতি
লাগবে না (user-এর standing instruction)।
