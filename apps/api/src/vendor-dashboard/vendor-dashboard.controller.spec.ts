import { Test } from "@nestjs/testing";
import { VendorDashboardController } from "./vendor-dashboard.controller";
import { VendorDashboardService } from "./vendor-dashboard.service";
import { VendorLedgerService } from "./vendor-ledger.service";
import { BookingsService } from "../bookings/bookings.service";
import { SuspensionGuard } from "../auth/guards/suspension.guard";

describe("VendorDashboardController", () => {
  let controller: VendorDashboardController;
  let dashboardService: {
    getSummary: jest.Mock;
    getListings: jest.Mock;
    getBookings: jest.Mock;
    getEarnings: jest.Mock;
  };
  let ledgerService: {
    create: jest.Mock;
    list: jest.Mock;
    softDelete: jest.Mock;
  };
  let bookingsService: {
    createOfflineBooking: jest.Mock;
    cancelOfflineBooking: jest.Mock;
  };

  beforeEach(async () => {
    dashboardService = {
      getSummary: jest.fn(),
      getListings: jest.fn(),
      getBookings: jest.fn(),
      getEarnings: jest.fn(),
    };
    ledgerService = {
      create: jest.fn(),
      list: jest.fn(),
      softDelete: jest.fn(),
    };
    bookingsService = {
      createOfflineBooking: jest.fn(),
      cancelOfflineBooking: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [VendorDashboardController],
      providers: [
        { provide: VendorDashboardService, useValue: dashboardService },
        { provide: VendorLedgerService, useValue: ledgerService },
        { provide: BookingsService, useValue: bookingsService },
      ],
    })
      // SuspensionGuard's own DB-read behavior has dedicated e2e coverage
      // (test/admin-panel.e2e-spec.ts); it needs PrismaService this
      // controller-only module doesn't wire.
      .overrideGuard(SuspensionGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(VendorDashboardController);
  });

  it("summary() delegates to VendorDashboardService.getSummary with the caller's id", async () => {
    dashboardService.getSummary.mockResolvedValue({ monthlyIncomeMinor: 0 });
    await controller.summary({ id: "vendor1", roles: ["VENDOR"] });
    expect(dashboardService.getSummary).toHaveBeenCalledWith("vendor1");
  });

  it("listings() delegates to VendorDashboardService.getListings", async () => {
    dashboardService.getListings.mockResolvedValue([]);
    await controller.listings({ id: "vendor1", roles: ["VENDOR"] });
    expect(dashboardService.getListings).toHaveBeenCalledWith("vendor1");
  });

  it("bookings() delegates to VendorDashboardService.getBookings with query filters", async () => {
    dashboardService.getBookings.mockResolvedValue([]);
    await controller.bookings(
      { id: "vendor1", roles: ["VENDOR"] },
      { status: "CONFIRMED", roomId: "room1" },
    );
    expect(dashboardService.getBookings).toHaveBeenCalledWith("vendor1", {
      status: "CONFIRMED",
      roomId: "room1",
      vehicleId: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it("earnings() delegates to VendorDashboardService.getEarnings", async () => {
    dashboardService.getEarnings.mockResolvedValue({
      online: 0,
      offline: 0,
      total: 0,
      byListing: [],
    });
    await controller.earnings(
      { id: "vendor1", roles: ["VENDOR"] },
      { period: "month" },
    );
    expect(dashboardService.getEarnings).toHaveBeenCalledWith("vendor1", {
      period: "month",
      from: undefined,
      to: undefined,
    });
  });

  it("createLedgerEntry() delegates to VendorLedgerService.create", async () => {
    ledgerService.create.mockResolvedValue({ id: "vle1" });
    await controller.createLedgerEntry(
      { id: "vendor1", roles: ["VENDOR"] },
      {
        roomId: "room1",
        direction: "EXPENSE",
        category: "MAINTENANCE",
        amountMinor: 1000,
        entryDate: "2026-08-01",
      },
    );
    expect(ledgerService.create).toHaveBeenCalledWith(
      "vendor1",
      expect.objectContaining({ roomId: "room1" }),
    );
  });

  it("listLedgerEntries() delegates to VendorLedgerService.list", async () => {
    ledgerService.list.mockResolvedValue([]);
    await controller.listLedgerEntries({ id: "vendor1", roles: ["VENDOR"] });
    expect(ledgerService.list).toHaveBeenCalledWith("vendor1");
  });

  it("deleteLedgerEntry() delegates to VendorLedgerService.softDelete", async () => {
    await controller.deleteLedgerEntry(
      { id: "vendor1", roles: ["VENDOR"] },
      "vle1",
    );
    expect(ledgerService.softDelete).toHaveBeenCalledWith("vendor1", "vle1");
  });

  it("createOfflineBooking() delegates to BookingsService.createOfflineBooking", async () => {
    bookingsService.createOfflineBooking.mockResolvedValue({
      booking: {},
      vendorLedgerEntry: {},
    });
    await controller.createOfflineBooking(
      { id: "vendor1", roles: ["VENDOR"] },
      {
        bookableType: "ROOM",
        bookableId: "room1",
        checkIn: "2026-08-01",
        checkOut: "2026-08-03",
        amountMinor: 5000,
      },
    );
    expect(bookingsService.createOfflineBooking).toHaveBeenCalledWith(
      "vendor1",
      expect.objectContaining({ bookableId: "room1" }),
    );
  });

  it("cancelOfflineBooking() delegates to BookingsService.cancelOfflineBooking", async () => {
    bookingsService.cancelOfflineBooking.mockResolvedValue({});
    await controller.cancelOfflineBooking(
      { id: "vendor1", roles: ["VENDOR"] },
      "booking1",
    );
    expect(bookingsService.cancelOfflineBooking).toHaveBeenCalledWith(
      "vendor1",
      "booking1",
    );
  });
});
