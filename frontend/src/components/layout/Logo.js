export default function Logo({ size = 32, variant = "default" }) {
  // variant: "default" (navy circle, white M) | "light" (white circle, navy M) | "mono"
  const isLight = variant === "light";
  const isMono = variant === "mono";

  const bg = isMono ? "transparent" : isLight ? "#FFFFFF" : "#0B2E4F";
  const stroke = isMono ? "currentColor" : isLight ? "#0B2E4F" : "#FFFFFF";
  const pin = isMono ? "currentColor" : "#F59E0B";
  const border = isMono ? "currentColor" : isLight ? "#0B2E4F" : "#0B2E4F";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Filled circle */}
      <circle
        cx="22"
        cy="22"
        r="20"
        fill={bg}
        stroke={border}
        strokeWidth="1.5"
      />
      {/* M letter — clean geometric */}
      <path
        d="M11 31 V15 L18 25 L22 20 L26 25 L33 15 V31"
        stroke={stroke}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Pin dot — amber accent on the left leg top */}
      <circle cx="33" cy="15" r="2.6" fill={pin} />
      <circle cx="33" cy="15" r="1" fill={isLight ? "#FFFFFF" : "#0B2E4F"} />
    </svg>
  );
}
