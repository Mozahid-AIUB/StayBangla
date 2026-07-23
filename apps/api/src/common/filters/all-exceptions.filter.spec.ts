import { ArgumentsHost, HttpException, HttpStatus } from "@nestjs/common";
import { AllExceptionsFilter } from "./all-exceptions.filter";

function createMockHost(url = "/test"): {
  host: ArgumentsHost;
  status: jest.Mock;
  json: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const request = { method: "GET", url };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe("AllExceptionsFilter", () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
  });

  it("maps HttpException to its status code and message", () => {
    const { host, status, json } = createMockHost("/bookings/123");

    filter.catch(new HttpException("Booking not found", HttpStatus.NOT_FOUND), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: "Booking not found",
        path: "/bookings/123",
      }),
    );
  });

  it("preserves validation-style array messages from HttpException response objects", () => {
    const { host, status, json } = createMockHost();

    filter.catch(
      new HttpException(
        { message: ["email must be an email", "password is too short"], error: "Bad Request" },
        HttpStatus.BAD_REQUEST,
      ),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        error: "Bad Request",
        message: ["email must be an email", "password is too short"],
      }),
    );
  });

  it("hides internal error details for unknown exceptions and returns 500", () => {
    const { host, status, json } = createMockHost();

    filter.catch(new Error("Sensitive DB connection string leaked here"), host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.message).toBe("An unexpected error occurred");
    expect(JSON.stringify(body)).not.toContain("Sensitive DB connection string");
  });

  it("includes an ISO timestamp in every response", () => {
    const { host, json } = createMockHost();

    filter.catch(new HttpException("x", HttpStatus.BAD_REQUEST), host);

    const body = json.mock.calls[0][0];
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});
