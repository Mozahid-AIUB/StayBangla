import { SearchForm } from "./search-form";

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      {/*
        Placeholder backdrop. Curated photography lands in a later step; a
        gradient beats a broken-image icon in the meantime, and keeping the
        scrim in place now means the contrast work does not have to be redone
        when the photograph arrives.
      */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[linear-gradient(140deg,#0b4b2f_0%,#10643f_38%,#0f5b73_100%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[var(--hero-scrim)]"
      />

      <div className="mx-auto w-full max-w-5xl px-4 pt-20 pb-12 sm:px-6 sm:pt-28 sm:pb-16">
        <p className="text-sm font-medium tracking-wide text-white/80 sm:text-base">
          বাংলাদেশ ঘুরে দেখুন
        </p>
        <h1 className="mt-3 text-3xl leading-tight font-bold text-white sm:text-5xl">
          যেখানে বিদেশি সাইট পৌঁছায় না
        </h1>
        <p className="mt-4 max-w-2xl text-base text-white/90 sm:text-lg">
          সেন্ট মার্টিনের প্রবাল থেকে সাজেকের মেঘ, সুন্দরবনের বাঘ থেকে
          শ্রীমঙ্গলের চা-বাগান — ১৬টি জেলার হোটেল আর গাড়ি এক জায়গায়।
        </p>

        <div className="mt-8 sm:mt-10">
          <SearchForm />
        </div>
      </div>
    </section>
  );
}
