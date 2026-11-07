import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offer Desk", description: "NBA Investments MLS deal finder" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
