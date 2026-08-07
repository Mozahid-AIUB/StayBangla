## ADDED Requirements

### Requirement: Every request goes through one client that knows the version prefix

The web app SHALL reach the API only through a single module. Callers SHALL
pass a path without the version — `/bookings`, not `/v1/bookings` — and the
client SHALL add the prefix.

The API enables URI versioning with `defaultVersion: "1"`, so every endpoint
except `/health`, `/payments/sslcommerz/ipn` and `/internal/bookings/sweep`
lives under `/v1`. A path written by hand somewhere in a component would 404,
and the 404 would look like missing data rather than a missing prefix.

#### Scenario: The prefix is added

- **WHEN** a caller requests the path `/rooms/available`
- **THEN** the request goes to `<base>/v1/rooms/available`

#### Scenario: The base URL is present in a production build

- **WHEN** the site is built with no API base URL in the environment
- **THEN** the built bundle still contains the production API origin, because
  the client carries it as a committed default

### Requirement: The client carries the access token and refreshes it once

The client SHALL attach `Authorization: Bearer <accessToken>` when a token is
held. On a 401 it SHALL attempt `POST /v1/auth/refresh` exactly once, retry the
original request, and if the refresh also fails, discard the session and
surface an unauthenticated error.

One retry, not a loop: a refresh endpoint that returns 401 forever would
otherwise spin.

#### Scenario: An expired token is refreshed transparently

- **WHEN** a request returns 401 and the refresh succeeds
- **THEN** the original request is retried with the new token and its result is
  returned to the caller, which never sees the 401

#### Scenario: A failed refresh ends the session

- **WHEN** a request returns 401 and the refresh also returns 401
- **THEN** the stored session is cleared and the caller receives an
  unauthenticated error

#### Scenario: Refresh is not retried repeatedly

- **WHEN** a single request triggers a refresh that fails
- **THEN** `POST /v1/auth/refresh` is called exactly once

### Requirement: Failures are distinguishable, not generic

The client SHALL surface a typed error carrying the HTTP status and the API's
message. A page SHALL be able to tell "no results" from "the API is
unreachable" from "your session ended".

An empty result and a failed request look identical if both render as an empty
list, and the second is a fault the visitor should be told about.

#### Scenario: A network failure is not an empty result

- **WHEN** the API cannot be reached at all
- **THEN** the caller receives an error, not an empty array

#### Scenario: The API's validation message survives

- **WHEN** the API returns 400 with a message such as
  "checkIn must be a calendar date"
- **THEN** that message is available to the caller

### Requirement: A signed-in session survives a reload

The web app SHALL persist the access token and the current user so a reload
does not sign the visitor out.

`output: "export"` means there is no server to hold a session, so this is the
browser's own storage.

#### Scenario: Reload keeps the visitor signed in

- **WHEN** a signed-in visitor reloads the page
- **THEN** they are still signed in

#### Scenario: Signing out clears the session

- **WHEN** a visitor signs out
- **THEN** the stored token and user are removed and a reload shows them
  signed out
