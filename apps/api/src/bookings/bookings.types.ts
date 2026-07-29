export type BookableType = "ROOM" | "VEHICLE";

export interface BookingRecord {
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
  status: string;
  paymentStatus: string;
  createdAt: Date;
  updatedAt: Date;
}
