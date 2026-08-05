const REASONS = [
  {
    title: "দেশের ভেতরের গন্তব্য",
    body: "সাজেক, সেন্ট মার্টিন, নাফাখুম, রাতারগুল — যেসব জায়গা বিদেশি সাইটে খুঁজে পাওয়া যায় না, সেগুলোই আমাদের মূল জায়গা।",
  },
  {
    title: "হোটেল আর গাড়ি একসাথে",
    body: "থাকার জায়গা আর যাতায়াত আলাদা করে খুঁজতে হবে না। পাহাড়ি পথের জন্য জিপ, নদীপথের জন্য নৌকা — একই জায়গায়।",
  },
  {
    title: "টাকা দিন দেশি উপায়ে",
    body: "বিকাশ, নগদ, রকেট বা কার্ড — বাংলাদেশি গেটওয়ে দিয়ে টাকা দিন, ডলারে হিসাব করতে হবে না।",
  },
];

export function WhyStayBangla() {
  return (
    <section className="bg-surface border-border border-y">
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <h2 className="text-2xl font-bold sm:text-3xl">কেন StayBangla</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-3 sm:gap-8">
          {REASONS.map(({ title, body }) => (
            <div key={title}>
              <div
                aria-hidden
                className="bg-primary mb-3 h-1 w-10 rounded-full"
              />
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="text-muted-foreground mt-2 text-base leading-relaxed">
                {body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
