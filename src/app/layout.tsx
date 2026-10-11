import type { Metadata } from "next";
import { lireLangue } from "@/server/web/contexte";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Jalonia", template: "%s · Jalonia" },
  description: "Documentation des processus selon le langage Qualigramme",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const langue = await lireLangue();
  return (
    <html lang={langue}>
      <body>{children}</body>
    </html>
  );
}
