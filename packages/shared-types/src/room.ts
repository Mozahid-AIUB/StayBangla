import { RoomType, BedType } from "./enums";

export interface RoomPhotoRef {
  id: string;
  objectKey: string;
  isPrimary: boolean;
  createdAt: string;
}

export interface Room {
  id: string;
  hotelId: string;
  roomType: RoomType;
  pricePerNightMinor: number;
  currency: string;
  capacity: number;
  hasAC: boolean;
  bedType: BedType;
  amenities: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  photos: RoomPhotoRef[];
}
