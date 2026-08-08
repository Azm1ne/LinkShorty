import { describe, expect, it } from "vitest";
import { clampExpiry, formatExpiry } from "./expiry";

describe("clampExpiry", () => {
  it("returns 0 for 0 (permanent)", () => {
    expect(clampExpiry(0)).toEqual({ minutes: 0, clamped: false });
  });

  it("accepts values in range", () => {
    expect(clampExpiry(60)).toEqual({ minutes: 60, clamped: false });
    expect(clampExpiry(1440)).toEqual({ minutes: 1440, clamped: false });
    expect(clampExpiry(43200)).toEqual({ minutes: 43200, clamped: false });
  });

  it("clamps below 1 minute to 1", () => {
    expect(clampExpiry(0.5)).toEqual({
      minutes: 1,
      clamped: true,
      direction: "min",
    });
    expect(clampExpiry(-5)).toEqual({
      minutes: 1,
      clamped: true,
      direction: "min",
    });
  });

  it("clamps above 43200 to 43200", () => {
    expect(clampExpiry(99999)).toEqual({
      minutes: 43200,
      clamped: true,
      direction: "max",
    });
  });

  it("treats NaN as below 1", () => {
    expect(clampExpiry(NaN)).toEqual({
      minutes: 1,
      clamped: true,
      direction: "min",
    });
  });

  it("treats Infinity as beyond max", () => {
    expect(clampExpiry(Infinity)).toEqual({
      minutes: 43200,
      clamped: true,
      direction: "max",
    });
  });

  it("floors fractional values within range", () => {
    expect(clampExpiry(60.9)).toEqual({ minutes: 60, clamped: false });
  });
});

describe("formatExpiry", () => {
  const now = new Date("2026-08-08T12:00:00Z");

  it("formats minutes", () => {
    const exp = new Date("2026-08-08T12:45:00Z");
    expect(formatExpiry(now, exp)).toBe("45 minutes from now");
  });

  it("uses singular for one minute", () => {
    const exp = new Date("2026-08-08T12:01:00Z");
    expect(formatExpiry(now, exp)).toBe("1 minute from now");
  });

  it("formats hours", () => {
    const exp = new Date("2026-08-08T15:00:00Z");
    expect(formatExpiry(now, exp)).toBe("3 hours from now");
  });

  it("uses singular for one hour", () => {
    const exp = new Date("2026-08-08T13:00:00Z");
    expect(formatExpiry(now, exp)).toBe("1 hour from now");
  });

  it("formats days", () => {
    const exp = new Date("2026-08-11T12:00:00Z");
    expect(formatExpiry(now, exp)).toBe("3 days from now");
  });

  it("uses singular for one day", () => {
    const exp = new Date("2026-08-09T12:00:00Z");
    expect(formatExpiry(now, exp)).toBe("1 day from now");
  });

  it("returns 'Already expired' for past dates", () => {
    const exp = new Date("2026-08-08T11:00:00Z");
    expect(formatExpiry(now, exp)).toBe("Already expired");
  });

  it("returns 'Less than a minute from now' for very near futures", () => {
    const exp = new Date("2026-08-08T12:00:30Z");
    expect(formatExpiry(now, exp)).toBe("Less than a minute from now");
  });
});