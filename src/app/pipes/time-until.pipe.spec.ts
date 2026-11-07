import { TimeUntilPipe } from "./time-until.pipe";

describe("TimeUntilPipe", () => {
  const now = new Date(2026, 0, 15, 12, 0, 0);
  const pipe = new TimeUntilPipe();
  const day = 86400 * 1000;
  const inMs = (ms: number) => new Date(now.getTime() + ms);

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(now);
  });
  afterEach(() => jasmine.clock().uninstall());

  it("shows nothing without a date", () => {
    expect(pipe.transform(null)).toBe("");
  });

  it("marks dates in the past as expired", () => {
    expect(pipe.transform(inMs(-day))).toBe("Expired (January 14th 2026)");
  });

  it("says 'less than an hour' for the next hour", () => {
    expect(pipe.transform(inMs(30 * 60 * 1000))).toBe("In less than an hour (January 15th 2026)");
  });

  it("uses the largest whole unit", () => {
    expect(pipe.transform(inMs(3 * 3600 * 1000))).toBe("In 3 hours (January 15th 2026)");
    expect(pipe.transform(inMs(day))).toBe("In 1 day (January 16th 2026)");
    expect(pipe.transform(inMs(8 * day))).toBe("In 1 week (January 23rd 2026)");
    expect(pipe.transform(inMs(45 * day))).toBe("In 1 month (March 1st 2026)");
    expect(pipe.transform(inMs(400 * day))).toBe("In 1 year (February 19th 2027)");
  });

  it("gives each day of the month the right ordinal suffix", () => {
    const suffix = (dayOfMonth: number) =>
      pipe.transform(new Date(2026, 6, dayOfMonth)).match(/July (\d+\w+) 2026/)![1];
    expect(["1", "2", "3", "4", "11", "12", "13", "21", "22", "23", "31"].map((d) => suffix(+d))).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st",
    ]);
  });
});
