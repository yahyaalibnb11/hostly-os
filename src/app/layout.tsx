import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hostly OS",
  description: "AI helpers that run your short-term rental listings with you.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
