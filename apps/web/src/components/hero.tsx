"use client";

import { District } from "@staybangla/shared-types";
import { DISTRICTS } from "@/lib/districts";
import { COPY, t } from "@/lib/copy";
import { useLang } from "@/lib/lang-context";
import { HeroVideo } from "./hero-video";
import { SearchForm } from "./search-form";

/**
 * Names come from DISTRICTS rather than being typed here, so a spelling fix
 * lands in one place and a district removed from the enum breaks the build
 * instead of leaving a chip that leads nowhere.
 */
const POPULAR = [
  District.COXS_BAZAR,
  District.RANGAMATI,
  District.SUNDARBANS,
  District.SREEMANGAL,
] as const;

export function Hero() {
  const { lang } = useLang();

  return (
    // No `overflow-hidden`: the probe showed the seam sits exactly on the
    // section's fractional bottom edge (676.80px) with no element and no
    // background colour there — it is the clip itself. Clipping at a
    // fractional pixel makes the browser paint a row of partially-transparent
    // pixels, and that row reads as a hairline. The backdrop below is masked
    // instead, so there is no hard cut to alias.
    <section className="relative isolate">
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
        // Bleeds a little past every edge, most of all the bottom. Two reasons:
        // fractional viewport heights round to whole pixels and can leave a
        // hairline of whatever is underneath, and the page shell is offset by
        // 14px during the splash settle — without the overhang that offset
        // exposes a strip of bare body right where the photograph ends.
        className="absolute -top-px -right-px -bottom-4 -left-px -z-10 overflow-hidden bg-[linear-gradient(140deg,#0b4b2f_0%,#10643f_38%,#0f5b73_100%)]"
        style={{
          // Feathers the bottom edge instead of cutting it. A hard clip at a
          // fractional pixel height leaves a row of partially-transparent
          // pixels that reads as a hairline; a mask has no edge to alias.
          maskImage:
            "linear-gradient(to bottom, black 0%, black calc(100% - 40px), transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 0%, black calc(100% - 40px), transparent 100%)",
        }}
      >
        <div
          className="hero-drift absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url(/images/splash/splash.webp)" }}
        />
        {/*
          Fades in over the photograph on fast connections only, and only once
          buffered. Sits inside the same clipped container so it inherits the
          scrims below rather than needing its own.
        */}
        <HeroVideo />
      </div>
      {/*
        Two scrims, not one: a flat wash for overall legibility, plus a
        top-weighted gradient so the eyebrow and headline stay readable
        against a bright sky without muddying the picture lower down.
      */}
      <div
        aria-hidden
        className="absolute -top-px -right-px -bottom-4 -left-px -z-10 bg-[var(--hero-scrim)]"
        style={{
          maskImage:
            "linear-gradient(to bottom, black 0%, black calc(100% - 40px), transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 0%, black calc(100% - 40px), transparent 100%)",
        }}
      />
      <div
        aria-hidden
        // Weighted to the top third, where the eyebrow and headline sit, and
        // near-clear through the middle so the photograph is actually visible.
        // The previous stop values held 0.5 at the bottom too, which combined
        // with the flat wash to leave the whole image looking muddy.
        className="absolute -top-px -right-px -bottom-4 -left-px -z-10 bg-[linear-gradient(180deg,rgb(6_26_18/0.62)_0%,rgb(6_26_18/0.12)_55%,rgb(6_26_18/0.25)_100%)]"
        style={{
          maskImage:
            "linear-gradient(to bottom, black 0%, black calc(100% - 40px), transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 0%, black calc(100% - 40px), transparent 100%)",
        }}
      />

      {/*
        Tall enough for the photograph to be a place rather than a banner
        strip, but capped so the search form is never pushed below the fold on
        a short laptop screen.
      */}
      <div className="mx-auto flex min-h-[78svh] w-full max-w-5xl flex-col justify-center px-4 pt-28 pb-14 sm:px-6 sm:pt-32 sm:pb-20">
        {/*
          Two lines, not three. The old eyebrow said "See Bangladesh" above a
          headline that said much the same thing, and the paragraph beneath
          listed four destinations the grid already shows — three stacked
          messages competing for the same glance.
        */}
        <h1 className="font-display max-w-3xl text-4xl leading-[1.15] font-light tracking-[0.01em] text-white sm:text-6xl">
          {t(COPY.hero.headline, lang)}
        </h1>
        <p className="mt-5 max-w-xl text-base text-white/85 sm:text-lg">
          {t(COPY.hero.sub, lang)}
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
          <span className="text-xs text-white/70 sm:text-sm">
            {t(COPY.hero.popular, lang)}:
          </span>
          {POPULAR.map((district) => (
            <span
              key={district}
              className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs text-white/90 backdrop-blur-sm sm:text-sm"
            >
              {t(DISTRICTS[district].name, lang)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
