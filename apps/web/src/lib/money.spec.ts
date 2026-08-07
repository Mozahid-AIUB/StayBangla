import { formatMoney, formatMoneyBn, minorToMajor } from "./money";

describe("minorToMajor", () => {
  // The whole point. 350000 poisha is 3,500 taka — reading it as 350,000 is a
  // hundredfold error, and it is the plausible-looking one: a room at ৳350,000
  // a night is absurd, but a page that renders it does not look broken.
  it("divides by a hundred", () => {
    expect(minorToMajor(350000)).toBe(3500);
    expect(minorToMajor(1)).toBe(0.01);
    expect(minorToMajor(0)).toBe(0);
  });

  it("keeps the paisa", () => {
    expect(minorToMajor(350050)).toBe(3500.5);
  });
});

describe("formatMoney", () => {
  it("writes taka with the sign and grouped digits", () => {
    expect(formatMoney(350000, "BDT")).toBe("৳3,500");
  });

  it("drops the paisa when there is none, and keeps it when there is", () => {
    expect(formatMoney(350000, "BDT")).toBe("৳3,500");
    expect(formatMoney(350050, "BDT")).toBe("৳3,500.50");
  });

  it("groups large amounts", () => {
    expect(formatMoney(125000000, "BDT")).toBe("৳1,250,000");
  });

  it("handles zero", () => {
    expect(formatMoney(0, "BDT")).toBe("৳0");
  });

  // Every price in the database carries its own currency column. Assuming BDT
  // and hardcoding the sign would silently mislabel anything else.
  it("uses the currency it is given", () => {
    expect(formatMoney(350000, "USD")).toContain("3,500");
    expect(formatMoney(350000, "USD")).not.toContain("৳");
  });
});

describe("formatMoneyBn", () => {
  // Bengali numerals, because the rest of the Bengali page is in them. A price
  // in Latin digits inside a Bengali sentence reads as a different language
  // mid-sentence.
  it("writes the digits in Bengali", () => {
    expect(formatMoneyBn(350000, "BDT")).toBe("৳৩,৫০০");
  });

  it("converts every digit, including the paisa", () => {
    expect(formatMoneyBn(350050, "BDT")).toBe("৳৩,৫০০.৫০");
  });

  it("keeps the grouping separators as they are", () => {
    expect(formatMoneyBn(125000000, "BDT")).toBe("৳১,২৫০,০০০");
  });

  it("handles zero", () => {
    expect(formatMoneyBn(0, "BDT")).toBe("৳০");
  });
});
