## ADDED Requirements

### Requirement: A hotel's page shows only rooms that can be booked

`GET /v1/hotels/:id` SHALL exclude rooms with `isActive = false`.

It currently includes them, and its test asserts that it does — so the
behaviour is locked in by a test that describes a defect. A visitor shown a
room they cannot book learns that only after choosing it.

#### Scenario: Inactive rooms are absent

- **WHEN** a hotel has two active rooms and one deactivated
- **THEN** the response contains two rooms

#### Scenario: A hotel with no active rooms is still a hotel

- **WHEN** every room in an active hotel is deactivated
- **THEN** the response is 200 with an empty room list, not 404

#### Scenario: An inactive hotel is not found

- **WHEN** the hotel itself has `isActive = false`
- **THEN** the response is 404

### Requirement: The hotel page carries its photographs, rooms and prices

`/hotels/[id]` SHALL show the hotel's name, district and photographs, and each
bookable room with its type, capacity, price per night and photograph.

When the visitor arrived with dates, the page SHALL keep them, show the number
of nights and the total for each room, and let each room be booked directly.

#### Scenario: Arriving with dates from search

- **WHEN** a visitor opens a hotel from a dated search
- **THEN** the dates are still applied, and each room shows a nightly price, a
  night count and a total

#### Scenario: Arriving with no dates

- **WHEN** a visitor opens a hotel directly
- **THEN** rooms show nightly prices and the page asks for dates before
  booking becomes possible

#### Scenario: A hotel that does not exist

- **WHEN** the id matches no hotel
- **THEN** the page shows a not-found state with a way back to search, not a
  blank screen

#### Scenario: A hotel with no photographs

- **WHEN** neither the hotel nor its rooms have photographs
- **THEN** the page renders its painted fallback and stays legible

### Requirement: The vehicle page works without photographs

`/vehicles/[id]` SHALL show category, model, district, capacity and price per
day, and SHALL allow booking with dates.

The schema has `HotelPhoto` and `RoomPhoto` and no equivalent for vehicles, so
there is nothing to show and this is a deliberate typographic treatment rather
than a missing image. Vehicles are otherwise fully bookable —
`CreateBookingDto` accepts `bookableType: "VEHICLE"` and `Booking` carries
`vehicleId` — so no separate flow is needed.

#### Scenario: A vehicle renders as a card

- **WHEN** a visitor opens a vehicle
- **THEN** its category, model, district, capacity and daily price are shown
  without any image placeholder

#### Scenario: A vehicle is booked through the same path as a room

- **WHEN** a visitor books a vehicle with dates
- **THEN** the booking is created with `bookableType: "VEHICLE"` and continues
  into the same payment flow as a room
