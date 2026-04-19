export default function Logo({ size = 32, color }) {
  // Default: deep navy ring + amber pins (premium travel feel).
  // Pass color="white" for use over dark hero.
  const stroke = color || "#0B2E4F";
  const pin = "#F59E0B";
  const pinAccent = "#D97706";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Ring */}
      <circle cx="20" cy="20" r="19" stroke={stroke} strokeWidth="2" fill="none" />
      {/* Route — inverted V */}
      <path
        d="M12 12 L20 30 L28 12"
        stroke={stroke}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Waypoints */}
      <circle cx="12" cy="12" r="2.5" fill={pin} />
      <circle cx="28" cy="12" r="2.5" fill={pin} />
      <circle cx="20" cy="30" r="2.8" fill={pinAccent} />
    </svg>
  );
}
