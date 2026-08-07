import { District } from "@staybangla/shared-types";
import { mediaUrl } from "./assets";
import type { Month } from "./season";

/**
 * The landscape a district is, which decides the tone its card is painted in.
 *
 * Not a decorative palette: three hill districts share one tone because they
 * are one landscape, and a visitor scanning the grid should be able to see
 * that without reading a word.
 */
export type Terrain =
  "sea" | "island" | "hill" | "tea" | "forest" | "river" | "city";

export interface DistrictInfo {
  /** Both languages: the site defaults to English but most of the audience
   *  reads Bengali, so neither is a fallback for the other. */
  name: { en: string; bn: string };
  /** One line on why you would go. Kept short — these are cards, not copy. */
  blurb: { en: string; bn: string };
  /**
   * The months the trip is actually worth making.
   *
   * Load-bearing, not a tag. Saint Martin has no ferry outside winter, the
   * Sundarbans in monsoon is a wet boat ride past nothing, and Sylhet's swamp
   * forest is a dry patch of trees until the water rises. Getting this wrong
   * costs a visitor their trip, so each set is the real season rather than a
   * blanket "winter is nice".
   */
  season: readonly Month[];
  terrain: Terrain;
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
      // Not "the world's longest beach" — every listing site says it, so it
      // has stopped meaning anything. The number still does.
      en: "A hundred and twenty kilometres of unbroken sand.",
      bn: "একশো কুড়ি কিলোমিটার অবিচ্ছিন্ন বালি।",
    },
    season: [11, 12, 1, 2, 3],
    terrain: "sea",
  },
  [District.SAINT_MARTIN]: {
    name: { en: "Saint Martin", bn: "সেন্ট মার্টিন" },
    blurb: {
      en: "Coral and clear water. Boats run in winter only.",
      bn: "প্রবাল আর স্বচ্ছ জল। জাহাজ চলে শুধু শীতে।",
    },
    season: [11, 12, 1, 2],
    terrain: "island",
  },
  [District.RANGAMATI]: {
    name: { en: "Rangamati", bn: "রাঙামাটি" },
    blurb: {
      en: "Sajek, where the cloud sits below the road.",
      bn: "সাজেক — মেঘ থাকে রাস্তার নিচে।",
    },
    // Two spells, and both are real: the monsoon is when Sajek is above the
    // cloud, winter is when the lake and the hill roads are at their best.
    season: [7, 8, 9, 11, 12, 1, 2],
    terrain: "hill",
  },
  [District.BANDARBAN]: {
    name: { en: "Bandarban", bn: "বান্দরবান" },
    blurb: {
      en: "Nilgiri at dawn, Nafakhum after the rains.",
      bn: "ভোরের নীলগিরি, বৃষ্টির পরের নাফাখুম।",
    },
    season: [10, 11, 12, 1, 2, 3],
    terrain: "hill",
  },
  [District.KHAGRACHARI]: {
    name: { en: "Khagrachari", bn: "খাগড়াছড়ি" },
    blurb: {
      en: "Alutila cave, walked by torchlight.",
      bn: "আলুটিলা গুহা — মশাল হাতে হেঁটে।",
    },
    season: [10, 11, 12, 1, 2],
    terrain: "hill",
  },
  [District.SREEMANGAL]: {
    name: { en: "Sreemangal", bn: "শ্রীমঙ্গল" },
    blurb: {
      // The seven-layer tea is Sreemangal's and nowhere else's — the kind of
      // detail only someone who has been there writes.
      en: "Seven layers of tea in one glass.",
      bn: "এক গ্লাসে সাত রঙা চা।",
    },
    season: [9, 10, 11, 12, 1, 2],
    terrain: "tea",
  },
  [District.SUNDARBANS]: {
    name: { en: "Sundarbans", bn: "সুন্দরবন" },
    blurb: {
      en: "Mangrove, tide, and the tiger you probably won't see.",
      bn: "ম্যানগ্রোভ, জোয়ার — আর যে বাঘ সহজে দেখা দেয় না।",
    },
    season: [11, 12, 1, 2],
    terrain: "forest",
  },
  [District.SYLHET]: {
    name: { en: "Sylhet", bn: "সিলেট" },
    blurb: {
      en: "Ratargul is a forest you enter by boat.",
      bn: "রাতারগুল — যে বনে ঢুকতে হয় নৌকায়।",
    },
    // The one district where the monsoon is the season: the swamp forest and
    // the haors need high water. Jaflong wants the dry months instead.
    season: [6, 7, 8, 9, 11, 12, 1],
    terrain: "river",
  },
  [District.CHATTOGRAM]: {
    name: { en: "Chattogram", bn: "চট্টগ্রাম" },
    blurb: {
      en: "Port city of hills and sea",
      bn: "পাহাড় আর সমুদ্রের বন্দরনগরী",
    },
    season: [11, 12, 1, 2],
    terrain: "city",
  },
  [District.DHAKA]: {
    name: { en: "Dhaka", bn: "ঢাকা" },
    blurb: { en: "Four centuries a capital", bn: "চারশো বছরের রাজধানী" },
    season: [11, 12, 1, 2],
    terrain: "city",
  },
  [District.KHULNA]: {
    name: { en: "Khulna", bn: "খুলনা" },
    blurb: { en: "Gateway to the Sundarbans", bn: "সুন্দরবনের প্রবেশদ্বার" },
    season: [11, 12, 1, 2],
    terrain: "city",
  },
  [District.BARISHAL]: {
    name: { en: "Barishal", bn: "বরিশাল" },
    blurb: {
      en: "River city, floating guava market",
      bn: "নদীর শহর, ভাসমান পেয়ারা বাজার",
    },
    // The guava market is the reason to go, and it is a monsoon market — the
    // usual winter answer would send someone to an empty canal.
    season: [7, 8, 9],
    terrain: "river",
  },
  [District.RAJSHAHI]: {
    name: { en: "Rajshahi", bn: "রাজশাহী" },
    blurb: {
      en: "Mangoes, silk, Puthia temples",
      bn: "আম, রেশম আর পুঠিয়ার মন্দির",
    },
    // Mango season, not winter.
    season: [5, 6, 7],
    terrain: "city",
  },
  [District.RANGPUR]: {
    name: { en: "Rangpur", bn: "রংপুর" },
    blurb: { en: "Tajhat palace", bn: "তাজহাট জমিদারবাড়ি" },
    season: [11, 12, 1, 2],
    terrain: "city",
  },
  [District.MYMENSINGH]: {
    name: { en: "Mymensingh", bn: "ময়মনসিংহ" },
    blurb: {
      en: "Brahmaputra bank, Garo hills",
      bn: "ব্রহ্মপুত্রের পাড়, গারো পাহাড়",
    },
    season: [10, 11, 12, 1, 2],
    terrain: "hill",
  },
  [District.JESSORE]: {
    name: { en: "Jessore", bn: "যশোর" },
    blurb: { en: "Godkhali, kingdom of flowers", bn: "ফুলের রাজ্য গদখালী" },
    // The flower fields peak around winter, which is also when Godkhali
    // supplies the rest of the country.
    season: [12, 1, 2],
    terrain: "city",
  },
};

/**
 * Display order for the landing grid: the destinations a traveller actually
 * comes here for first, cities after. Deliberately hand-ordered rather than
 * enum order, which is arbitrary.
 *
 * The completeness check below is what makes an omission a build error: the
 * tuple must contain every District, so adding one to the enum without
 * ordering it here fails `pnpm typecheck` instead of silently dropping a card.
 */
const DISTRICT_ORDER = [
  District.COXS_BAZAR,
  District.RANGAMATI,
  District.SAINT_MARTIN,
  District.SREEMANGAL,
  District.BANDARBAN,
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

/**
 * All sixteen, in display order — the search dropdown's list.
 *
 * Named apart from FEATURED_DISTRICTS below on purpose: the two were briefly
 * one export whose name said "featured" while its contents said "all", which
 * is exactly the kind of thing that ends up rendering sixteen cards where
 * eight were meant.
 */
export const ALL_DISTRICTS_IN_ORDER: readonly District[] = DISTRICT_ORDER;

/**
 * The eight given a card of their own — the places people travel *to*, rather
 * than the cities they travel through.
 *
 * A magazine does not give every entry the same column inches, and neither
 * does this grid. The rest keep their names and their season data; they simply
 * do not get a photograph's worth of space on the front page.
 */
export const FEATURED_DISTRICTS = [
  District.COXS_BAZAR,
  District.RANGAMATI,
  District.SAINT_MARTIN,
  District.SREEMANGAL,
  District.BANDARBAN,
  District.SUNDARBANS,
  District.SYLHET,
  District.KHAGRACHARI,
] as const;

/** COXS_BAZAR becomes coxs-bazar — the district's own folder under public. */
export function districtSlug(district: District): string {
  return district.toLowerCase().replaceAll("_", "-");
}

/**
 * Where a district's card photograph lives, derived from the enum rather than
 * stored.
 *
 * COXS_BAZAR becomes /images/districts/coxs-bazar/cover.webp. A hand-kept map
 * of district to filename is a second list to keep in step with the first, and
 * the failure when it drifts is a card that silently shows no picture.
 *
 * A folder each rather than eight files in one, so a district can grow a
 * gallery later without the flat directory turning into a naming convention
 * nobody remembers. `cover` is the one this grid uses.
 */
export function districtPhotoPath(district: District): string {
  return mediaUrl(`/images/districts/${districtSlug(district)}/cover.webp`);
}

/**
 * Districts whose photograph has actually been added to the folder above.
 *
 * Listed rather than probed: the browser cannot ask whether a file exists
 * without requesting it, so rendering every card's image unconditionally would
 * fire a 404 for each one still missing — console noise that reads like a bug
 * and costs a request on a connection that has better uses.
 *
 * Adding a photograph is two steps: drop the file in, add the district here.
 * Cards not listed keep their painted tone, which is a finished state and not
 * a placeholder.
 */
export const DISTRICTS_WITH_PHOTO: readonly District[] = [];

/**
 * Everything else, derived rather than listed.
 *
 * Two hand-written lists would let a district fall between them and vanish
 * from the page without failing anything. Subtracting from the ordered list
 * means a newly added district lands here automatically — visible and plain,
 * which is the right way to be wrong.
 */
export const REMAINING_DISTRICTS: readonly District[] = DISTRICT_ORDER.filter(
  (district) => !(FEATURED_DISTRICTS as readonly District[]).includes(district),
);
