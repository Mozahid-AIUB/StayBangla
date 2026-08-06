/**
 * The promotional slot on the landing page.
 *
 * Everything here is shaped for creatives that will eventually arrive from the
 * API — an advertiser uploads, an admin approves, and the approved rows land
 * in this same array. Swapping the constant below for a fetch is the whole
 * migration; nothing else in the component changes.
 */

export interface AdCreative {
  id: string;
  /**
   * Who is paying for the slot. Rendered on the panel, always.
   *
   * An advertisement the reader cannot attribute is not an advertisement, it
   * is the page appearing to recommend something. This field is required for
   * that reason and not because anything technical needs it.
   */
  advertiser: { en: string; bn: string };
  headline: { en: string; bn: string };
  body: { en: string; bn: string };
  cta: { en: string; bn: string };
  /**
   * Where the click goes. Optional while the destination routes do not exist —
   * the CTA renders as a plainly disabled button rather than a link to a 404.
   *
   * Untrusted once real advertisers supply it. Never put this in an href
   * without running it through safeAdHref below.
   */
  href?: string;
  /**
   * Background tone. Required even when an image or video is present, because
   * it is what the panel looks like in the moment before either has loaded and
   * in the case where both fail.
   */
  tone: string;
  /** Optional still. Also the poster for `video`. */
  image?: string;
  /**
   * Optional video. Muted and autoplaying, and only on connections that can
   * afford it — see useHeavyMediaAllowed. Everyone else gets `image`, or the
   * tone.
   */
  video?: string;
}

/**
 * Only http(s) and same-site paths survive.
 *
 * This slot's whole purpose is to render a URL somebody else chose. A
 * `javascript:` href is script execution on our own origin with our own
 * cookies, and `data:` can carry a whole HTML document — both are ordinary
 * text as far as an upload form is concerned, so the check has to live here,
 * at the point of use, rather than only at the point of entry.
 *
 * Returns null when the href is not safe to render, and the caller drops the
 * link rather than rendering a broken one.
 */
export function safeAdHref(href: string): string | null {
  // A single leading slash is a path on this site. Two is protocol-relative —
  // "//evil.example" leaves the site entirely, so it is not internal.
  if (href.startsWith("/") && !href.startsWith("//")) return href;

  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    // Not a URL at all.
    return null;
  }
}

/** Whether a validated href leaves the site, which decides target and rel. */
export function isExternalHref(href: string): boolean {
  return !href.startsWith("/");
}

/**
 * What runs when no paid creative is booked.
 *
 * House ads rather than a blank panel or a demo brand. A blank slot looks
 * broken, and inventing "20% off at <a real hotel chain>" would be putting a
 * commercial claim in a real company's mouth — which is not a placeholder, it
 * is a fabrication that happens to be in a code file.
 *
 * These also happen to be what the slot should genuinely show on a quiet day:
 * unsold inventory selling itself.
 */
export const HOUSE_ADS: readonly AdCreative[] = [
  {
    id: "house-advertise",
    advertiser: { en: "StayBangla", bn: "StayBangla" },
    headline: {
      en: "This space catches people mid-plan",
      bn: "এই জায়গাটা ধরে পরিকল্পনার মাঝখানে",
    },
    body: {
      en: "They have just picked a district and have not booked anything yet. That is the moment your offer is worth something.",
      bn: "তারা সবে জেলা বেছেছে, এখনো কিছু বুক করেনি। ঠিক এই মুহূর্তেই আপনার অফারের দাম সবচেয়ে বেশি।",
    },
    cta: { en: "Advertise here", bn: "বিজ্ঞাপন দিন" },
    tone: "linear-gradient(135deg,#141b33 0%,#26355c 55%,#3a5180 100%)",
  },
  {
    id: "house-property",
    advertiser: { en: "StayBangla", bn: "StayBangla" },
    headline: {
      en: "Sixteen districts, one calendar",
      bn: "ষোলো জেলা, একটাই ক্যালেন্ডার",
    },
    body: {
      en: "Rooms, bookings and payouts in one dashboard — and your listing shown to travellers already looking at your district.",
      bn: "রুম, বুকিং আর টাকা — এক ড্যাশবোর্ডে। আর আপনার হোটেল দেখানো হবে ঠিক সেই লোকদের, যারা আপনার জেলাটাই দেখছে।",
    },
    cta: { en: "List your property", bn: "হোটেল যুক্ত করুন" },
    tone: "linear-gradient(135deg,#12283a 0%,#2b5470 55%,#44768f 100%)",
    // Stands in for a real creative's video so the video path is exercised
    // rather than shipped untried. An advertiser's own file replaces it.
    video: "/videos/hero-2.mp4",
  },
  {
    id: "house-vehicle",
    advertiser: { en: "StayBangla", bn: "StayBangla" },
    headline: {
      en: "The hill roads need someone who knows them",
      bn: "পাহাড়ি পথে চাই এমন কেউ, যে পথটা চেনে",
    },
    body: {
      en: "Jeeps for Sajek, boats for the Sundarbans, cars from Dhaka. Drivers and owners earn on the same bookings as the rooms.",
      bn: "সাজেকের জিপ, সুন্দরবনের নৌকা, ঢাকা থেকে গাড়ি। যে বুকিংয়ে রুম যায়, চালক আর মালিকও সেখান থেকেই আয় করেন।",
    },
    cta: { en: "Drive with us", bn: "গাড়ি যুক্ত করুন" },
    tone: "linear-gradient(135deg,#2e2b26 0%,#4d463d 55%,#655c50 100%)",
  },
];
