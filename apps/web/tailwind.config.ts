import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ivory: "#F8F4EC",
        page: "#FFFAF3",
        ink: "#1E1B18",
        bronze: "#9A6A43",
        sage: "#51645A",
        plum: "#6A4D5B"
      },
      fontFamily: {
        serif: ["Georgia", "Times New Roman", "serif"],
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      boxShadow: {
        page: "0 28px 90px rgba(30, 27, 24, 0.14)"
      }
    }
  },
  plugins: []
};

export default config;

