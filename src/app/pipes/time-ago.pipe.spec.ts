import { TimeAgoPipe } from "./time-ago.pipe";

describe("TimeAgoPipe", () => {
  const now = new Date(2026, 0, 15, 12, 0, 0);
  const pipe = new TimeAgoPipe();
  const secondsAgo = (seconds: number) => new Date(now.getTime() - seconds * 1000);

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(now);
  });
  afterEach(() => jasmine.clock().uninstall());

  it("shows nothing without a date", () => {
    expect(pipe.transform(null)).toBe("");
    expect(pipe.transform(undefined)).toBe("");
  });

  it("says 'Just now' for the last half minute", () => {
    expect(pipe.transform(secondsAgo(0))).toBe("Just now");
    expect(pipe.transform(secondsAgo(28))).toBe("Just now");
  });

  it("counts seconds, minutes, hours and days", () => {
    expect(pipe.transform(secondsAgo(45))).toBe("45 seconds ago");
    expect(pipe.transform(secondsAgo(60))).toBe("1 minute ago");
    expect(pipe.transform(secondsAgo(150))).toBe("2 minutes ago");
    expect(pipe.transform(secondsAgo(3600))).toBe("1 hour ago");
    expect(pipe.transform(secondsAgo(5 * 3600))).toBe("5 hours ago");
    expect(pipe.transform(secondsAgo(86400))).toBe("1 day ago");
    expect(pipe.transform(secondsAgo(40 * 86400))).toBe("40 days ago");
  });

  it("accepts timestamps and date strings", () => {
    expect(pipe.transform(secondsAgo(120).getTime())).toBe("2 minutes ago");
    expect(pipe.transform(secondsAgo(120).toISOString())).toBe("2 minutes ago");
  });
});
