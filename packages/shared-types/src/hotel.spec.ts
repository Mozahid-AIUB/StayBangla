import { Hotel, HotelWithDetails, HotelPhotoRef } from "./hotel";
import { District, FacilityCatalog } from "./enums";
import { Room } from "./room";

describe("Hotel", () => {
  it("accepts a shape matching the real GET /hotels/:id response", () => {
    const hotel: Hotel = {
      id: "h1",
      ownerId: "v1",
      name: "Cox's Paradise Hotel",
      city: District.COXS_BAZAR,
      address: "Marine Drive Road",
      description: "Seafront hotel",
      amenities: [FacilityCatalog.WIFI, FacilityCatalog.SWIMMING_POOL],
      starRating: 4,
      checkInTime: "14:00",
      checkOutTime: "11:00",
      isActive: true,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };

    expect(hotel.city).toBe("COXS_BAZAR");
  });

  it("allows description and starRating to be null", () => {
    const hotel: Hotel = {
      id: "h2",
      ownerId: "v1",
      name: "Budget Inn",
      city: District.DHAKA,
      address: "Motijheel",
      description: null,
      amenities: [],
      starRating: null,
      checkInTime: "12:00",
      checkOutTime: "10:00",
      isActive: true,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };

    expect(hotel.starRating).toBeNull();
  });
});

describe("HotelWithDetails", () => {
  it("extends Hotel with rooms and photos arrays", () => {
    const photo: HotelPhotoRef = {
      id: "p1",
      objectKey: "hotels/h1/abc.jpg",
      isPrimary: true,
      createdAt: "2026-07-25T00:00:00.000Z",
    };
    const room: Room = {
      id: "r1",
      hotelId: "h1",
      roomType: "DOUBLE" as Room["roomType"],
      pricePerNightMinor: 500000,
      currency: "BDT",
      capacity: 2,
      hasAC: true,
      bedType: "DOUBLE" as Room["bedType"],
      amenities: [],
      isActive: true,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      photos: [],
    };
    const hotelWithDetails: HotelWithDetails = {
      id: "h1",
      ownerId: "v1",
      name: "Cox's Paradise Hotel",
      city: District.COXS_BAZAR,
      address: "Marine Drive Road",
      description: null,
      amenities: [],
      starRating: null,
      checkInTime: "14:00",
      checkOutTime: "11:00",
      isActive: true,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      rooms: [room],
      photos: [photo],
    };

    expect(hotelWithDetails.rooms).toHaveLength(1);
    expect(hotelWithDetails.photos[0]!.isPrimary).toBe(true);
  });
});
