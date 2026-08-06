export type Lang = "en" | "bn";

/**
 * Every user-facing string, both languages side by side.
 *
 * One file rather than per-component strings: a copy change is one edit, and a
 * missing translation is a type error rather than a sentence that silently
 * stays in the wrong language.
 *
 * English is the default. Bengali is not a translation bolted on — it is the
 * voice most of the audience actually thinks in, so both were written, not one
 * run through the other.
 */
export const COPY = {
  nav: {
    destinations: { en: "Destinations", bn: "গন্তব্য" },
    why: { en: "Why us", bn: "কেন আমরা" },
    signIn: { en: "Sign in", bn: "লগইন" },
    listProperty: { en: "List your property", bn: "হোটেল যুক্ত করুন" },
  },

  hero: {
    // Deliberately not "where foreign sites don't reach" — that framing talks
    // about a competitor. This one talks to the reader.
    headline: {
      en: "The hills are calling",
      bn: "পাহাড় ডাকছে, সমুদ্র অপেক্ষায়",
    },
    sub: {
      en: "Stays and rides across sixteen districts. One place.",
      bn: "ষোলো জেলার হোটেল আর গাড়ি — এক জায়গায়।",
    },
    popular: { en: "Popular", bn: "জনপ্রিয়" },
  },

  search: {
    where: { en: "Where to", bn: "কোথায় যাবেন" },
    anywhere: { en: "Anywhere", bn: "যেকোনো জায়গা" },
    checkIn: { en: "Check in", bn: "যাওয়ার তারিখ" },
    checkOut: { en: "Check out", bn: "ফেরার তারিখ" },
    guests: { en: "Guests", bn: "অতিথি" },
    submit: { en: "Search", bn: "খুঁজুন" },
    comingSoon: { en: "Search opens soon", bn: "অনুসন্ধান শীঘ্রই চালু হচ্ছে" },
    formLabel: { en: "Find stays and rides", bn: "হোটেল ও গাড়ি খুঁজুন" },
  },

  districts: {
    heading: { en: "Where to?", bn: "কোথায় যাবেন?" },
    sub: {
      en: "Sixteen districts — hills, sea, forest, and city.",
      bn: "ষোলো জেলা — পাহাড়, সমুদ্র, বন আর শহর।",
    },
  },

  why: {
    heading: { en: "Why StayBangla", bn: "কেন StayBangla" },
    reasons: [
      {
        title: { en: "Places others skip", bn: "যেখানে ওরা পৌঁছায় না" },
        body: {
          en: "Sajek, Saint Martin, Nafakhum, Ratargul. The destinations international sites barely list.",
          bn: "সাজেক, সেন্ট মার্টিন, নাফাখুম, রাতারগুল — যেসব জায়গা বিদেশি সাইটে খুঁজে পাওয়া যায় না।",
        },
      },
      {
        title: { en: "Stay and ride together", bn: "হোটেল আর গাড়ি একসাথে" },
        body: {
          en: "A jeep for the hill roads, a boat for the rivers. Booked alongside the room, not separately.",
          bn: "পাহাড়ি পথের জন্য জিপ, নদীপথের জন্য নৌকা — রুমের সাথেই, আলাদা করে নয়।",
        },
      },
      {
        title: { en: "Pay the local way", bn: "টাকা দিন দেশি উপায়ে" },
        body: {
          en: "bKash, Nagad, Rocket, or card. In taka, through a Bangladeshi gateway.",
          bn: "বিকাশ, নগদ, রকেট বা কার্ড — টাকায়, বাংলাদেশি গেটওয়ে দিয়ে।",
        },
      },
    ],
  },

  vendor: {
    heading: {
      en: "Have a property or a vehicle?",
      bn: "আপনার হোটেল বা গাড়ি আছে?",
    },
    body: {
      en: "Reach travellers across the country. Bookings, earnings, and calendar in one dashboard.",
      bn: "সারা দেশের ভ্রমণকারীদের কাছে পৌঁছান। বুকিং, আয় আর ক্যালেন্ডার — এক ড্যাশবোর্ডে।",
    },
    cta: { en: "Coming soon", bn: "শীঘ্রই আসছে" },
  },

  footer: {
    tagline: { en: "See Bangladesh", bn: "বাংলাদেশ ঘুরে দেখুন" },
  },
} as const;

/** Picks the active language from a bilingual pair. */
export function t(pair: { en: string; bn: string }, lang: Lang): string {
  return pair[lang];
}
