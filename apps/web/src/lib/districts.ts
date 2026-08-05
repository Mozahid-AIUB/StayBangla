import { District } from "@staybangla/shared-types";

export interface DistrictInfo {
  /** Bengali name, as a Bangladeshi traveller would say it. */
  name: string;
  /** One line on why you would go. Kept short — these are cards, not copy. */
  blurb: string;
}

/**
 * Typed as Record<District, …> on purpose: adding a district to the enum
 * server-side then fails `pnpm typecheck` here rather than silently rendering
 * one card fewer. The enum is the source of truth; this file must follow it.
 */
export const DISTRICTS: Record<District, DistrictInfo> = {
  [District.COXS_BAZAR]: {
    name: "কক্সবাজার",
    blurb: "বিশ্বের দীর্ঘতম সমুদ্রসৈকত",
  },
  [District.SAINT_MARTIN]: {
    name: "সেন্ট মার্টিন",
    blurb: "দেশের একমাত্র প্রবাল দ্বীপ",
  },
  [District.RANGAMATI]: {
    name: "রাঙামাটি",
    blurb: "কাপ্তাই হ্রদ আর সাজেকের মেঘ",
  },
  [District.BANDARBAN]: {
    name: "বান্দরবান",
    blurb: "নীলগিরি, নাফাখুম, পাহাড়ি পথ",
  },
  [District.KHAGRACHARI]: {
    name: "খাগড়াছড়ি",
    blurb: "আলুটিলা গুহা আর ঝরনার দেশ",
  },
  [District.SREEMANGAL]: {
    name: "শ্রীমঙ্গল",
    blurb: "চায়ের রাজধানী, সবুজ বাগান",
  },
  [District.SUNDARBANS]: {
    name: "সুন্দরবন",
    blurb: "রয়েল বেঙ্গল টাইগারের বাড়ি",
  },
  [District.SYLHET]: {
    name: "সিলেট",
    blurb: "জাফলং, রাতারগুল, হাওরের জল",
  },
  [District.CHATTOGRAM]: {
    name: "চট্টগ্রাম",
    blurb: "পাহাড় আর সমুদ্রের বন্দরনগরী",
  },
  [District.DHAKA]: {
    name: "ঢাকা",
    blurb: "চারশো বছরের রাজধানী",
  },
  [District.KHULNA]: {
    name: "খুলনা",
    blurb: "সুন্দরবনের প্রবেশদ্বার",
  },
  [District.BARISHAL]: {
    name: "বরিশাল",
    blurb: "নদীর শহর, ভাসমান পেয়ারা বাজার",
  },
  [District.RAJSHAHI]: {
    name: "রাজশাহী",
    blurb: "আম, রেশম আর পুঠিয়ার মন্দির",
  },
  [District.RANGPUR]: {
    name: "রংপুর",
    blurb: "তাজহাট জমিদারবাড়ি",
  },
  [District.MYMENSINGH]: {
    name: "ময়মনসিংহ",
    blurb: "ব্রহ্মপুত্রের পাড়, গারো পাহাড়",
  },
  [District.JESSORE]: {
    name: "যশোর",
    blurb: "ফুলের রাজ্য গদখালী",
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
