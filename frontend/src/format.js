/* Edition dates are plain YYYY-MM-DD. Parsing them at noon keeps the displayed day from
   sliding backwards in timezones behind UTC. */

const at = (date) => new Date(`${date}T12:00:00`);

export const longDate = (date) =>
  at(date).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

export const archiveDate = (date) =>
  at(date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

export const todayShort = () =>
  new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export const shortDate = (date) => at(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Whole days between an edition's date and today. Negative is impossible in practice; treat it as 0. */
export const daysOld = (date) => {
  const ms = at(new Date().toISOString().slice(0, 10)) - at(date);
  return Math.max(0, Math.round(ms / 86_400_000));
};

/** "Today", "Yesterday", "3 days ago" — the age of the paper, in the reader's terms. */
export const ageLabel = (date) => {
  const d = daysOld(date);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  return `${d} days ago`;
};
