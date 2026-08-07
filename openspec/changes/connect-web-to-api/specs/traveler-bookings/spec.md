## ADDED Requirements

### Requirement: A traveller can list their own bookings

The API SHALL expose `GET /v1/bookings`, restricted to the `TRAVELER` role,
returning only bookings whose `travelerId` is the authenticated caller's.

Each entry SHALL carry enough to render a row without a second request: the
booking's id, status, `checkIn`, `checkOut`, `totalAmountMinor`, `currency`,
`paymentStatus`, and a description of what was booked — for a room, the hotel
name, city and room type; for a vehicle, the category, model and city.

Results SHALL be ordered by `checkIn` descending, so the most recent trip is
first.

#### Scenario: Traveller sees only their own bookings

- **WHEN** a traveller with two bookings calls `GET /v1/bookings`, and another
  traveller has bookings of their own
- **THEN** the response contains exactly the caller's two bookings and none of
  the other traveller's

#### Scenario: A vendor cannot use the endpoint

- **WHEN** a user whose role is `VENDOR` calls `GET /v1/bookings`
- **THEN** the response is 403

#### Scenario: Unauthenticated request is rejected

- **WHEN** the request carries no access token
- **THEN** the response is 401

#### Scenario: A traveller with no bookings

- **WHEN** a traveller who has never booked calls the endpoint
- **THEN** the response is 200 with an empty array, not 404

#### Scenario: Room booking carries its hotel

- **WHEN** the traveller has a booking for a room
- **THEN** that entry includes the hotel's name and city and the room's type

#### Scenario: Vehicle booking carries its vehicle

- **WHEN** the traveller has a booking for a vehicle
- **THEN** that entry includes the vehicle's category, model and city

### Requirement: A traveller can retrieve one of their bookings

The API SHALL expose `GET /v1/bookings/:id`, restricted to the `TRAVELER`
role, returning the booking only when `travelerId` matches the caller.

A booking belonging to someone else SHALL return 404, not 403. A 403 would
confirm that the id exists, which turns the endpoint into a way to enumerate
bookings.

#### Scenario: Own booking is returned

- **WHEN** a traveller requests a booking they created
- **THEN** the response is 200 and carries the same shape as one list entry

#### Scenario: Another traveller's booking is indistinguishable from a missing one

- **WHEN** a traveller requests a booking id belonging to a different traveller
- **THEN** the response is 404, with the same body as an id that does not exist

#### Scenario: Unknown id

- **WHEN** a traveller requests an id that no booking has
- **THEN** the response is 404
