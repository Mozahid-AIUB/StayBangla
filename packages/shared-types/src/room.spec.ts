import { Room, RoomPhotoRef } from "./room";
import { RoomType, BedType } from "./enums";

describe("Room", () => {
  it("accepts a shape matching the real room object nested in GET /hotels/:id", () => {
    const photo: RoomPhotoRef = {
      id: "p1",
      objectKey: "rooms/r1/xyz.png",
      isPrimary: false,
      createdAt: "2026-07-25T00:00:00.000Z",
    };
    const room: Room = {
      id: "r1",
      hotelId: "h1",
      roomType: RoomType.SUITE,
      pricePerNightMinor: 800000,
      currency: "BDT",
      capacity: 4,
      hasAC: true,
      bedType: BedType.KING,
      amenities: ["Balcony", "Sea View"],
      isActive: true,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      photos: [photo],
    };

    expect(room.roomType).toBe("SUITE");
    expect(room.amenities).toEqual(["Balcony", "Sea View"]);
  });
});
