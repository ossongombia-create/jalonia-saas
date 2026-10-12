import type { Metadata, Viewport } from "next";
import { lireLangue } from "@/server/web/contexte";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Jalonia", template: "%s · Jalonia" },
  applicationName: "Jalonia",
  description: "Documentation des processus selon le langage Qualigramme",
  robots: { index: false, follow: false },
  // Ajout à l'écran d'accueil (iPhone, iPad) : nom affiché sous l'icône.
  appleWebApp: { capable: true, title: "Jalonia", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#005a70",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const langue = await lireLangue();
  return (
    <html lang={langue}>
      <body>{children}</body>
    </html>
  );
}
