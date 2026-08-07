"use client";

import { useEffect, useState } from "react";
import {
  HOUSE_ADS,
  isExternalHref,
  safeAdHref,
  type AdCreative,
} from "@/lib/ads";
import { COPY, t } from "@/lib/copy";
import { useInViewport } from "@/lib/in-viewport";
import { useLang } from "@/lib/lang-context";
import { useHeavyMediaAllowed } from "@/lib/media-connection";
import { usePrefersReducedMotion } from "@/lib/motion";

/** How long each creative holds. Long enough to read a headline and a line. */
const SLIDE_MS = 6000;

/** How long the track takes to slide. */
const TRANSITION_MS = 700;

/**
 * The active creative's video, mounted only while it is on screen.
 *
 * Not preloaded across all slides: an ad video is the least important thing on
 * the page, and putting several megabytes of it in flight on first paint would
 * cost the visitor their connection for something they did not ask to see.
 */
function AdVideo({ src, poster }: { src: string; poster?: string }) {
  const [ready, setReady] = useState(false);
  const { ref, element, inView } = useInViewport<HTMLVideoElement>("250px");

  // An advertisement decoding while it is off screen spends the visitor's
  // battery and the browser's frame budget on something nobody is looking at —
  // and, once impressions are billed, on something nobody can be charged for
  // either.
  useEffect(() => {
    if (!element) return;
    // Muted playback is never blocked by autoplay policy, but the promise still
    // rejects if the element is torn down mid-call.
    if (inView) void element.play().catch(() => {});
    else element.pause();
  }, [element, inView]);

  return (
    <video
      ref={ref}
      // Decorative: the creative's meaning is in its text, which is real DOM
      // above this. A screen reader announcing a silent loop is only noise.
      aria-hidden
      muted
      loop
      playsInline
      poster={poster}
      src={src}
      onLoadedData={() => setReady(true)}
      onPlaying={() => setReady(true)}
      className="absolute inset-0 h-full w-full object-cover"
      style={{ opacity: ready ? 1 : 0, transition: "opacity 700ms ease-out" }}
    />
  );
}

function AdSlide({ ad, active }: { ad: AdCreative; active: boolean }) {
  const { lang } = useLang();
  const videoAllowed = useHeavyMediaAllowed();
  const href = ad.href ? safeAdHref(ad.href) : null;

  return (
    <div
      className="relative h-full w-full shrink-0 overflow-hidden text-white"
      style={{ backgroundImage: ad.tone }}
    >
      {ad.image && (
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${ad.image})` }}
        />
      )}
      {active && videoAllowed && ad.video && (
        <AdVideo src={ad.video} poster={ad.image} />
      )}
      {/* Weighted from the left, where the copy sits, so the creative's own
          imagery stays visible on the right. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(100deg,rgb(7_10_22/0.72)_0%,rgb(7_10_22/0.5)_45%,rgb(7_10_22/0.2)_100%)]"
      />

      <div className="relative flex h-full flex-col justify-center p-5 sm:p-8">
        <div className="flex items-center gap-2 text-[0.6875rem]">
          <span className="rounded-full border border-white/35 px-2 py-0.5 text-white/85">
            {t(COPY.ads.sponsored, lang)}
          </span>
          <span className="text-white/60">{t(ad.advertiser, lang)}</span>
        </div>

        <h3 className="font-display mt-3 max-w-md text-xl leading-snug font-light sm:text-3xl">
          {t(ad.headline, lang)}
        </h3>
        <p className="mt-2 line-clamp-3 max-w-md text-sm text-white/80 sm:line-clamp-2 sm:text-base">
          {t(ad.body, lang)}
        </p>

        <div className="mt-5">
          {href ? (
            <a
              href={href}
              // rel is not optional on a link somebody else supplied: without
              // noopener the destination gets a handle on this window and can
              // navigate it somewhere of its choosing after the click, and
              // without noreferrer it learns exactly which page sent them.
              {...(isExternalHref(href)
                ? { target: "_blank", rel: "noopener noreferrer nofollow" }
                : {})}
              className="inline-flex rounded-lg bg-white/95 px-4 py-2 text-sm font-medium text-[#26355c] transition-colors hover:bg-white"
            >
              {t(ad.cta, lang)}
            </a>
          ) : (
            // No destination yet. Disabled is honest in a way that a link to a
            // 404 is not, and it matches how the header treats the same
            // unbuilt routes.
            <button
              type="button"
              disabled
              className="inline-flex cursor-not-allowed rounded-lg border border-white/35 bg-black/20 px-4 py-2 text-sm font-medium text-white/90"
            >
              {t(ad.cta, lang)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The landing page's promotional slot.
 *
 * Sits between the district grid and the reasons-to-book section on purpose.
 * Above it, next to the search form, it would compete with the one action the
 * page exists to produce; down in the footer nobody would see it, which is the
 * same as not selling it.
 *
 * One clock, not two. The slide advances when the progress bar's animation
 * ends rather than on a parallel setTimeout — two timers running the same
 * schedule drift apart the moment anything pauses one of them, and the visible
 * one would then be lying about when the panel is going to move.
 */
export function AdPanel({ ads = HOUSE_ADS }: { ads?: readonly AdCreative[] }) {
  const { lang } = useLang();
  const [index, setIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);
  const reducedMotion = usePrefersReducedMotion();
  const { ref: panelRef, inView: onScreen } = useInViewport<HTMLElement>();

  useEffect(() => {
    const sync = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  // Reduced motion switches auto-advance off entirely rather than speeding it
  // up or slowing it down. WCAG 2.2.2 also requires a way to stop anything
  // that moves for more than five seconds, which is the button below.
  const autoAdvances = ads.length > 1 && !reducedMotion;

  // Hidden tabs and a panel scrolled out of view stop the clock too. Otherwise
  // it burns through every creative while nobody is looking, which wastes the
  // reader's attention and — once impressions are billed — charges an
  // advertiser for slides that were never on screen. It also keeps an
  // animation off the compositor while the visitor is scrolling past.
  const running =
    autoAdvances && !userPaused && !interacting && tabVisible && onScreen;

  if (ads.length === 0) return null;

  const advance = () => setIndex((i) => (i + 1) % ads.length);

  return (
    <section
      ref={panelRef}
      className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24"
      aria-roledescription="carousel"
      aria-label={t(COPY.ads.carousel, lang)}
      // Pausing on hover and on focus is what makes the panel readable: text
      // that slides away mid-sentence is text nobody finishes, and a keyboard
      // user tabbing to a link inside a slide must not have it leave.
      onMouseEnter={() => setInteracting(true)}
      onMouseLeave={() => setInteracting(false)}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={() => setInteracting(false)}
    >
      <h2 className="text-muted-foreground mb-3 text-sm">
        {t(COPY.ads.heading, lang)}
      </h2>

      {/* Fixed height, not content height. An ad slot that sizes to whatever
          creative loaded shifts everything below it as the panel rotates and
          again when a video swaps in — the layout jump Core Web Vitals
          measures and readers feel as the page moving under their thumb. */}
      <div className="relative h-[19rem] overflow-hidden rounded-2xl sm:h-[15rem]">
        <div
          className="flex h-full"
          style={{
            transform: `translateX(-${index * 100}%)`,
            transition: reducedMotion
              ? "none"
              : `transform ${TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
          }}
        >
          {ads.map((ad, i) => (
            <div
              key={ad.id}
              role="group"
              aria-roledescription="slide"
              aria-label={t(COPY.ads.slideOf, lang)
                .replace("{n}", String(i + 1))
                .replace("{total}", String(ads.length))}
              aria-hidden={i !== index}
              // inert as well as aria-hidden: without it the links inside the
              // off-screen slides stay in the tab order, and a keyboard user
              // tabs into a slide they cannot see.
              inert={i !== index}
              className="h-full w-full shrink-0"
            >
              <AdSlide ad={ad} active={i === index} />
            </div>
          ))}
        </div>

        {/* Controls sit over the panel rather than under it so they cannot be
            mistaken for part of the creative. */}
        {ads.length > 1 && (
          <div className="absolute right-4 bottom-4 flex items-center gap-3 sm:right-6 sm:bottom-5">
            <div className="flex items-center gap-1.5">
              {ads.map((ad, i) => (
                <button
                  key={ad.id}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={t(COPY.ads.goToSlide, lang).replace(
                    "{n}",
                    String(i + 1),
                  )}
                  aria-current={i === index}
                  // The hit area is 24px even though the dot is 6px — a 6px
                  // target is unusable on a phone.
                  className="grid h-6 w-6 place-items-center"
                >
                  <span
                    className={`block h-1.5 rounded-full transition-all ${
                      i === index ? "w-5 bg-white" : "w-1.5 bg-white/50"
                    }`}
                  />
                </button>
              ))}
            </div>

            {autoAdvances && (
              <button
                type="button"
                onClick={() => setUserPaused((p) => !p)}
                aria-label={t(
                  userPaused ? COPY.ads.play : COPY.ads.pause,
                  lang,
                )}
                className="grid h-8 w-8 place-items-center rounded-full border border-white/35 bg-black/35 text-white transition-colors hover:bg-black/50"
              >
                <svg
                  viewBox="0 0 16 16"
                  aria-hidden
                  className="h-3.5 w-3.5 fill-current"
                >
                  {userPaused ? (
                    <path d="M5 3.5v9l8-4.5-8-4.5Z" />
                  ) : (
                    <path d="M4.5 3h2.5v10H4.5V3Zm4.5 0h2.5v10H9V3Z" />
                  )}
                </svg>
              </button>
            )}
          </div>
        )}

        {/* The clock. Advancing on animationend keeps the bar and the slide on
            the same schedule by construction — pause the animation and the
            panel is paused, because there is nothing else counting. */}
        {autoAdvances && (
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-0.5 bg-white/15"
          >
            <span
              // Remounts on every slide, which is what restarts the animation.
              key={index}
              className="block h-full w-full origin-left bg-white/70"
              style={{
                animation: `ad-progress ${SLIDE_MS}ms linear`,
                animationPlayState: running ? "running" : "paused",
              }}
              onAnimationEnd={advance}
            />
          </div>
        )}
      </div>
    </section>
  );
}
