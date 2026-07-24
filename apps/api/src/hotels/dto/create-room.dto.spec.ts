import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateRoomDto } from "./create-room.dto";

describe("CreateRoomDto", () => {
  const base = {
    roomType: "DOUBLE",
    pricePerNightMinor: 500000,
    capacity: 2,
    hasAC: true,
    bedType: "DOUBLE",
  };

  it("accepts a fully valid payload", async () => {
    const dto = plainToInstance(CreateRoomDto, base);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects an invalid roomType", async () => {
    const dto = plainToInstance(CreateRoomDto, {
      ...base,
      roomType: "MEGA_SUITE",
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "roomType")).toBe(true);
  });

  it("rejects an invalid bedType", async () => {
    const dto = plainToInstance(CreateRoomDto, { ...base, bedType: "HAMMOCK" });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "bedType")).toBe(true);
  });

  it("rejects a missing hasAC", async () => {
    const { hasAC: _omit, ...withoutAC } = base;
    const dto = plainToInstance(CreateRoomDto, withoutAC);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "hasAC")).toBe(true);
  });

  it("accepts optional amenities as a string array", async () => {
    const dto = plainToInstance(CreateRoomDto, {
      ...base,
      amenities: ["Balcony", "Sea View"],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
