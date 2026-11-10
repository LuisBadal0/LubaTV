import { findCountry, splitCountryPrefix } from "./countries";

describe("countries", () => {
  it("finds a country from its code in any case", () => {
    expect(findCountry("US")?.name).toBe("United States");
    expect(findCountry(" pt ")?.name).toBe("Portugal");
    expect(findCountry("usa")?.code).toBe("US");
  });

  it("searches every prefix that marks the country", () => {
    expect(findCountry("UK")?.prefixes).toEqual(["UK", "GB"]);
  });

  it("ignores terms that are not a whole code", () => {
    expect(findCountry("sport")).toBeUndefined();
    expect(findCountry("US news")).toBeUndefined();
    expect(findCountry("")).toBeUndefined();
  });

  it("splits a country prefix off a name", () => {
    expect(splitCountryPrefix("PT | Sports")).toEqual({ code: "PT", rest: "Sports" });
    expect(splitCountryPrefix("PT: SPORT TV 1")).toEqual({ code: "PT", rest: "SPORT TV 1" });
    expect(splitCountryPrefix("|UK| News")).toEqual({ code: "UK", rest: "News" });
    expect(splitCountryPrefix("[us] Local")).toEqual({ code: "US", rest: "Local" });
    expect(splitCountryPrefix("FR - Cinema")).toEqual({ code: "FR", rest: "Cinema" });
  });

  it("leaves names without a known prefix whole", () => {
    expect(splitCountryPrefix("ABC: Boston WCVB")).toEqual({ rest: "ABC: Boston WCVB" });
    expect(splitCountryPrefix("Sports")).toEqual({ rest: "Sports" });
  });
});
