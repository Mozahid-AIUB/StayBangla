## ADDED Requirements

### Requirement: Searching without dates is allowed

`GET /v1/rooms/available` and `GET /v1/vehicles/available` SHALL accept
requests with no dates, returning everything active in the district. When
dates are supplied they SHALL continue to exclude anything overlapping a
`HELD`, `CONFIRMED`, `CHECKED_IN` or `BLOCKED` booking.

Dates are currently required. The landing page's sixteen district cards invite
browsing, and a visitor deciding _where_ to go has not yet decided _when_ —
demanding a date before showing anything asks the question in the wrong order.

#### Scenario: District only

- **WHEN** rooms are requested for `city=COXS_BAZAR` with no dates
- **THEN** every active room in an active hotel in that district is returned

#### Scenario: Dates still filter

- **WHEN** rooms are requested with dates that overlap a confirmed booking
- **THEN** the booked room is absent and the others are present

#### Scenario: Neither district nor dates

- **WHEN** rooms are requested with no parameters at all
- **THEN** active rooms are returned rather than a validation error

#### Scenario: A reversed range is still rejected

- **WHEN** `checkOut` is earlier than `checkIn`
- **THEN** the response is 400

#### Scenario: One date without the other is rejected

- **WHEN** `checkIn` is given and `checkOut` is not
- **THEN** the response is 400, because a half-specified range has no meaning

#### Scenario: Suspended vendors stay hidden

- **WHEN** a hotel's owner is suspended
- **THEN** its rooms are absent from results with or without dates

### Requirement: Search results carry a photograph

Each room in `GET /v1/rooms/available` SHALL carry a cover image key — the
room's first photograph, or its hotel's first if the room has none, or null.

A result list with no images cannot be scanned. The endpoint currently returns
names and prices only, so a page built on it would be a table.

#### Scenario: Room photograph is preferred

- **WHEN** a room has its own photograph and its hotel has another
- **THEN** the result carries the room's

#### Scenario: Hotel photograph is the fallback

- **WHEN** a room has no photograph and its hotel has one
- **THEN** the result carries the hotel's

#### Scenario: Neither has one

- **WHEN** neither the room nor the hotel has a photograph
- **THEN** the field is null and the card renders its painted fallback, which
  is a finished state rather than a broken image

### Requirement: The search page shows what was searched and what came back

`/search` SHALL read district and dates from the URL, so a result page can be
shared, bookmarked and reached from the landing page's district cards.

It SHALL show rooms and vehicles as separate groups, state how many of each
were found, and offer changing the district or the dates without leaving.

#### Scenario: Arriving from a district card

- **WHEN** a visitor follows a district card from the landing page
- **THEN** `/search?city=<district>` opens, showing that district's rooms and
  vehicles with no dates required

#### Scenario: Arriving from the search form

- **WHEN** a visitor submits the landing page's form with a district and dates
- **THEN** `/search` opens with all three in the URL and results filtered by
  them

#### Scenario: Nothing matches

- **WHEN** a district and dates return no rooms
- **THEN** the page says so plainly and offers to clear the dates, rather than
  showing an empty area

#### Scenario: The API is unreachable

- **WHEN** the request fails
- **THEN** the page says the search could not be run and offers to retry —
  it does not render as "no results"

#### Scenario: Prices are shown in taka

- **WHEN** a result has `pricePerNightMinor: 350000` and `currency: "BDT"`
- **THEN** it reads as ৳3,500 per night, converted from minor units
