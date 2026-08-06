"use client";

import { COPY, t } from "@/lib/copy";
import { useLang } from "@/lib/lang-context";

/**
 * Computed once at module load, not per render. `new Date()` inside a client
 * component is evaluated on the server during SSR and again in the browser,
 * and if those two land either side of midnight on 31 December the markup
 * disagrees and React reports a hydration mismatch.
 */
const YEAR = new Date().getFullYear();

export function SiteFooter() {
  const { lang } = useLang();

  return (
    <footer className="border-border mt-auto border-t">
      <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          <span className="font-display text-foreground text-base font-light">
            StayBangla
          </span>{" "}
          — {t(COPY.footer.tagline, lang)}
        </p>
        <p>© {YEAR} StayBangla</p>
      </div>
    </footer>
  );
}
