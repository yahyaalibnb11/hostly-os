import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: { extend: { colors: { ember: { 950: "#11100f", 900: "#191715", 800: "#25211d", 700: "#39322b", 500: "#c87945", 400: "#e29a64" } } } },
  plugins: []
};
export default config;
