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
    where: { en: "Where", bn: "কোথায়" },
    anywhere: { en: "Anywhere", bn: "যেকোনো জায়গা" },
    when: { en: "When", bn: "কখন" },
    addDates: { en: "Add dates", bn: "তারিখ দিন" },
    checkIn: { en: "Check in", bn: "যাওয়ার তারিখ" },
    checkOut: { en: "Check out", bn: "ফেরার তারিখ" },
    guests: { en: "Guests", bn: "অতিথি" },
    guest: { en: "guest", bn: "জন" },
    guestsPlural: { en: "guests", bn: "জন" },
    addGuest: { en: "Add a guest", bn: "একজন বাড়ান" },
    removeGuest: { en: "Remove a guest", bn: "একজন কমান" },
    submit: { en: "Search", bn: "খুঁজুন" },
    comingSoon: { en: "Search opens soon", bn: "অনুসন্ধান শীঘ্রই চালু হচ্ছে" },
    formLabel: { en: "Find stays and rides", bn: "হোটেল ও গাড়ি খুঁজুন" },
  },

  calendar: {
    label: { en: "Choose your dates", bn: "তারিখ বেছে নিন" },
    previousMonth: { en: "Previous month", bn: "আগের মাস" },
    nextMonth: { en: "Next month", bn: "পরের মাস" },
    clear: { en: "Clear", bn: "মুছুন" },
    done: { en: "Done", bn: "হয়ে গেছে" },
    /** {n} is replaced with the count. */
    nights: { en: "{n} nights", bn: "{n} রাত" },
    night: { en: "{n} night", bn: "{n} রাত" },
    /**
     * Full names for the calendar's own heading. COPY.season.months is the
     * abbreviated set and stays that way — a season bar has a card's width to
     * work in, a month heading has the whole panel.
     */
    monthNames: [
      { en: "January", bn: "জানুয়ারি" },
      { en: "February", bn: "ফেব্রুয়ারি" },
      { en: "March", bn: "মার্চ" },
      { en: "April", bn: "এপ্রিল" },
      { en: "May", bn: "মে" },
      { en: "June", bn: "জুন" },
      { en: "July", bn: "জুলাই" },
      { en: "August", bn: "আগস্ট" },
      { en: "September", bn: "সেপ্টেম্বর" },
      { en: "October", bn: "অক্টোবর" },
      { en: "November", bn: "নভেম্বর" },
      { en: "December", bn: "ডিসেম্বর" },
    ],
    /** Sunday first, matching how a calendar is printed in Bangladesh. */
    weekdays: [
      { en: "Su", bn: "রবি" },
      { en: "Mo", bn: "সোম" },
      { en: "Tu", bn: "মঙ্গল" },
      { en: "We", bn: "বুধ" },
      { en: "Th", bn: "বৃহঃ" },
      { en: "Fr", bn: "শুক্র" },
      { en: "Sa", bn: "শনি" },
    ],
  },

  districts: {
    // "and when" is not a flourish — it names what the section actually
    // carries. Every card answers both halves.
    heading: { en: "Where to, and when", bn: "কোথায়, আর কখন" },
    sub: {
      en: "The season decides more than the place does. Saint Martin has no boats outside winter; Sylhet's swamp forest only exists when the water is high.",
      bn: "জায়গার চেয়ে ঋতুই বেশি ঠিক করে দেয়। শীত ছাড়া সেন্ট মার্টিনে জাহাজ চলে না, আর জল না বাড়লে রাতারগুল বনই নয়।",
    },
    restHeading: { en: "Cities and elsewhere", bn: "শহর আর বাকি সব" },
  },

  season: {
    /** Prefix on each card's season line. */
    best: { en: "Best", bn: "সেরা সময়" },
    yearRound: { en: "Year round", bn: "সারা বছর" },
    /**
     * Short month names, January first — indexed by month number minus one in
     * formatSeason(). Abbreviated because they sit inside a card, not a
     * sentence.
     */
    months: [
      { en: "Jan", bn: "জানু" },
      { en: "Feb", bn: "ফেব্রু" },
      { en: "Mar", bn: "মার্চ" },
      { en: "Apr", bn: "এপ্রিল" },
      { en: "May", bn: "মে" },
      { en: "Jun", bn: "জুন" },
      { en: "Jul", bn: "জুলাই" },
      { en: "Aug", bn: "আগস্ট" },
      { en: "Sep", bn: "সেপ্টে" },
      { en: "Oct", bn: "অক্টো" },
      { en: "Nov", bn: "নভে" },
      { en: "Dec", bn: "ডিসে" },
    ],
  },

  rides: {
    heading: { en: "The hotel is the easy part", bn: "হোটেলটাই সহজ অংশ" },
    sub: {
      en: "Sajek is six hours from Dhaka and the last stretch is not a road a bus takes. Knowing what carries you is half the planning.",
      bn: "ঢাকা থেকে সাজেক ছয় ঘণ্টা — শেষ পথটুকু বাসের রাস্তা নয়। কীসে চড়ে যাবেন, সেটা জানাই অর্ধেক পরিকল্পনা।",
    },
    pairings: [
      {
        stay: {
          en: "A cottage above the cloud line",
          bn: "মেঘের উপরে একটা কটেজ",
        },
        ride: {
          en: "Chander Gari — the jeep that knows the road",
          bn: "চান্দের গাড়ি — যে পথটা চেনে",
        },
      },
      {
        stay: { en: "A cabin on the water", bn: "জলের উপরে একটা কেবিন" },
        ride: {
          en: "A launch, and someone who reads the tide",
          bn: "লঞ্চ, আর যে জোয়ার পড়তে জানে",
        },
      },
      {
        stay: { en: "A room facing the sea", bn: "সমুদ্রমুখী একটা রুম" },
        ride: {
          en: "A car from Dhaka, waiting before dawn",
          bn: "ঢাকা থেকে গাড়ি, ভোরের আগেই অপেক্ষায়",
        },
      },
    ],
    /**
     * Deliberately says "listed", not "booked together".
     *
     * A Booking carries a bookableType of ROOM or VEHICLE and never both, so a
     * room and a jeep are two bookings and two payments. The claim this replaces
     * — "booked alongside the room, not separately" — was on the page and was
     * not true of the product.
     */
    footnote: {
      en: "Both listed here, district by district.",
      bn: "দুটোই আছে — জেলা ধরে ধরে।",
    },
  },

  ads: {
    /**
     * Labelled, not disguised. A promotional panel styled to read as our own
     * editorial is the one version of this that is dishonest, and it is also
     * the version that costs the most trust when someone notices.
     */
    heading: { en: "Partner offers", bn: "অংশীদারদের অফার" },
    sponsored: { en: "Sponsored", bn: "প্রচারিত" },
    pause: { en: "Pause", bn: "থামান" },
    play: { en: "Play", bn: "চালান" },
    carousel: { en: "Partner offers", bn: "অংশীদারদের অফার" },
    /** Screen-reader label for each dot; {n} is replaced with the number. */
    goToSlide: { en: "Offer {n}", bn: "অফার {n}" },
    slideOf: { en: "{n} of {total}", bn: "{total}-এর {n}" },
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
        // Replaces "Stay and ride together — booked alongside the room, not
        // separately", which was two problems in one card. It was untrue: a
        // Booking is ROOM or VEHICLE, never both, so the jeep is its own
        // booking and its own payment. And once the section above exists to
        // make the same point properly, this card was repeating it.
        title: { en: "In your language", bn: "আপনার ভাষায়" },
        body: {
          en: "Every page in Bangla and English — both written, neither one run through a translator.",
          bn: "প্রতিটা পাতা বাংলা আর ইংরেজিতে — দুটোই লেখা, একটা থেকে আরেকটা যন্ত্রে অনুবাদ করা নয়।",
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
    /**
     * The footer opens with this rather than with a column of links.
     *
     * It is the season idea one last time — the thing every district card is
     * built on — said as a parting line instead of drawn as a bar. A footer
     * that starts by listing where else to click has nothing to say; this one
     * finishes the argument the page was making.
     */
    closing: {
      en: "Go while the season is right.",
      bn: "ঋতু ঠিক থাকতে থাকতেই বেরিয়ে পড়ুন।",
    },
    startPlanning: { en: "Start planning", bn: "পরিকল্পনা শুরু করুন" },
    /**
     * One quiet sentence under the partner column, replacing a "Soon" badge
     * beside every item. Four badges advertise what is missing; one line says
     * the same thing once and stops.
     */
    partnersSoon: {
      en: "Partner tools open soon.",
      bn: "অংশীদারদের সুবিধা শীঘ্রই চালু হচ্ছে।",
    },
    blurb: {
      en: "Stays and rides in sixteen districts, booked in taka, from the people who live on those roads.",
      bn: "ষোলো জেলার হোটেল আর গাড়ি — টাকায় বুক করুন, যারা ওই পথে থাকে তাদের কাছ থেকেই।",
    },
    destinations: { en: "Destinations", bn: "গন্তব্য" },
    allDistricts: { en: "All sixteen districts", bn: "ষোলো জেলাই দেখুন" },
    explore: { en: "Explore", bn: "ঘুরে দেখুন" },
    partners: { en: "Partners", bn: "অংশীদার" },
    /**
     * Payment methods, stated because they are what SSLCommerz actually
     * carries. Names only, no logos — a logo needs the brand's permission and
     * a wordmark does not.
     */
    payments: { en: "Pay with", bn: "টাকা দিন" },
    paymentNote: {
      en: "In taka, through a Bangladeshi gateway.",
      bn: "টাকায়, বাংলাদেশি গেটওয়ে দিয়ে।",
    },
    /** Shown against everything that has no page behind it yet. */
    soon: { en: "Soon", bn: "শীঘ্রই" },
    /**
     * Heads the line of districts whose season is running today. Not a slogan —
     * the list underneath is computed from the month, so this has to read as a
     * statement of fact.
     */
    bestNow: { en: "In season right now", bn: "এখন যাওয়ার সময়" },
    rights: { en: "All rights reserved", bn: "সর্বস্বত্ব সংরক্ষিত" },
    madeIn: { en: "Made in Bangladesh", bn: "বাংলাদেশে তৈরি" },
    links: {
      whyUs: { en: "Why StayBangla", bn: "কেন StayBangla" },
      staysAndRides: { en: "Stays and rides", bn: "থাকা আর যাওয়া" },
      listProperty: { en: "List your property", bn: "হোটেল যুক্ত করুন" },
      addVehicle: { en: "Add a vehicle", bn: "গাড়ি যুক্ত করুন" },
      advertise: { en: "Advertise", bn: "বিজ্ঞাপন দিন" },
      partnerLogin: { en: "Partner sign in", bn: "অংশীদার লগইন" },
      help: { en: "Help", bn: "সহায়তা" },
      terms: { en: "Terms", bn: "শর্তাবলি" },
      privacy: { en: "Privacy", bn: "গোপনীয়তা" },
    },
  },
} as const;

/** Picks the active language from a bilingual pair. */
export function t(pair: { en: string; bn: string }, lang: Lang): string {
  return pair[lang];
}
