export enum BookingStatus {
  /**
   * Frontend-only UI state before a hold exists — a traveler "selecting" a
   * room/date before calling POST /bookings. The database's BookingStatus
   * enum (apps/api/prisma/schema.prisma) intentionally has no SELECTED
   * value; no Booking row is ever persisted in this state. Do not "fix"
   * this by adding SELECTED to the Prisma enum or by removing it here.
   */
  SELECTED = "SELECTED",
  HELD = "HELD",
  CONFIRMED = "CONFIRMED",
  CHECKED_IN = "CHECKED_IN",
  COMPLETED = "COMPLETED",
  AUTO_CANCELLED = "AUTO_CANCELLED",
  CANCELLED = "CANCELLED",
  REFUNDED = "REFUNDED",
  BLOCKED = "BLOCKED",
}

export enum UserRole {
  TRAVELER = "TRAVELER",
  VENDOR = "VENDOR",
  GUIDE = "GUIDE",
  ADMIN = "ADMIN",
  SUPER_ADMIN = "SUPER_ADMIN",
}

export enum District {
  DHAKA = "DHAKA",
  CHATTOGRAM = "CHATTOGRAM",
  COXS_BAZAR = "COXS_BAZAR",
  RANGAMATI = "RANGAMATI",
  BANDARBAN = "BANDARBAN",
  KHAGRACHARI = "KHAGRACHARI",
  SYLHET = "SYLHET",
  SREEMANGAL = "SREEMANGAL",
  SAINT_MARTIN = "SAINT_MARTIN",
  KHULNA = "KHULNA",
  SUNDARBANS = "SUNDARBANS",
  RAJSHAHI = "RAJSHAHI",
  BARISHAL = "BARISHAL",
  RANGPUR = "RANGPUR",
  MYMENSINGH = "MYMENSINGH",
  JESSORE = "JESSORE",
}

export enum RoomType {
  SINGLE = "SINGLE",
  DOUBLE = "DOUBLE",
  TWIN = "TWIN",
  SUITE = "SUITE",
  FAMILY = "FAMILY",
  DORMITORY = "DORMITORY",
}

export enum BedType {
  SINGLE = "SINGLE",
  TWIN = "TWIN",
  DOUBLE = "DOUBLE",
  QUEEN = "QUEEN",
  KING = "KING",
  BUNK = "BUNK",
}

export enum FacilityCatalog {
  TRAVEL_DESK = "TRAVEL_DESK",
  BATHTUB = "BATHTUB",
  LAUNDRY_SERVICE = "LAUNDRY_SERVICE",
  WELCOME_DRINKS = "WELCOME_DRINKS",
  THEMED_NIGHTS = "THEMED_NIGHTS",
  ELEVATOR = "ELEVATOR",
  SMOKE_FREE = "SMOKE_FREE",
  SWIMMING_POOL = "SWIMMING_POOL",
  PARKING = "PARKING",
  GYM = "GYM",
  RESTAURANT = "RESTAURANT",
  ROOM_SERVICE = "ROOM_SERVICE",
  WIFI = "WIFI",
  AIR_CONDITIONING = "AIR_CONDITIONING",
  GENERATOR_BACKUP = "GENERATOR_BACKUP",
  CCTV = "CCTV",
}
