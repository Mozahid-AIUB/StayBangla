import { BadRequestException } from "@nestjs/common";
import { assertObjectKeyBelongsTo } from "./object-key";

/**
 * The attack these tests describe was live: object keys are returned by the
 * public hotel-detail endpoint, so one vendor could read another's key, attach
 * it to their own listing, and then delete it — destroying a competitor's
 * photograph from storage with nothing in either account to explain it.
 */
describe("assertObjectKeyBelongsTo", () => {
  const ok = (key: string) =>
    expect(() => assertObjectKeyBelongsTo("hotels", "HA", key)).not.toThrow();
  const rejected = (key: string) =>
    expect(() => assertObjectKeyBelongsTo("hotels", "HA", key)).toThrow(
      BadRequestException,
    );

  it("accepts a key the presign step would have issued", () => {
    // hotels/{hotelId}/{uuid}.{ext} — the shape hotels.service.ts generates.
    ok("hotels/HA/8f14e45f-ceea-4d2d-8b3f-1b3f8e2e2e2e.jpg");
    ok("hotels/HA/photo.webp");
  });

  it("rejects another hotel's key — the theft and deletion vector", () => {
    rejected("hotels/HB/8f14e45f-ceea-4d2d-8b3f-1b3f8e2e2e2e.jpg");
  });

  it("rejects a key that walks out of the prefix", () => {
    // Starts with "hotels/HA/" and still points at HB. A prefix test on its
    // own reads this as safe, which is why the traversal check runs first.
    rejected("hotels/HA/../HB/stolen.jpg");
    rejected("hotels/HA/..%2FHB/stolen.jpg".replace("%2F", "/"));
    rejected("hotels/HA//../HB/stolen.jpg");
  });

  it("rejects a hotel id that is merely a prefix of another", () => {
    // "hotels/HA" without the trailing slash would match "hotels/HA2/..." —
    // the separator is what makes the comparison mean what it looks like.
    expect(() =>
      assertObjectKeyBelongsTo("hotels", "HA", "hotels/HA2/x.jpg"),
    ).toThrow(BadRequestException);
  });

  it("rejects shapes the server never issues", () => {
    rejected("hotels/HA/");
    rejected("hotels/HA/nested/path.jpg");
    rejected("rooms/HA/x.jpg");
    rejected("x.jpg");
    rejected("");
  });

  it("scopes rooms the same way", () => {
    expect(() =>
      assertObjectKeyBelongsTo("rooms", "R1", "rooms/R1/x.jpg"),
    ).not.toThrow();
    expect(() =>
      assertObjectKeyBelongsTo("rooms", "R1", "rooms/R2/x.jpg"),
    ).toThrow(BadRequestException);
    // A room key must not be accepted by the hotel scope or the reverse — the
    // two live in the same bucket.
    expect(() =>
      assertObjectKeyBelongsTo("rooms", "R1", "hotels/R1/x.jpg"),
    ).toThrow(BadRequestException);
  });
});
