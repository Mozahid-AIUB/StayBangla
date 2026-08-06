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
    // pixels, and that row reads as a hairline.
    //
    // The mask that replaced the clip has since been replaced in turn by the
    // dissolve at the foot of this section. A mask fading over 40px did not
    // read as a fade at all — at that distance a photograph dissolving looks
    // like a smudge on the glass. The dissolve solves the hairline the same
    // way for free: its last stop is opaque white and the page beneath it is
    // white, so there is nothing for an alias to reveal.
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
        // Indigo, the same family as --primary. This only shows in the moment
        // before the photograph decodes or if it fails outright, and a green
        // flash from the palette the site no longer uses is a worse first frame
        // than no colour at all.
        className="absolute -top-px -right-px -bottom-4 -left-px -z-10 overflow-hidden bg-[linear-gradient(140deg,#141b33_0%,#26355c_45%,#2f4a70_100%)]"
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
      />
      <div
        aria-hidden
        // Weighted to the top third, where the eyebrow and headline sit, and
        // near-clear through the middle so the photograph is actually visible.
        //
        // The bottom stop used to be 0.2 — the image was being deliberately
        // darkened in the exact band that then had to become white. Dark meeting
        // white is the harshest pair there is, and the grey it passed through on
        // the way was the band showing at the section boundary. It now stays
        // near-clear all the way down and lets the dissolve below do the work.
        className="absolute -top-px -right-px -bottom-4 -left-px -z-10 bg-[linear-gradient(180deg,rgb(10_14_30/0.5)_0%,rgb(10_14_30/0.08)_52%,rgb(10_14_30/0.06)_100%)]"
      />
      {/*
        The dissolve. Last of the backdrop layers, so it sits over both scrims
        rather than under them.

        Not a fade to white — a fade through mist. A dark photograph blended
        straight into #ffffff passes through dead grey, and that grey is what
        reads as a dirty band across the boundary. These stops carry the faintest
        warmth instead, matching --surface rather than sitting a few degrees off
        it, so the picture appears to recede into weather rather than being
        erased.

        Measured in pixels from the bottom rather than in percentages: the hero
        is a viewport-relative height, and a percentage-based dissolve would be
        a different physical distance on every screen — long and lazy on a
        desktop, abrupt on a phone, which is exactly the abruptness being fixed.

        It reaches opaque white 16px before the section ends, which is the
        overhang below. That is deliberate: the layers extend past the section
        so the splash settle cannot expose a strip of bare page, and those last
        16px paint white over white where nobody can see them.
      */}
      <div
        aria-hidden
        className="absolute -top-px -right-px -bottom-4 -left-px -z-10"
        style={{
          backgroundImage: [
            "linear-gradient(to top",
            "#ffffff 0px",
            "rgb(254 253 252 / 0.96) 24px",
            "rgb(250 248 245 / 0.74) 60px",
            "rgb(246 244 241 / 0.42) 98px",
            "rgb(242 239 235 / 0.16) 134px",
            "transparent 172px)",
          ].join(","),
        }}
      />

      {/*
        Tall enough for the photograph to be a place rather than a banner
        strip, but capped so the search form is never pushed below the fold on
        a short laptop screen.

        The bottom padding is much larger than the top, which is what lets the
        dissolve work: the copy sits above centre and the lower stretch is
        photograph and nothing else, so the picture has somewhere to recede
        into. With the copy pushed down near the edge the mist would land on
        the chips and wash the white type off them, and the fade would have to
        be short enough to look like the smudge it replaced.
      */}
      <div className="mx-auto flex min-h-[78svh] w-full max-w-5xl flex-col justify-center px-4 pt-28 pb-32 sm:px-6 sm:pt-32 sm:pb-44">
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
              // A dark translucent pill rather than light glass. The blur that
              // was here had to run four times over a playing video on every
              // scroll frame, and it was doing a job a darker background does
              // for free — white type over black/25 stays legible whatever the
              // clip does behind it, which a blur alone never guaranteed.
              className="rounded-full border border-white/30 bg-black/25 px-3 py-1.5 text-xs text-white/90 sm:text-sm"
            >
              {t(DISTRICTS[district].name, lang)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
