/**
 * Country codes that IPTV providers put in front of channel and category names
 * ("PT: Sport TV 1", "UK | News"). Typing one in the search box searches that country.
 */
export interface Country {
  /** Shown in the search box, such as "US". */
  code: string;
  name: string;
  /** Every prefix that marks this country in names, such as ["US", "USA"]. */
  prefixes: string[];
}

const COUNTRIES: Country[] = [
  { code: "US", name: "United States", prefixes: ["US", "USA"] },
  { code: "UK", name: "United Kingdom", prefixes: ["UK", "GB"] },
  { code: "CA", name: "Canada", prefixes: ["CA", "CAN"] },
  { code: "AU", name: "Australia", prefixes: ["AU", "AUS"] },
  { code: "NZ", name: "New Zealand", prefixes: ["NZ"] },
  { code: "IE", name: "Ireland", prefixes: ["IE", "IRL"] },
  { code: "PT", name: "Portugal", prefixes: ["PT", "POR"] },
  { code: "BR", name: "Brazil", prefixes: ["BR", "BRA"] },
  { code: "ES", name: "Spain", prefixes: ["ES", "ESP"] },
  { code: "FR", name: "France", prefixes: ["FR", "FRA"] },
  { code: "DE", name: "Germany", prefixes: ["DE", "GER"] },
  { code: "AT", name: "Austria", prefixes: ["AT", "AUT"] },
  { code: "CH", name: "Switzerland", prefixes: ["CH", "SUI"] },
  { code: "IT", name: "Italy", prefixes: ["IT", "ITA"] },
  { code: "NL", name: "Netherlands", prefixes: ["NL", "NED"] },
  { code: "BE", name: "Belgium", prefixes: ["BE", "BEL"] },
  { code: "LU", name: "Luxembourg", prefixes: ["LU"] },
  { code: "DK", name: "Denmark", prefixes: ["DK", "DEN"] },
  { code: "SE", name: "Sweden", prefixes: ["SE", "SWE"] },
  { code: "NO", name: "Norway", prefixes: ["NO", "NOR"] },
  { code: "FI", name: "Finland", prefixes: ["FI", "FIN"] },
  { code: "IS", name: "Iceland", prefixes: ["IS"] },
  { code: "PL", name: "Poland", prefixes: ["PL", "POL"] },
  { code: "CZ", name: "Czechia", prefixes: ["CZ"] },
  { code: "SK", name: "Slovakia", prefixes: ["SK"] },
  { code: "HU", name: "Hungary", prefixes: ["HU", "HUN"] },
  { code: "RO", name: "Romania", prefixes: ["RO", "ROM"] },
  { code: "BG", name: "Bulgaria", prefixes: ["BG"] },
  { code: "GR", name: "Greece", prefixes: ["GR", "GRE"] },
  { code: "TR", name: "Turkey", prefixes: ["TR", "TUR"] },
  { code: "CY", name: "Cyprus", prefixes: ["CY"] },
  { code: "HR", name: "Croatia", prefixes: ["HR", "CRO"] },
  { code: "RS", name: "Serbia", prefixes: ["RS", "SRB"] },
  { code: "SI", name: "Slovenia", prefixes: ["SI", "SLO"] },
  { code: "BA", name: "Bosnia and Herzegovina", prefixes: ["BA", "BIH"] },
  { code: "MK", name: "North Macedonia", prefixes: ["MK"] },
  { code: "AL", name: "Albania", prefixes: ["AL", "ALB"] },
  { code: "UA", name: "Ukraine", prefixes: ["UA", "UKR"] },
  { code: "RU", name: "Russia", prefixes: ["RU", "RUS"] },
  { code: "LT", name: "Lithuania", prefixes: ["LT"] },
  { code: "LV", name: "Latvia", prefixes: ["LV"] },
  { code: "EE", name: "Estonia", prefixes: ["EE"] },
  { code: "MX", name: "Mexico", prefixes: ["MX", "MEX"] },
  { code: "AR", name: "Argentina", prefixes: ["AR", "ARG"] },
  { code: "CL", name: "Chile", prefixes: ["CL", "CHI"] },
  { code: "CO", name: "Colombia", prefixes: ["CO", "COL"] },
  { code: "PE", name: "Peru", prefixes: ["PE", "PER"] },
  { code: "VE", name: "Venezuela", prefixes: ["VE", "VEN"] },
  { code: "EC", name: "Ecuador", prefixes: ["EC"] },
  { code: "UY", name: "Uruguay", prefixes: ["UY", "URU"] },
  { code: "LATAM", name: "Latin America", prefixes: ["LAT", "LATN"] },
  { code: "IN", name: "India", prefixes: ["IN", "IND"] },
  { code: "PK", name: "Pakistan", prefixes: ["PK", "PAK"] },
  { code: "BD", name: "Bangladesh", prefixes: ["BD"] },
  { code: "CN", name: "China", prefixes: ["CN", "CHN"] },
  { code: "HK", name: "Hong Kong", prefixes: ["HK"] },
  { code: "TW", name: "Taiwan", prefixes: ["TW"] },
  { code: "JP", name: "Japan", prefixes: ["JP", "JPN"] },
  { code: "KR", name: "South Korea", prefixes: ["KR", "KOR"] },
  { code: "PH", name: "Philippines", prefixes: ["PH"] },
  { code: "TH", name: "Thailand", prefixes: ["TH"] },
  { code: "VN", name: "Vietnam", prefixes: ["VN"] },
  { code: "MY", name: "Malaysia", prefixes: ["MY"] },
  { code: "ID", name: "Indonesia", prefixes: ["ID"] },
  { code: "IL", name: "Israel", prefixes: ["IL", "ISR"] },
  { code: "IR", name: "Iran", prefixes: ["IR"] },
  { code: "ARAB", name: "Arabic", prefixes: ["ARAB", "ARA"] },
  { code: "AE", name: "United Arab Emirates", prefixes: ["AE", "UAE"] },
  { code: "SA", name: "Saudi Arabia", prefixes: ["SA", "KSA"] },
  { code: "EG", name: "Egypt", prefixes: ["EG"] },
  { code: "MA", name: "Morocco", prefixes: ["MA"] },
  { code: "DZ", name: "Algeria", prefixes: ["DZ"] },
  { code: "TN", name: "Tunisia", prefixes: ["TN"] },
  { code: "ZA", name: "South Africa", prefixes: ["ZA"] },
  { code: "NG", name: "Nigeria", prefixes: ["NG"] },
  { code: "KE", name: "Kenya", prefixes: ["KE"] },
  { code: "AO", name: "Angola", prefixes: ["AO"] },
  { code: "MZ", name: "Mozambique", prefixes: ["MZ"] },
  { code: "CV", name: "Cape Verde", prefixes: ["CV"] },
];

const BY_PREFIX = new Map<string, Country>();
for (const country of COUNTRIES) {
  for (const prefix of [country.code, ...country.prefixes]) {
    if (!BY_PREFIX.has(prefix)) BY_PREFIX.set(prefix, country);
  }
}

/** The country a search term names, when the whole term is one of its codes ("us", "PT", "USA"). */
export function findCountry(term: string): Country | undefined {
  const code = term.trim().toUpperCase();
  return /^[A-Z]{2,5}$/.test(code) ? BY_PREFIX.get(code) : undefined;
}

/** "PT: Sport TV", "PT | Sports", "|PT| Sports", "PT - Sports" or "[PT] Sports". */
const PREFIX = /^\s*(?:\|\s*([A-Za-z]{2,5})\s*\||\[([A-Za-z]{2,5})\]|([A-Za-z]{2,5})\s*(?:[:|]|\s-))\s*(\S.*)$/;

/**
 * Splits a known country prefix off a name: "PT | Sports" gives { code: "PT", rest: "Sports" }.
 * Names without one come back whole, with no code.
 */
export function splitCountryPrefix(name: string): { code?: string; rest: string } {
  const match = PREFIX.exec(name);
  const prefix = (match?.[1] ?? match?.[2] ?? match?.[3])?.toUpperCase();
  if (!match || !prefix || !BY_PREFIX.has(prefix)) return { rest: name };
  return { code: prefix, rest: match[4] };
}
