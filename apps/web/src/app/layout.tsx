import type { Metadata } from "next";
import { Geist, Red_Hat_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Providers } from "./providers";
import "./globals.css";

// Self-hosted at build time by next/font; exposed as CSS variables used by globals.css.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const redHatMono = Red_Hat_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-red-hat-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Collara", template: "%s · Collara" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // data-scroll-behavior: Next 16 then turns off the marketing pages' smooth scroll during route changes.
    <html lang="en" data-scroll-behavior="smooth" className={cn("dark", geist.variable, redHatMono.variable)}>
      <body>
        <Providers>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
