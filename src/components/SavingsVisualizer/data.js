import dayjs from "dayjs";

export const coverageDescriptions = {
  existing: {
    label: "Existing Commitments",
    description: "Commitments already in place.",
  },
  current: {
    label: "Current Recommendations",
    description: "Recommendations you can act on now.",
  },
  projected: {
    label: "Future Recommendations",
    description: "Recommendations to act on later to maintain coverage.",
  },
};

export const DEMO_COMMITMENTS = [
  { startMonthOffset: -10, endMonthOffset: 2, percentage: 25 },
  { startMonthOffset: -3, endMonthOffset: 9, percentage: 15 },
  { startMonthOffset: -1, endMonthOffset: 35, percentage: 20 },
];

const PAST_MONTHS = 12;
const FUTURE_MONTHS = 24;

export function buildGraphData(commitments, minCoverage, maxCoverage) {
  const now = dayjs().startOf("month");
  const items = [];

  for (let m = -PAST_MONTHS; m <= FUTURE_MONTHS; m++) {
    const existing = commitments
      .filter((c) => m >= c.startMonthOffset && m < c.endMonthOffset)
      .reduce((sum, c) => sum + c.percentage, 0);

    let current = 0;
    let projected = 0;

    if (m >= 0) {
      if (existing < minCoverage) {
        current = minCoverage - existing;
        projected = Math.max(0, maxCoverage - minCoverage);
      } else if (existing < maxCoverage) {
        projected = maxCoverage - existing;
      }
    }

    items.push({ date: now.add(m, "month"), existing, current, projected });
  }

  return items;
}

export function calculateDateRange(items) {
  const dates = items.map((d) => d.date.toDate().valueOf());
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const numMonths = items.length;
  return { minDate, maxDate, numMonths };
}
