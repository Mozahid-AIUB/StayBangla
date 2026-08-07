import Link from "next/link";

/**
 * Next's built-in 404 is an unstyled sentence on a white page — a different
 * site to the one the visitor was just on, which reads as broken rather than as
 * a page that does not exist.
 *
 * Server-rendered and deliberately not bilingual: it sits outside LangProvider,
 * and wrapping the whole 404 in a client component to translate two lines would
 * ship the language machinery to the one page that should be as close to
 * nothing as possible.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-2xl flex-col justify-center px-4 py-24 sm:px-6">
      <p className="text-muted-foreground text-sm">404</p>
      <h1 className="font-display mt-4 text-3xl font-light sm:text-5xl">
        This page took a wrong turn
      </h1>
      <p className="text-muted-foreground mt-4 text-base leading-relaxed">
        The address does not lead anywhere on StayBangla. It may have moved, or
        it may never have existed.
      </p>
      <div className="mt-8">
        <Link
          href="/"
          className="bg-primary text-on-primary hover:bg-primary-hover inline-flex rounded-lg px-5 py-3 text-sm font-medium transition-colors"
        >
          Back to the start
        </Link>
      </div>
    </main>
  );
}
