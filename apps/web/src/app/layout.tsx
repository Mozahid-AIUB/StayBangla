import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_Bengali } from "next/font/google";
import "./globals.css";

// Bengali leads: most user-facing copy is Bangla, and neither Geist nor any
// Latin-only face carries the Bengali block (U+0980–U+09FF) — without this the
// site renders tofu boxes. Variable font, so no explicit weight is needed.
const notoSansBengali = Noto_Sans_Bengali({
  variable: "--font-bengali",
  subsets: ["bengali", "latin"],
  display: "swap",
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "StayBangla — বাংলাদেশ ঘুরে দেখুন",
  description:
    "সেন্ট মার্টিন থেকে সাজেক, সুন্দরবন থেকে শ্রীমঙ্গল — বাংলাদেশের ১৬টি গন্তব্যে হোটেল ও গাড়ি বুক করুন।",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="bn"
      className={`${notoSansBengali.variable} ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="bg-background text-foreground flex min-h-full flex-col">
        {children}
      </body>
    </html>
  );
}
