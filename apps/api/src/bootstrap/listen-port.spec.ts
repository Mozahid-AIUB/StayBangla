import { resolveListenPort } from "./listen-port";

describe("resolveListenPort", () => {
  // Every container host — Render, Cloud Run, Fly, Heroku — injects PORT and
  // then health-checks that port. An app listening anywhere else starts
  // cleanly, answers nothing, and is killed with no error in its own logs to
  // explain why. This is that bug's test.
  it("prefers PORT, because that is what hosts inject", () => {
    expect(resolveListenPort({ PORT: "10000", API_PORT: "3001" })).toBe(10000);
  });

  it("falls back to API_PORT, which is what .env sets locally", () => {
    expect(resolveListenPort({ API_PORT: "3001" })).toBe(3001);
  });

  it("falls back again to 3001 when neither is set", () => {
    expect(resolveListenPort({})).toBe(3001);
  });

  // An empty string is what an unset variable looks like once a shell or a
  // dashboard has passed it through. Number("") is 0, which binds to a random
  // port — the container would come up healthy-looking and be unreachable.
  it("ignores an empty value rather than binding to port 0", () => {
    expect(resolveListenPort({ PORT: "", API_PORT: "3001" })).toBe(3001);
    expect(resolveListenPort({ PORT: "   " })).toBe(3001);
  });

  it("ignores a value that is not a port", () => {
    expect(resolveListenPort({ PORT: "not-a-number" })).toBe(3001);
    expect(resolveListenPort({ PORT: "0" })).toBe(3001);
    expect(resolveListenPort({ PORT: "70000" })).toBe(3001);
  });
});
