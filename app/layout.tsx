import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Assortment Parity Dashboard",
  description: "SKU performance analysis — TIMAURD vs SAFARI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
