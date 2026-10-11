"use client";
// Bascule français / anglais (revient sur la page en cours).
import { usePathname } from "next/navigation";
import type { Langue } from "@/lib/i18n";

export function ChoixLangue({ action, langue, libelle }: { action: (donnees: FormData) => Promise<void>; langue: Langue; libelle: string }) {
  const chemin = usePathname();
  return (
    <form action={action} className="choix-langue" aria-label={libelle}>
      <input type="hidden" name="retour" value={chemin} />
      <button type="submit" name="langue" value="fr" className={langue === "fr" ? "langue langue-active" : "langue"} aria-pressed={langue === "fr"}>
        FR
      </button>
      <button type="submit" name="langue" value="en" className={langue === "en" ? "langue langue-active" : "langue"} aria-pressed={langue === "en"}>
        EN
      </button>
    </form>
  );
}
