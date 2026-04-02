const DAY_COLORS = [
  "#3B82F6", // blue
  "#F97316", // orange
  "#22C55E", // green
  "#EF4444", // red
  "#A855F7", // purple
  "#14B8A6", // teal
  "#EC4899", // pink
  "#F59E0B", // amber
  "#06B6D4", // cyan
  "#84CC16", // lime
];

export function getDayColor(dayNumber) {
  return DAY_COLORS[(dayNumber - 1) % DAY_COLORS.length];
}

export default DAY_COLORS;
