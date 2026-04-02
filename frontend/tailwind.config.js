/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        coral: {
          50: '#fef3f0',
          100: '#fde4dd',
          200: '#fcc8b8',
          300: '#f9a488',
          400: '#f07a5e',
          500: '#e8654a',
          600: '#d4553a',
          700: '#b14430',
          800: '#8f3928',
          900: '#753224',
        },
      },
    },
  },
  plugins: [],
}
