import type { Metadata } from "next";
import { DM_Sans, Noto_Sans_Tamil } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"] });
const notoTamil = Noto_Sans_Tamil({ variable: "--font-noto-tamil", subsets: ["tamil"], weight: ["400", "600"] });

export const metadata: Metadata = {
  title: { default: "Scam Shield", template: "%s · Scam Shield" },
  description: "Real-time decisions that stop payment scams before the money leaves.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${dmSans.variable} ${notoTamil.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
