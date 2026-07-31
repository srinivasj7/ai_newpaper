/* Edition dates are plain YYYY-MM-DD. Parsing them at noon keeps the displayed day from
   sliding backwards in timezones behind UTC. */

const at = (date) => new Date(`${date}T12:00:00`);

export const longDate = (date) =>
  at(date).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

export const archiveDate = (date) =>
  at(date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

export const todayShort = () =>
  new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
