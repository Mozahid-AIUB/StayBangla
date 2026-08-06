import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  Noto_Sans_Bengali,
  Noto_Serif_Bengali,
} from "next/font/google";
import { Splash, SplashGate } from "@/components/splash";
import { LangProvider } from "@/lib/lang-context";
import "./globals.css";

// Bengali leads: most user-facing copy is Bangla, and neither Geist nor any
// Latin-only face carries the Bengali block (U+0980–U+09FF) — without this the
// site renders tofu boxes. Variable font, so no explicit weight is needed.
const notoSansBengali = Noto_Sans_Bengali({
  variable: "--font-bengali",
  subsets: ["bengali", "latin"],
  display: "swap",
});

/**
 * Display face for the splash wordmark and page headings only — body copy
 * stays on the sans above, where a serif at small sizes would cost legibility
 * for no gain.
 *
 * Loaded at light weights: at 600+ the Bengali conjuncts thicken into a slab,
 * which is the opposite of the composed feel the splash is going for.
 */
const notoSerifBengali = Noto_Serif_Bengali({
  variable: "--font-display-serif",
  subsets: ["bengali", "latin"],
  weight: ["200", "300", "400"],
  display: "swap",
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
      className={`${notoSansBengali.variable} ${notoSerifBengali.variable} ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
