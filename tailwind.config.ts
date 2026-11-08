import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: { extend: { colors: { night: "#0B0F16", facade: "#121824", hairline: "#232C3B", bone: "#E9E4DA", mist: "#9AA3B2", door: { DEFAULT: "#FFB347", hi: "#FFDDA0", deep: "#E8892B" }, pool: { DEFAULT: "#46C2B4", hi: "#A6E6DE", deep: "#2E8F86" }, ember: { 950: "#11100f", 900: "#191715", 800: "#25211d", 700: "#39322b", 500: "#c87945", 400: "#e29a64" } } }, fontFamily: { display: ["Bricolage Grotesque", "Avenir Next", "system-ui", "sans-serif"], brand: ["Instrument Sans", "Segoe UI", "system-ui", "sans-serif"] } },
  plugins: []
};
export default config;
