/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Single family — Inter — plus system fallbacks. Montserrat and
        // Space Grotesk were listed but never actually referenced; dropping
        // them saves 180 KB of font payload and 2 extra HTTP requests.
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Helvetica Neue",
          "sans-serif",
        ],
        display: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        serif: ["Georgia", "serif"],
      },
      colors: {
        // Primary brand — deep navy (trust, premium travel)
        navy: {
          50: "#F1F5F9",
          100: "#E2E8F0",
          200: "#CBD5E1",
          300: "#94A3B8",
          400: "#64748B",
          500: "#475569",
          600: "#1E3A5F",
          700: "#15314F",
          800: "#0B2E4F", // brand primary
          900: "#0A2642",
          950: "#06182C",
        },
        // Accent — sunset amber / gold
        // Kept under "coral" name for backward-compat (many files reference coral-500)
        coral: {
          50: "#FFFBEB",
          100: "#FEF3C7",
          200: "#FDE68A",
          300: "#FCD34D",
          400: "#FBBF24",
          500: "#F59E0B", // brand accent
          600: "#D97706",
          700: "#B45309",
          800: "#92400E",
          900: "#78350F",
        },
        // Also expose as amber/gold aliases
        brand: {
          DEFAULT: "#F59E0B",
          navy: "#0B2E4F",
          cream: "#FAF8F3",
          ink: "#0F172A",
        },
        cream: {
          50: "#FFFDF8",
          100: "#FAF8F3",
          200: "#F5F1E8",
          300: "#EDE6D5",
        },
      },
      boxShadow: {
        "premium": "0 30px 60px -15px rgba(11, 46, 79, 0.35)",
        "gold": "0 20px 45px -12px rgba(245, 158, 11, 0.55)",
      },
    },
  },
  plugins: [],
};
