export default function Logo({ size = 32 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Abstract route / compass "V" shape */}
      <circle cx="20" cy="20" r="19" stroke="#e8654a" strokeWidth="2" fill="none" />
      <path
        d="M12 12 L20 30 L28 12"
        stroke="#e8654a"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="12" cy="12" r="2.5" fill="#e8654a" />
      <circle cx="28" cy="12" r="2.5" fill="#e8654a" />
      <circle cx="20" cy="30" r="2.5" fill="#d4553a" />
    </svg>
  );
}
