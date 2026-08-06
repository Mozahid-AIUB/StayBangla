import { District } from "@staybangla/shared-types";
import { DISTRICTS } from "@/lib/districts";
import { SearchForm } from "./search-form";

/**
 * Names come from DISTRICTS rather than being typed here, so a spelling fix
 * lands in one place and a district removed from the enum breaks the build
 * instead of leaving a chip that leads nowhere.
 */
const POPULAR = (
  [
    District.COXS_BAZAR,
    District.RANGAMATI,
    District.SUNDARBANS,
    District.SREEMANGAL,
  ] as const
).map((d) => DISTRICTS[d].name);

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      {/*
        The same photograph the splash used, so the curtains part onto the
        scene the visitor was just looking at rather than cutting to something
        unrelated. The gradient underneath shows through if the image fails.

        Drifting slowly the whole time it is on screen: near-video presence at
        142 KB rather than the several megabytes a real video would cost on a
        Bangladeshi mobile connection. The animation is compositor-only and
        switches off under prefers-reduced-motion.
      */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 overflow-hidden bg-[linear-gradient(140deg,#0b4b2f_0%,#10643f_38%,#0f5b73_100%)]"
      >
        <div
          className="hero-drift absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url(/images/splash/splash.webp)" }}
        />
      </div>
      {/*
        Two scrims, not one: a flat wash for overall legibility, plus a
        top-weighted gradient so the eyebrow and headline stay readable
        against a bright sky without muddying the picture lower down.
      */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[var(--hero-scrim)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgb(6_26_18/0.55)_0%,rgb(6_26_18/0.15)_45%,rgb(6_26_18/0.5)_100%)]"
      />

      {/*
        Tall enough for the photograph to be a place rather than a banner
        strip, but capped so the search form is never pushed below the fold on
        a short laptop screen.
      */}
      <div className="mx-auto flex min-h-[78svh] w-full max-w-5xl flex-col justify-center px-4 pt-24 pb-14 sm:px-6 sm:pt-32 sm:pb-20">
        <p className="text-sm font-medium tracking-wide text-white/80 sm:text-base">
          বাংলাদেশ ঘুরে দেখুন
        </p>
        <h1 className="font-display mt-3 text-3xl leading-tight font-light tracking-[0.01em] text-white sm:text-5xl">
          যেখানে বিদেশি সাইট পৌঁছায় না
        </h1>
        <p className="mt-4 max-w-2xl text-base text-white/90 sm:text-lg">
          সেন্ট মার্টিনের প্রবাল থেকে সাজেকের মেঘ, সুন্দরবনের বাঘ থেকে
          শ্রীমঙ্গলের চা-বাগান — ১৬টি জেলার হোটেল আর গাড়ি এক জায়গায়।
        </p>

        <div className="mt-8 sm:mt-10">
          <SearchForm />
        </div>

        {/*
          Shortcuts into the destinations people actually search for. Inert
          until /search exists — a chip that 404s is worse than one that
          plainly waits. They become links in the same step that wires the
          form, since both need the same route.
        */}
        <div className="mt-5 flex flex-wrap items-center gap-2 sm:mt-6 sm:gap-2.5">
          <span className="text-xs text-white/70 sm:text-sm">জনপ্রিয়:</span>
          {POPULAR.map((name) => (
            <span
              key={name}
              className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs text-white/90 backdrop-blur-sm sm:text-sm"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
