import { db, holidayDB } from "../lib/db";
// Sources: https://www.mom.gov.sg/employment-practices/public-holidays
// https://www.mom.gov.sg/newsroom/press-releases/2025/0616-public-holidays-for-2026
// Observed Mondays are included; Hari Raya dates remain subject to MOM confirmation.
const holidays: [string, string][] = [
  ["2026-01-01", "New Year's Day"],
  ["2026-02-17", "Chinese New Year"],
  ["2026-02-18", "Chinese New Year"],
  ["2026-03-21", "Hari Raya Puasa"],
  ["2026-04-03", "Good Friday"],
  ["2026-05-01", "Labour Day"],
  ["2026-05-27", "Hari Raya Haji"],
  ["2026-05-31", "Vesak Day"],
  ["2026-06-01", "Vesak Day (observed)"],
  ["2026-08-09", "National Day"],
  ["2026-08-10", "National Day (observed)"],
  ["2026-11-08", "Deepavali"],
  ["2026-11-09", "Deepavali (observed)"],
  ["2026-12-25", "Christmas Day"],
  ["2027-01-01", "New Year's Day"],
  ["2027-02-06", "Chinese New Year"],
  ["2027-02-07", "Chinese New Year"],
  ["2027-02-08", "Chinese New Year (observed)"],
  ["2027-03-10", "Hari Raya Puasa"],
  ["2027-03-26", "Good Friday"],
  ["2027-05-01", "Labour Day"],
  ["2027-05-17", "Hari Raya Haji"],
  ["2027-05-20", "Vesak Day"],
  ["2027-08-09", "National Day"],
  ["2027-10-28", "Deepavali"],
  ["2027-12-25", "Christmas Day"],
];
db.transaction(() => {
  for (const [date, name] of holidays) holidayDB.seed(date, name);
})();
process.stdout.write(
  `Seeded ${holidays.length} Singapore holidays for 2026–2027.\n`,
);
