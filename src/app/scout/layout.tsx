import type { Metadata } from "next";

export const metadata: Metadata = { title: "Hostly Scout", description: "Listing research and outreach for the Hostly team." };

export default function ScoutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
