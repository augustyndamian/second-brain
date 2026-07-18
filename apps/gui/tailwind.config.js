/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    // No area colors here: they are user data (areas.yaml), applied as inline styles.
    extend: {},
  },
  plugins: [],
};
