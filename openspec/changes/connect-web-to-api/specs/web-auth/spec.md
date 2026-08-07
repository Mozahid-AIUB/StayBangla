## ADDED Requirements

### Requirement: A visitor can register and sign in

`/register` SHALL create an account through `POST /v1/auth/register` and
`/signin` SHALL sign in through `POST /v1/auth/login`, storing the access token
and the user.

Registration SHALL let the visitor choose to travel or to list a property,
because `RegisterDto` carries the role and the two lead to different places.

#### Scenario: Signing in

- **WHEN** valid credentials are submitted
- **THEN** the token is stored and the visitor lands where they were headed, or
  on the home page if nowhere

#### Scenario: Wrong credentials

- **WHEN** the API rejects the credentials
- **THEN** the form says so and keeps what was typed apart from the password

#### Scenario: Registering as a traveller

- **WHEN** someone registers to travel
- **THEN** the account is created with the traveller role and they are signed in

#### Scenario: Registering as a vendor

- **WHEN** someone registers to list a property
- **THEN** the account is created with the vendor role and they are told it
  needs approval before listings appear

#### Scenario: An account that already exists

- **WHEN** registration fails because the identifier is taken
- **THEN** the form says so and offers to sign in instead

### Requirement: Verification is reachable, and its limits are explained

`POST /v1/auth/otp/request` and `/verify` both require a session, so the code
step SHALL come after sign-in rather than before it. The site SHALL show the
resend cooldown and SHALL state plainly when a limit has been hit.

The API enforces a cooldown, a per-identifier hourly limit and a per-IP hourly
limit, and it deliberately does not reset the attempt counter when a new code
is requested. A visitor who is locked out should be told, not left pressing a
button that silently fails.

#### Scenario: Requesting and verifying

- **WHEN** a signed-in visitor requests a code and enters it
- **THEN** the account is verified and the returned token replaces the stored
  one

#### Scenario: The code is wrong

- **WHEN** an incorrect code is submitted
- **THEN** the page says so and allows another attempt while attempts remain

#### Scenario: Attempts are exhausted

- **WHEN** the API reports the attempt limit reached
- **THEN** the page explains that requesting a new code will not clear the
  lockout and says when it lifts

#### Scenario: Resend is on cooldown

- **WHEN** a resend is requested during the cooldown
- **THEN** the button is disabled with the remaining time shown, and no request
  is sent

### Requirement: The header reflects who is signed in

The site header SHALL show a sign-in link to a visitor and the account to a
signed-in user, with a way to reach their bookings and to sign out.

#### Scenario: Signed out

- **WHEN** nobody is signed in
- **THEN** the header offers to sign in

#### Scenario: Signed in as a traveller

- **WHEN** a traveller is signed in
- **THEN** the header shows their name with links to their bookings and to
  sign out

#### Scenario: Signing out

- **WHEN** a user signs out
- **THEN** `POST /v1/auth/logout` is called, the session is cleared, and pages
  needing a session become unreachable again

### Requirement: A suspended account is told why it cannot act

Several endpoints are guarded by `SuspensionGuard`. When one refuses because
the account is suspended, the site SHALL say so rather than showing a generic
failure.

#### Scenario: A suspended traveller tries to book

- **WHEN** the API refuses on account of suspension
- **THEN** the page says the account is suspended and how to get in touch, not
  "something went wrong"
