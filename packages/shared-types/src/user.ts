export interface PublicUser {
  id: string;
  phone: string | null;
  email: string | null;
  fullName: string | null;
  vendorType: "HOTEL" | "VEHICLE" | "BOTH" | null;
  verifiedStatus: "PENDING" | "VERIFIED" | "REJECTED";
  createdAt: string;
  updatedAt: string;
}

export interface VendorVerificationLogEntry {
  id: string;
  vendorId: string;
  adminId: string;
  action: "VERIFIED" | "REJECTED" | "PENDING";
  reason: string | null;
  createdAt: string;
}
