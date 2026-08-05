# StayBangla Marketing Landing Page — Design Spec

**ROADMAP:** 1.11 `add-marketing-landing-page` — the final Phase 1 module, and **the first frontend work on this project**. `apps/web` is currently bare `create-next-app` boilerplate.

**Date:** 2026-08-05

---

## Positioning

StayBangla's advantage is not competing with Booking.com on Dhaka business hotels. It is the sixteen districts in `District` — Saint Martin, Sajek (Rangamati), Sundarbans, Bandarban, Sreemangal, Khagrachari — that international platforms cover thinly or not at all.

The entire design proceeds from that:

> **"বাংলাদেশ ঘুরে দেখুন — যেখানে বিদেশি সাইট পৌঁছায় না"**

Brand character: **Bangladeshi and proud**, not a localised clone of a foreign platform. Bengali script leads. Colours drawn from the landscape (tea-garden green, sea blue) rather than a generic SaaS palette.

## Scope

**In scope:**

- A landing page at `/` whose primary action is searching for a room or vehicle
- A search results page at `/search` wired to the real API
- A first-visit splash transition
- Curated, self-hosted imagery of real Bangladeshi destinations

**Out of scope** (later modules): booking flow, payment UI, vendor dashboard UI, admin UI, authentication screens.

## Primary user action

Search. A visitor arrives, sees somewhere they want to go, and searches for it. Vendor recruitment gets a modest section low on the page — a secondary path, deliberately not competing with the primary one.

## API surface

Both endpoints already exist and are public (no auth):

```
GET /v1/rooms/available?checkIn=&checkOut=&city=
GET /v1/vehicles/available?...
```

`checkIn` and `checkOut` are required (`@IsDateString()`); `city` is optional and validated against the `District` enum. So a district card can link straight into a real search, and an undated browse is not possible — the landing form must collect dates.

**This means the landing page is not static marketing.** It is the entry point to a working search, which is why `/search` is in scope: a search box that goes nowhere would be worse than none.

## Page structure

### Landing (`/`)

```
┌─────────────────────────────────────┐
│  Full-bleed hero image              │
│  "বাংলাদেশ, আপনার মতো করে"          │
│  ┌───────────────────────────────┐  │
│  │ কোথায় │ কবে │ কতজন │ খুঁজুন │  │  ← real search
│  └───────────────────────────────┘  │
├─────────────────────────────────────┤
│  16 district cards, each with image │  ← click = search for that district
├─────────────────────────────────────┤
│  Why StayBangla (3 reasons)         │
├─────────────────────────────────────┤
│  Become a vendor (small, low)       │
└─────────────────────────────────────┘
```

### Search results (`/search`)

Filters on the left, room and vehicle cards on the right. Reads query params from the landing form.

## Splash transition

**Decisions:** a recognisable-beauty photograph (Saint Martin or Sajek), **1 second**, **first visit only**, splitting **left and right like curtains**.

The image parts from the centre to reveal a second photograph of the same location from a different angle, already in place as the hero. The effect is walking through a doorway into the scene, not two unrelated images swapping.

```
   0.0s                    0.7s              1.2s
┌──────────────┐      ┌───┐   ┌───┐    ┌──────────────┐
│  Sajek cloud │  →   │ ← │   │ → │ →  │ Hero + search│
│  (full bleed)│      │   │   │   │    │              │
└──────────────┘      └───┘   └───┘    └──────────────┘
```

**The splash earns its second by hiding real work.** While it plays, the hero image decodes, fonts load, and the search form hydrates. The visitor watches an animation instead of a layout shift.

Required behaviours:

- **First visit only.** Persist a flag; returning visitors go straight to the hero. A daily user must never see it twice.
- **Skippable.** Any click, key, or scroll dismisses it immediately.
- **Self-dismissing on slow connections.** If the image has not loaded within 1.5s, the splash leaves anyway. Never trap a visitor on a blank screen — on Bangladeshi mobile networks this is the difference between a visit and a bounce.
- **Respects `prefers-reduced-motion`.** No splash for visitors who have asked for less animation.
- **Never blocks content for crawlers.** The hero and its copy must be in the server-rendered HTML; the splash is an overlay on top, not a gate in front.
- **Compositor-only animation** (`transform`/`opacity`). No layout-triggering properties — mid-range Android phones are the target, not desktops.

## Imagery

The "unique images" requirement is where projects of this kind usually fail. The plan:

- **Hand-picked, not bulk stock.** A specific photograph chosen per district, showing what that place actually looks like.
- **Self-hosted.** Downloaded into `public/`, never hot-linked. A third party's outage must not blank the site.
- **Optimised before commit.** WebP, multiple widths, served through `next/image` with lazy loading below the fold. The hero and splash images preload; nothing else does.
- **Attributed.** Unsplash's licence permits commercial use and asks for photographer credit — a credits line in the footer.

No AI-generated imagery. A travel platform that shows places which do not exist destroys the trust it needs.

## Frontend risk register

The API work on this project produced 28 defects behind a green test suite. The same classes apply on the frontend, in different clothes:

| Risk                              | Mitigation                                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API down or slow → blank screen   | Loading, empty, and error states designed as first-class, not afterthoughts                                                                                    |
| Asia/Dhaka vs UTC in date pickers | This defect class has already recurred **three times** server-side. Dates sent to the API are calendar days in Dhaka, never `toISOString()` of a local `Date`. |
| Heavy images on mobile networks   | Budget the hero; optimise before commit; measure, don't assume                                                                                                 |
| Broken on phones                  | 80%+ of Bangladeshi traffic is mobile. Mobile layout first, desktop second.                                                                                    |
| Splash traps slow visitors        | The 1.5s self-dismiss above                                                                                                                                    |
| District enum drift               | Districts come from `@staybangla/shared-types`, not a hardcoded list, so adding one server-side surfaces here                                                  |

## Build order

1. **Foundation** — colour tokens, Bengali-capable typography, Tailwind theme
2. **Imagery** — curate, download, optimise, credit
3. **Landing hero** — full-bleed image, headline, search form (inert)
4. **District grid + supporting sections**
5. **`/search`** — results page against the live API, with all three states
6. **Wire the search** — landing form → `/search`, then the splash on top
7. **Verify** — mobile, performance budget, accessibility, Bengali rendering

The splash lands last deliberately: it is the most decorative piece and the easiest to cut if the schedule tightens. The search working end to end is the part that matters.

## Success criteria

- A visitor can search from `/` and see real availability on `/search`
- Every district card leads to a real search for that district
- Works on a mid-range Android phone over a slow connection
- Bengali text renders correctly at every breakpoint
- No layout shift after load; the splash never blocks content
- Lighthouse performance and accessibility both ≥ 90 on mobile
