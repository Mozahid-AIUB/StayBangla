import type { Metadata } from "next";
import { Fraunces, Hind_Siliguri, Noto_Serif_Bengali } from "next/font/google";
import { Splash, SplashGate } from "@/components/splash";
import { LangProvider } from "@/lib/lang-context";
import "./globals.css";

/**
 * Body copy, both scripts, one family.
 *
 * Hind Siliguri carries Bengali and Latin in a single design, which is the
 * whole reason it is here. The stack it replaces led with Noto Sans Bengali and
 * listed Geist behind it — but Noto Sans Bengali ships a Latin subset too, so
 * being first it answered for every Latin character as well and Geist never
 * rendered one. It downloaded on every page load and was never seen. Verified
 * against the served stylesheet, which carries three Noto Sans Bengali faces:
 * latin, latin-ext and bengali.
 *
 * Beyond the wasted bytes, that arrangement meant an English sentence and a
 * Bengali one were set in the same face by accident rather than by choice.
 * Here it is the choice.
 */
const hindSiliguri = Hind_Siliguri({
  variable: "--font-body",
  subsets: ["bengali", "latin"],
  // Not a variable font, so every weight here is its own file in every subset.
  // 300 was dropped after checking what the pages actually use: the only
  // weight-300 text outside the display face was three plus signs in the rides
  // section, and one glyph does not justify a Bengali and a Latin file.
  weight: ["400", "500", "600"],
  display: "swap",
});

/**
 * Display face for Latin — the splash wordmark and page headings.
 *
 * Noto is engineered to have no opinion: the name is short for "no tofu", and
 * its job is that text never breaks in any script on earth. That makes it the
 * right fallback and the wrong brand voice, which is what it was being used as.
 *
 * Fraunces instead, and deliberately not Playfair Display — the high-contrast
 * didone is the reflex "elegant serif" and it is on every other travel page.
 * Fraunces is a soft serif with actual warmth in the curves, which suits
 * photography of hills in fog better than something austere.
 *
 * `opsz` is requested because only weight ships by default. With the axis
 * present the browser picks a finer drawing at headline sizes on its own — no
 * extra CSS, and the alternative is a face drawn for body copy blown up to
 * 60px, which is where serifs look clumsy.
 */
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

/**
 * Display face for Bengali, standing behind Fraunces in the same stack.
 *
 * Fraunces has no Bengali glyphs — almost no Latin display face does — so the
 * browser falls through to this one for anything in the Bengali block. That
 * fall-through *is* the bilingual pairing: one class, one rule, and the
 * language toggle never lands on a system fallback.
 *
 * Latin dropped from `subsets`. That option controls which subsets get a
 * preload tag, not which @font-face rules are emitted — the Latin rules are
 * still in the stylesheet, and checking the served CSS after this change is
 * what corrected an earlier note here that claimed otherwise. They simply
 * never resolve: Fraunces stands in front of this face for every Latin
 * codepoint, so the browser has no reason to fetch them and no reason to
 * preload them either.
 *
 * Light weights only. At 600+ the Bengali conjuncts thicken into a slab, which
 * is the opposite of the composed feel the headings are going for.
 */
const notoSerifBengali = Noto_Serif_Bengali({
  variable: "--font-display-bengali",
  subsets: ["bengali"],
  weight: ["200", "300", "400"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "StayBangla — stays and rides across Bangladesh",
  description:
    "Book hotels and vehicles in sixteen districts, from Saint Martin to Sajek, Sundarbans to Sreemangal. Pay in taka.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // The splash gate sets data-splash on <html> before React hydrates, so
      // the server markup and the live DOM legitimately differ by that one
      // attribute. This is exactly the case suppressHydrationWarning exists
      // for; without it React reports a mismatch and the dev overlay draws a
      // marker across the page.
      suppressHydrationWarning
      className={`${hindSiliguri.variable} ${fraunces.variable} ${notoSerifBengali.variable} h-full antialiased`}
    >
      <body className="bg-background text-foreground flex min-h-full flex-col">
        {/*
          First thing in the body, before any content: a blocking script that
          decides whether this visitor gets the splash, plus the CSS that keeps
          the overlay opaque from the very first frame.

          This has to run before paint. React cannot do it — a React-driven
          overlay necessarily paints after the server HTML, so the visitor sees
          the page, then the splash covering it, then the page again. That
          flash is exactly what this replaces.
        */}
        <SplashGate />
        {/*
          Children before the overlay: the real page is the document's content
          and the splash sits on top of it. Nothing here gates what a crawler
          or a no-JS visitor sees.

          The shell wrapper exists so the splash's settle transform has
          something to scale that is NOT an ancestor of the overlay — a
          transform creates a containing block for position:fixed descendants,
          so scaling <body> would trap the fixed overlay inside it.
        */}
        {/*
          bg-background is deliberate: while the shell is offset during the
          splash settle it would otherwise leave a strip of bare <html> showing
          below its bottom edge, which reads as a stray pale line.
        */}
        <div
          id="page-shell"
          className="bg-background flex min-h-full flex-1 flex-col"
        >
          <LangProvider>{children}</LangProvider>
        </div>
        <Splash />
      </body>
    </html>
  );
}
