import { describe, expect, test } from "vitest";
import { resolveToday } from "./dates";

// 2026-11-04 00:40 UTC is still the evening of Nov 3 in UTC-3.
const NOW = Date.parse("2026-11-04T00:40:00Z");

describe("resolveToday", () => {
  test("defaults to the UTC date when the client sends none", () => {
    expect(resolveToday(undefined, NOW)).toBe("2026-11-04");
  });

  test("accepts any date that is 'today' in some real time zone (UTC-12 to UTC+14)", () => {
    expect(resolveToday("2026-11-03", NOW)).toBe("2026-11-03");
    expect(resolveToday("2026-11-04", NOW)).toBe("2026-11-04");
    // 00:40 UTC + 14h = 14:40 on Nov 4, so Nov 5 is not today anywhere yet.
    expect(() => resolveToday("2026-11-05", NOW)).toThrow(/local date/);
  });

  test("rejects dates no time zone is on, and malformed values", () => {
    expect(() => resolveToday("2026-11-02", NOW)).toThrow(/local date/);
    expect(() => resolveToday("2026-11-3", NOW)).toThrow(/local date/);
  });
});
