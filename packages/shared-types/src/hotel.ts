import { District, FacilityCatalog } from "./enums";
import { Room } from "./room";

export interface HotelPhotoRef {
  id: string;
  objectKey: string;
  isPrimary: boolean;
  createdAt: string;
}

export interface Hotel {
  id: string;
  ownerId: string;
  name: string;
  city: District;
  address: string;
  description: string | null;
  amenities: FacilityCatalog[];
  starRating: number | null;
  checkInTime: string;
  checkOutTime: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HotelWithDetails extends Hotel {
  rooms: Room[];
  photos: HotelPhotoRef[];
}
