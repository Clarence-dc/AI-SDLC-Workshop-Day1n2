import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Daylight · Todo",
  description: "A calmer place for your tasks. Built around Singapore time.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
