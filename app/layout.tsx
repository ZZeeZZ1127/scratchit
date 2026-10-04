import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "scratchit — reveal a memory",
  description: "Scratch a photo into view and turn it into a palette-matched postcard."
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
