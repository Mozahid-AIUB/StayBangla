import { BadRequestException } from "@nestjs/common";

/**
 * Rejects an object key that does not belong to the listing it is being
 * attached to.
 *
 * The upload flow is presign-then-confirm: the server generates
 * `hotels/{hotelId}/{uuid}.jpg`, hands back a signed URL, and the client comes
 * back to confirm. Confirm checked that the caller owned the *hotel* — and
 * then stored whatever key string the request carried.
 *
 * That is enough to steal and destroy another vendor's photographs. Object
 * keys are public: `GET /v1/hotels/{id}` returns the photo rows with their
 * keys in them. So vendor A reads B's key off B's own page, posts it to
 * `/v1/hotels/{A}/photos/confirm`, and now owns a row pointing at B's file —
 * A's listing displays B's photograph. Worse, `deletePhoto` checks that the
 * *row* belongs to A, which it now does, and deletes the underlying object.
 * B's photograph is gone from storage and B's listing shows a broken image,
 * with nothing in either account to explain it.
 *
 * The prefix is the fix because it is the one part of the key the server
 * chose. Anything else in the string is the client's, and none of it is
 * trusted.
 *
 * @param scope `"hotels"` or `"rooms"` — the prefix the presign step uses.
 * @param ownerId The hotel or room id the photo is being attached to.
 * @param objectKey The key the client is asking to confirm.
 */
export function assertObjectKeyBelongsTo(
  scope: "hotels" | "rooms",
  ownerId: string,
  objectKey: string,
): void {
  const expectedPrefix = `${scope}/${ownerId}/`;

  // Checked before the prefix, not after. `hotels/A/../B/stolen.jpg` starts
  // with the right prefix and still points somewhere else entirely — a prefix
  // test alone reads it as safe. S3-compatible stores do not normalise these
  // for us, and neither should we: a legitimate key never contains a segment
  // like this, so the honest answer is to refuse rather than to resolve it.
  if (objectKey.includes("..") || objectKey.includes("//")) {
    throw new BadRequestException("objectKey is not a valid storage key");
  }

  if (!objectKey.startsWith(expectedPrefix)) {
    throw new BadRequestException(
      `objectKey must be one issued for this ${scope === "hotels" ? "hotel" : "room"}`,
    );
  }

  // Exactly one segment after the prefix. Without this, `hotels/A/x/../../B/y`
  // is caught by the traversal check above but `hotels/A/nested/path.jpg` is
  // not — and a key shape the server never issues has no business being
  // accepted, whatever it happens to point at today.
  const remainder = objectKey.slice(expectedPrefix.length);
  if (remainder.length === 0 || remainder.includes("/")) {
    throw new BadRequestException("objectKey is not a valid storage key");
  }
}
