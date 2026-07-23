import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SZRouter Admin",
  description: "Operations console for SZRouter.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
