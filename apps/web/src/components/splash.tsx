"use client";

import { useEffect, useState } from "react";

const SEEN_KEY = "staybangla:splash-seen";

/**
 * How long the wordmark takes to spin in from depth and settle. The photograph
 * sharpens from blur over the same window, so the two land together.
 */
const ARRIVE_MS = 1100;

/** When the Bengali tagline fades in — after the wordmark has settled. */
const TAGLINE_DELAY_MS = 900;

/**
 * Total time before the curtains move — arrival, then a beat to read both
 * lines and let the light pass across the wordmark.
 *
 * At the original 450ms nobody could see the image at all, which defeated the
 * point of having one. 2.3s gives the four layered movements room to read as
 * one composed moment rather than a pile-up, without becoming a toll booth.
 */
const HOLD_MS = 2300;

/** How long the curtains take to part. Matches the CSS duration below. */
const PART_MS = 700;

/**
 * Hard ceiling on the whole thing — hold plus part, 3s total. If anything
 * stalls (slow image, busy main thread) the splash leaves anyway. On
 * Bangladeshi mobile networks a stuck overlay is the difference between a visit
 * and a bounce, so this ceiling is not optional.
 */
const MAX_VISIBLE_MS = HOLD_MS + PART_MS;

/**
 * Runs before first paint, inlined in <head> by SplashGate below.
 *
 * This is the whole reason the splash does not flash the page first: React
 * cannot help here. Any React-driven overlay necessarily paints *after* the
 * server HTML, so the visitor sees the hero, then the splash covering it, then
 * the hero again. Deciding in a blocking head script means the overlay is
 * already opaque in the very first frame.
 *
 * Sets data-splash="on" on <html>, which the CSS below keys off. Anyone with
 * prefers-reduced-motion never gets the attribute, and in production neither
 * does a returning visitor — for them the overlay is never painted at all.
 *
 * In development it replays on every reload, so the animation can be iterated
 * on without clearing sessionStorage or opening a private window each time.
 */
const GATE_SCRIPT = `(function(){try{
if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
${
  process.env.NODE_ENV === "production"
    ? `if(sessionStorage.getItem('${SEEN_KEY}')==='1')return;
sessionStorage.setItem('${SEEN_KEY}','1');`
    : `/* dev: replay on every reload so the animation can be worked on without
     clearing storage or opening a private window. NODE_ENV is inlined at
     build time, so this branch does not exist in a production bundle. */`
}
document.documentElement.setAttribute('data-splash','on');
}catch(e){}})();`;

/**
 * Renders the blocking gate script plus the overlay's initial CSS.
 *
 * Must be rendered inside <head>. The style block sits here rather than in
 * globals.css so the two stay together — the script sets the attribute, the CSS
 * reacts to it, and splitting them across files invites one being changed
 * without the other.
 */
export function SplashGate() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: GATE_SCRIPT }} />
      <style
        dangerouslySetInnerHTML={{
          __html: `
:root[data-splash="on"] #splash-overlay{opacity:1}
#splash-overlay{opacity:0}
/* The page sits back slightly while the splash is up, then eases forward as
   the curtains part — so it reads as stepping into the scene rather than a
   panel sliding off a static page. The attribute is removed when the splash
   retires, which is what triggers the settle.

   Applied to a wrapper inside <body>, never to <body> itself: a transform on
   an ancestor makes it the containing block for position:fixed descendants,
   which would break the fixed overlay and anything else fixed on the page.

   The scaled-down shell is narrower than the viewport, so the page background
   shows in the gap around it — a pale seam on the way in. Painting <html>
   dark for the duration hides it; the seam is only visible while the
   attribute is set, and this reverts the moment it is removed. */
/* A small lift rather than a scale-down.

   Scaling made the shell narrower and shorter than the viewport, so the page
   background showed in the gap around it — a pale seam along the edges for the
   duration of the settle. Painting the root dark hid it at the sides but not
   at the bottom, where the shell's own edge was still visible against the
   next section.

   translateY keeps the shell full-size, but the direction matters: offsetting
   it *down* leaves a strip of bare body along the bottom edge for the duration
   of the settle, which is visible as a seam right where the hero photograph
   meets the next section. Offsetting it *up* puts that strip at the top
   instead, where the splash overlay is still covering it. */
:root[data-splash="on"] #page-shell{transform:translate3d(0,-14px,0)}
#page-shell{transform:translate3d(0,0,0);transition:transform 900ms cubic-bezier(0.22,1,0.36,1)}
@media (prefers-reduced-motion: reduce){#page-shell{transform:none;transition:none}}
`,
        }}
      />
    </>
  );
}

/**
 * arriving — first frame: photograph blurred, wordmark small, rotated and far
 * settled  — wordmark has spun forward and stopped; photograph is sharp
 * parting  — curtains sliding apart
 * gone     — unmounted
 */
type Phase = "arriving" | "settled" | "parting" | "gone";

/**
 * The overlay itself: a full-bleed image that parts left and right like
 * curtains to reveal the hero already rendered beneath it.
 *
 * It is painted from the first frame (see SplashGate) and then animated away by
 * React once hydration lands. The page underneath is fully server-rendered the
 * whole time — crawlers and no-JS visitors are never gated, they simply see an
 * overlay that never animates, which is why the CSS defaults it to opacity 0
 * unless the gate script explicitly turned it on.
 */
export function Splash() {
  // "holding" on both server and client, so hydration matches. Whether the
  // overlay is actually visible is decided by the gate script's attribute via
  // CSS, not by this state — a returning visitor renders the same markup at
  // opacity 0 and never sees it.
  const [phase, setPhase] = useState<Phase>("arriving");

  useEffect(() => {
    // Returning visitor or reduced motion: the gate never set the attribute,
    // so retire the markup immediately. Queued as a microtask rather than
    // called straight from the effect body, which React 19 flags as a
    // cascading render.
    if (document.documentElement.getAttribute("data-splash") !== "on") {
      queueMicrotask(() => setPhase("gone"));
      return;
    }

    // One frame in "arriving" so the browser paints the start of the
    // transition (blurred, rotated, distant) before the target values are
    // applied — otherwise there is nothing to animate from and the wordmark
    // simply appears in place.
    const arriveFrame = window.requestAnimationFrame(() => setPhase("settled"));
    const partTimer = window.setTimeout(() => setPhase("parting"), HOLD_MS);
    const doneTimer = window.setTimeout(() => setPhase("gone"), MAX_VISIBLE_MS);

    return () => {
      window.cancelAnimationFrame(arriveFrame);
      window.clearTimeout(partTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  // Any interaction skips it, including mid-part.
  useEffect(() => {
    if (phase === "gone") return;

    const dismiss = () => setPhase("gone");
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) =>
      window.addEventListener(e, dismiss, { once: true, passive: true }),
    );
    return () => events.forEach((e) => window.removeEventListener(e, dismiss));
  }, [phase]);

  // Clear the attribute once done so a client-side navigation cannot repaint
  // the overlay at full opacity before this component's effect runs again.
  useEffect(() => {
    if (phase === "gone") {
      document.documentElement.removeAttribute("data-splash");
    }
  }, [phase]);

  if (phase === "gone") return null;

  const arriving = phase === "arriving";
  const parting = phase === "parting";

  return (
    <div
      id="splash-overlay"
      // aria-hidden: decoration. A screen reader should be reading the real
      // page underneath, not announcing a transition.
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      {[
        { side: "left" as const, shift: parting ? "-100%" : "0%" },
        { side: "right" as const, shift: parting ? "100%" : "0%" },
      ].map(({ side, shift }) => (
        <div
          key={side}
          // Exactly half, and the halves carry *only* the photograph — no
          // scrim, no tint. Anything semi-transparent inside a half paints
          // twice wherever the two halves meet or overlap, and that doubled
          // row is itself the seam: a 1px overlap of two 0.45 washes reads as
          // 0.70, a dark line straight down the middle. The scrim now lives
          // above both halves as a single full-width layer, so there is one
          // wash everywhere and nothing to double up.
          className="absolute inset-y-0 w-1/2 overflow-hidden will-change-transform"
          style={{
            [side]: 0,
            transform: `translate3d(${shift}, 0, 0)`,
            // Compositor-only: transform and opacity, nothing that triggers
            // layout. Mid-range Android is the target, not a desktop GPU.
            transition: `transform ${PART_MS}ms cubic-bezier(0.65, 0, 0.35, 1)`,
          }}
        >
          {/*
            Two layers, both a full viewport wide and offset to this half's
            edge so the pair reads as one continuous photograph rather than two
            tiles. w-screen rather than w-[200%]: 200% of a half that landed on
            a fractional pixel is a *doubled* error, so the two halves of the
            picture drift out of register with each other.

            Behind: the same image blown up and blurred, filling the letterbox
            that `contain` leaves on a wide screen. Without it those bands would
            be flat gradient, which reads as a rendering fault rather than a
            deliberate frame.
          */}
          <div
            className="absolute inset-y-0 w-screen scale-110 bg-cover bg-center blur-2xl"
            style={{
              [side]: 0,
              backgroundImage: "url(/images/splash/splash.webp)",
            }}
          />
          {/*
            Front: the whole photograph, uncropped. `contain` rather than
            `cover` because the image is 4:3 and the viewport is wider — cover
            would slice off the sky and the valley floor, which is most of what
            makes this picture worth showing.
          */}
          {/*
            Ken Burns on the outer element, the photograph on the inner one.
            Two nodes because the arrival blur and the drift are independent —
            putting an animation and a transition on the same transform means
            whichever runs last silently wins.
          */}
          <div
            className="splash-drift absolute inset-y-0 w-screen"
            style={{
              [side]: 0,
              animation: `splash-drift ${MAX_VISIBLE_MS + 400}ms linear forwards`,
            }}
          >
            <div
              className="absolute inset-0 bg-contain bg-center bg-no-repeat"
              style={{
                backgroundImage: "url(/images/splash/splash.webp)",
                // Sharpens as the wordmark arrives — the scene coming into
                // focus, like eyes adjusting.
                filter: arriving ? "blur(18px)" : "blur(0px)",
                transition: `filter ${ARRIVE_MS}ms ease-out`,
              }}
            />
          </div>
        </div>
      ))}

      {/*
        Darkens the photograph so the white wordmark stays legible.

        One full-width layer over both halves rather than one inside each. A
        per-half scrim paints twice at the join — every seam this splash has
        shown came from something semi-transparent being drawn once per half.

        It fades rather than parting with the curtains: a scrim that slid away
        would expose the un-dimmed photograph for the 700ms the halves are
        still on screen, which reads as the image flashing brighter just as it
        leaves.

        Its own value rather than --hero-scrim: the hero's wash was lowered to
        0.22 so the photograph reads properly behind body copy, but the splash
        puts a large white wordmark straight over the image and needs more
        cover than that.
      */}
      <div
        className="absolute inset-0 bg-[rgb(10_14_30/0.45)]"
        style={{
          opacity: parting ? 0 : 1,
          transition: `opacity ${PART_MS}ms ease-out`,
        }}
      />

      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          // 3D depth: the wordmark starts far back and rotated, then spins
          // forward into place. Without perspective the rotation reads as a
          // flat squash rather than something travelling towards you.
          perspective: "900px",
          opacity: parting ? 0 : 1,
          transition: "opacity 400ms ease-out",
        }}
      >
        <span
          className="flex flex-col items-center will-change-transform"
          style={{
            transform: arriving
              ? "translateZ(-620px) rotateY(-95deg) scale(0.6)"
              : "translateZ(0) rotateY(0deg) scale(1)",
            opacity: arriving ? 0 : 1,
            // Overshoots slightly past the resting position before settling,
            // which is what makes it feel like it arrives rather than fades.
            transition: `transform ${ARRIVE_MS}ms cubic-bezier(0.18, 0.9, 0.24, 1.08), opacity ${Math.round(ARRIVE_MS * 0.5)}ms ease-out`,
          }}
        >
          <span
            className="splash-sheen font-display bg-clip-text text-4xl font-light tracking-[0.06em] text-white sm:text-6xl"
            style={{
              // A single pass of light across the letters. The gradient is
              // painted onto the text itself and swept once — no extra
              // element, nothing to clean up.
              backgroundImage:
                "linear-gradient(105deg, transparent 35%, rgb(255 245 214 / 0.95) 50%, transparent 65%)",
              backgroundSize: "250% 100%",
              backgroundRepeat: "no-repeat",
              animation: arriving
                ? "none"
                : `splash-sheen 1400ms ease-in-out ${ARRIVE_MS}ms 1 both`,
              textShadow: "0 2px 24px rgb(0 0 0 / 0.45)",
            }}
          >
            StayBangla
          </span>
          {/*
            The Bengali line is the point of the brand, not decoration — it
            arrives a beat later so the two read in sequence rather than
            competing for the same instant.
          */}
          <span
            className="font-display mt-3 text-sm font-extralight tracking-[0.14em] text-white/80 sm:mt-4 sm:text-lg"
            style={{
              opacity: arriving ? 0 : 1,
              transform: arriving ? "translateY(8px)" : "translateY(0)",
              transition: `opacity 600ms ease-out ${TAGLINE_DELAY_MS}ms, transform 600ms ease-out ${TAGLINE_DELAY_MS}ms`,
              textShadow: "0 1px 16px rgb(0 0 0 / 0.5)",
            }}
          >
            বাংলাদেশ ঘুরে দেখুন
          </span>
        </span>
      </div>
    </div>
  );
}
