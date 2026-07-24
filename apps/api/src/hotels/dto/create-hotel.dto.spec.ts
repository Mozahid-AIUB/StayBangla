import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateHotelDto } from "./create-hotel.dto";

describe("CreateHotelDto", () => {
  it("accepts a valid District enum value for city", async () => {
    const dto = plainToInstance(CreateHotelDto, {
      name: "Sea Pearl",
      city: "COXS_BAZAR",
      address: "Kolatoli Beach Road",
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects an invalid city value", async () => {
    const dto = plainToInstance(CreateHotelDto, {
      name: "Sea Pearl",
      city: "Cox's Bazar",
      address: "Kolatoli Beach Road",
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "city")).toBe(true);
  });

  it("accepts valid FacilityCatalog amenities", async () => {
    const dto = plainToInstance(CreateHotelDto, {
      name: "Sea Pearl",
      city: "COXS_BAZAR",
      address: "Kolatoli Beach Road",
      amenities: ["WIFI", "SWIMMING_POOL"],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects an invalid amenity value", async () => {
    const dto = plainToInstance(CreateHotelDto, {
      name: "Sea Pearl",
      city: "COXS_BAZAR",
      address: "Kolatoli Beach Road",
      amenities: ["Pool"],
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "amenities")).toBe(true);
  });
});
