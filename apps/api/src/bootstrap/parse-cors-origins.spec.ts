import { parseCorsOrigins } from "./parse-cors-origins";

describe("parseCorsOrigins", () => {
  it("splits a comma-separated origin list and trims whitespace", () => {
    expect(parseCorsOrigins("http://localhost:3000, https://staybangla.com")).toEqual([
      "http://localhost:3000",
      "https://staybangla.com",
    ]);
  });

  it("returns a single-element array for one origin", () => {
    expect(parseCorsOrigins("http://localhost:3000")).toEqual(["http://localhost:3000"]);
  });

  it("drops empty entries caused by trailing commas", () => {
    expect(parseCorsOrigins("http://localhost:3000,")).toEqual(["http://localhost:3000"]);
  });
});
