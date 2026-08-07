import { District } from "./enums";

export interface Vehicle {
  id: string;
  ownerId: string;
  category: "CAR" | "CNG" | "JEEP" | "BOAT";
  city: District;
  model: string | null;
  capacity: number;
  pricePerDayMinor: number;
  currency: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
