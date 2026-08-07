"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { COPY, t } from "@/lib/copy";
import { useLang } from "@/lib/lang-context";

/**
 * Site header. Transparent over the hero photograph, then solid once the page
 * scrolls — the pattern every booking site uses, because a bar with its own
 * background sitting on top of a full-bleed image wastes the image.
 *
 * Sticky rather than fixed: fixed would need matching top padding on the hero
 * to avoid overlapping it, and that padding then has to be maintained in two
 * places.
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const { lang, setLang } = useLang();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const link = scrolled
    ? "text-muted-foreground hover:text-foreground"
    : "text-white/85 hover:text-white";

  return (
    <header
      // Sticky with a negative margin, not fixed.
      //
      // Sticky alone reserved its own row in the flow, so the bar sat in a
      // white strip *above* the hero rather than over the photograph, and its
      // white text was invisible against it. Fixed would solve that but
      // #page-shell carries a transform during the splash settle, and a
      // transformed ancestor becomes the containing block for fixed children —
      // the bar would be trapped and move with the page.
      //
      // The negative margin pulls the hero up under the bar; sticky then keeps
      // it pinned on scroll without ever leaving the flow.
      // No backdrop-blur. A blurred backdrop has to be re-read and re-filtered
      // across the full width of the bar on every frame the page scrolls, and
      // it was doing that underneath a background already 95% opaque — paying
      // the whole cost for an effect nobody could see. The extra two percent
      // below is what closes the visual difference.
      className={`sticky top-0 z-40 -mb-16 transition-colors duration-300 sm:-mb-18 ${
        scrolled
          ? "border-border bg-background/97 border-b"
          : "border-b border-transparent"
      }`}
    >
      <nav
        aria-label={lang === "bn" ? "প্রধান" : "Main"}
        className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:h-18 sm:px-6"
      >
        {/* Link, not <a>: a plain anchor to a route forces a full document
            reload and throws away the client cache. The in-page anchors below
            stay as <a> because they are fragments, not navigations. */}
        <Link
          href="/"
          className={`font-display text-xl font-light tracking-[0.04em] transition-colors sm:text-2xl ${
            scrolled ? "text-foreground" : "text-white"
          }`}
        >
          StayBangla
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          <a
            href="#districts"
            className={`hidden rounded-lg px-3 py-2 text-sm transition-colors sm:block ${link}`}
          >
            {t(COPY.nav.destinations, lang)}
          </a>
          <a
            href="#why"
            className={`hidden rounded-lg px-3 py-2 text-sm transition-colors sm:block ${link}`}
          >
            {t(COPY.nav.why, lang)}
          </a>

          {/*
            Two labelled buttons rather than one toggle: a single control has to
            either show the current language or the one you would switch to, and
            whichever it shows, half of visitors read it the other way.
          */}
          <div
            className={`mr-1 ml-1 flex items-center overflow-hidden rounded-lg border text-xs ${
              scrolled ? "border-border" : "border-white/30"
            }`}
          >
            {(["en", "bn"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                aria-pressed={lang === code}
                className={`px-2.5 py-1.5 transition-colors ${
                  lang === code
                    ? scrolled
                      ? "bg-primary text-on-primary"
                      : // Literal rather than text-primary: this pill sits on a
                        // white chip over the photograph, where the token would
                        // resolve against the wrong surface in a future theme.
                        "bg-white/90 text-[#26355c]"
                    : scrolled
                      ? "text-muted-foreground hover:text-foreground"
                      : "text-white/80 hover:text-white"
                }`}
              >
                {code === "en" ? "EN" : "বাং"}
              </button>
            ))}
          </div>

          {/*
            Both inert until auth and the vendor flow exist. Kept visible
            because a header without them reads as unfinished, and disabled is
            honest in a way that a link to nowhere is not.
          */}
          <button
            type="button"
            disabled
            className={`hidden rounded-lg px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed sm:block ${link}`}
          >
            {t(COPY.nav.signIn, lang)}
          </button>
          <button
            type="button"
            disabled
            className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
              scrolled
                ? "bg-primary text-on-primary"
                : "border border-white/35 bg-black/20 text-white"
            }`}
          >
            {t(COPY.nav.listProperty, lang)}
          </button>
        </div>
      </nav>
    </header>
  );
}
