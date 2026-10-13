// Affichage des valeurs QSE (indicateurs) : nombres et objectifs selon la langue.
import type { Langue, Traducteur } from "./i18n";
import type { SensObjectif } from "./qse";

export function formaterNombre(langue: Langue, n: number): string {
  return new Intl.NumberFormat(langue === "en" ? "en-GB" : "fr-FR", { maximumFractionDigits: 4 }).format(n);
}

/** « au moins 95 % », « at most 3 days ». */
export function texteObjectif(t: Traducteur, langue: Langue, o: { sens: SensObjectif; seuil: number; unite: string }): string {
  return t("indicateurs.objectif_texte", { sens: t(`indicateurs.sens.${o.sens}`), seuil: formaterNombre(langue, o.seuil), unite: o.unite }).trim();
}
