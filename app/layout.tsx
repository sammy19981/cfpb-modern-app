import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CFPB Complaint Resolution Agent",
  description:
    "Six AI agents working in concert to classify, assess compliance risk, and draft resolutions for consumer financial complaints.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="relative">
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
