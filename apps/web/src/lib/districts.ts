import { District } from "@staybangla/shared-types";

export interface DistrictInfo {
  /** Both languages: the site defaults to English but most of the audience
   *  reads Bengali, so neither is a fallback for the other. */
  name: { en: string; bn: string };
  /** One line on why you would go. Kept short — these are cards, not copy. */
  blurb: { en: string; bn: string };
}

/**
 * Typed as Record<District, …> on purpose: adding a district to the enum
 * server-side then fails `pnpm typecheck` here rather than silently rendering
 * one card fewer. The enum is the source of truth; this file must follow it.
 */
export const DISTRICTS: Record<District, DistrictInfo> = {
  [District.COXS_BAZAR]: {
    name: { en: "Cox's Bazar", bn: "কক্সবাজার" },
    blurb: {
      en: "The world's longest beach",
      bn: "বিশ্বের দীর্ঘতম সমুদ্রসৈকত",
    },
  },
  [District.SAINT_MARTIN]: {
    name: { en: "Saint Martin", bn: "সেন্ট মার্টিন" },
    blurb: { en: "The only coral island", bn: "দেশের একমাত্র প্রবাল দ্বীপ" },
  },
  [District.RANGAMATI]: {
    name: { en: "Rangamati", bn: "রাঙামাটি" },
    blurb: {
      en: "Kaptai lake, Sajek cloud",
      bn: "কাপ্তাই হ্রদ আর সাজেকের মেঘ",
    },
  },
  [District.BANDARBAN]: {
    name: { en: "Bandarban", bn: "বান্দরবান" },
    blurb: {
      en: "Nilgiri, Nafakhum, hill roads",
      bn: "নীলগিরি, নাফাখুম, পাহাড়ি পথ",
    },
  },
  [District.KHAGRACHARI]: {
    name: { en: "Khagrachari", bn: "খাগড়াছড়ি" },
    blurb: { en: "Caves and waterfalls", bn: "আলুটিলা গুহা আর ঝরনার দেশ" },
  },
  [District.SREEMANGAL]: {
    name: { en: "Sreemangal", bn: "শ্রীমঙ্গল" },
    blurb: {
      en: "Tea country, green terraces",
      bn: "চায়ের রাজধানী, সবুজ বাগান",
    },
  },
  [District.SUNDARBANS]: {
    name: { en: "Sundarbans", bn: "সুন্দরবন" },
    blurb: {
      en: "Home of the Royal Bengal tiger",
      bn: "রয়েল বেঙ্গল টাইগারের বাড়ি",
    },
  },
  [District.SYLHET]: {
    name: { en: "Sylhet", bn: "সিলেট" },
    blurb: {
      en: "Jaflong, Ratargul, haor water",
      bn: "জাফলং, রাতারগুল, হাওরের জল",
    },
  },
  [District.CHATTOGRAM]: {
    name: { en: "Chattogram", bn: "চট্টগ্রাম" },
    blurb: {
      en: "Port city of hills and sea",
      bn: "পাহাড় আর সমুদ্রের বন্দরনগরী",
    },
  },
  [District.DHAKA]: {
    name: { en: "Dhaka", bn: "ঢাকা" },
    blurb: { en: "Four centuries a capital", bn: "চারশো বছরের রাজধানী" },
  },
  [District.KHULNA]: {
    name: { en: "Khulna", bn: "খুলনা" },
    blurb: { en: "Gateway to the Sundarbans", bn: "সুন্দরবনের প্রবেশদ্বার" },
  },
  [District.BARISHAL]: {
    name: { en: "Barishal", bn: "বরিশাল" },
    blurb: {
      en: "River city, floating guava market",
      bn: "নদীর শহর, ভাসমান পেয়ারা বাজার",
    },
  },
  [District.RAJSHAHI]: {
    name: { en: "Rajshahi", bn: "রাজশাহী" },
    blurb: {
      en: "Mangoes, silk, Puthia temples",
      bn: "আম, রেশম আর পুঠিয়ার মন্দির",
    },
  },
  [District.RANGPUR]: {
    name: { en: "Rangpur", bn: "রংপুর" },
    blurb: { en: "Tajhat palace", bn: "তাজহাট জমিদারবাড়ি" },
  },
  [District.MYMENSINGH]: {
    name: { en: "Mymensingh", bn: "ময়মনসিংহ" },
    blurb: {
      en: "Brahmaputra bank, Garo hills",
      bn: "ব্রহ্মপুত্রের পাড়, গারো পাহাড়",
    },
  },
  [District.JESSORE]: {
    name: { en: "Jessore", bn: "যশোর" },
    blurb: { en: "Godkhali, kingdom of flowers", bn: "ফুলের রাজ্য গদখালী" },
  },
};

/**
 * Display order for the landing grid: the destinations a traveller actually
 * comes here for first, cities after. Deliberately hand-ordered rather than
 * enum order, which is arbitrary.
 *
 * The `satisfies` clause is what makes an omission a build error: the tuple
 * must contain every District, so adding one to the enum without ordering it
 * here fails `pnpm typecheck` instead of silently dropping a card.
 */
const DISTRICT_ORDER = [
  District.COXS_BAZAR,
  District.SAINT_MARTIN,
  District.RANGAMATI,
  District.BANDARBAN,
  District.SREEMANGAL,
  District.SUNDARBANS,
  District.SYLHET,
  District.KHAGRACHARI,
  District.CHATTOGRAM,
  District.DHAKA,
  District.KHULNA,
  District.BARISHAL,
  District.RAJSHAHI,
  District.RANGPUR,
  District.MYMENSINGH,
  District.JESSORE,
] as const;

// Every District must appear above. Omit one and this line stops compiling.
type _AllDistrictsOrdered = District extends (typeof DISTRICT_ORDER)[number]
  ? true
  : never;
const _districtOrderIsComplete: _AllDistrictsOrdered = true;
void _districtOrderIsComplete;

export const FEATURED_DISTRICT_ORDER: readonly District[] = DISTRICT_ORDER;
