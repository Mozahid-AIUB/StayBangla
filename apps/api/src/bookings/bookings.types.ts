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
  source: "ONLINE" | "OFFLINE";
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOfflineBookingInput {
  bookableType: BookableType;
  bookableId: string;
  checkIn: string;
  checkOut: string;
  guestName?: string;
  amountMinor: number;
  note?: string;
}
