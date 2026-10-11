import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "D365 Solution Analyzer",
  description: "Load Dynamics 365 / Dataverse solutions and patches, find deployment issues, and compare versions.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en">
      <head>
        {/* Paint the saved theme before first render to avoid a flash. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("d365-sa-theme");if(t&&t!=="system")document.documentElement.setAttribute("data-theme",t)}catch(e){}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
