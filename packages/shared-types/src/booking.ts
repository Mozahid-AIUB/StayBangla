import { BookingStatus } from "./enums";

export type BookableType = "ROOM" | "VEHICLE";

export interface Booking {
  id: string;
  userId: string | null;
  bookableType: BookableType;
  roomId: string | null;
  vehicleId: string | null;
  resourceOwnerId: string;
  checkIn: string;
  checkOut: string;
  guestCount: number | null;
  totalAmountMinor: number;
  currency: string;
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
}
