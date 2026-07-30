import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#0D1B3E",
          900: "#0A1430",
          800: "#0D1B3E",
          700: "#13264F",
          600: "#1B335F",
        },
        brand: {
          DEFAULT: "#2563EB",
          light: "#2D9CFF",
          dark: "#1D4ED8",
        },
        ok: "#16A34A",
        purpleflow: "#7C3AED",
        amberflow: "#F59E0B",
        danger: "#DC2626",
        page: "#F4F6FA",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-poppins)", "var(--font-inter)", "sans-serif"],
      },
      borderRadius: {
        card: "14px",
      },
    },
  },
  plugins: [],
};
export default config;
