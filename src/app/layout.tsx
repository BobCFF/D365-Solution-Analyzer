import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "D365 Solution Analyzer",
  description: "Load Dynamics 365 / Dataverse solutions and patches, find deployment issues, and compare versions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
