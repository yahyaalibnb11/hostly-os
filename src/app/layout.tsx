import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hostly OS",
  description: "AI agent operating system for Hostly's short-term rental co-hosting business.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
