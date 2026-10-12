// Logo Jalonia (repris de l'application d'origine). Les fichiers sont intégrés à la compilation et servis
// avec les fichiers statiques de Next.js : ils s'affichent aussi sur la page de connexion.
import Image, { type StaticImageData } from "next/image";
import logoCouleur from "@/assets/logo-jalonia.svg";
import logoClair from "@/assets/logo-jalonia-clair.svg";

interface Props {
  /** « clair » : pour un fond sombre (bandeau sarcelle) ; « couleur » : pour un fond blanc. */
  variante: "clair" | "couleur";
  largeur: number;
  className?: string;
  prioritaire?: boolean;
}

export function Logo({ variante, largeur, className, prioritaire = false }: Props) {
  const image = (variante === "clair" ? logoClair : logoCouleur) as StaticImageData;
  const hauteur = Math.round((largeur * image.height) / image.width);
  return <Image src={image} alt="Jalonia" width={largeur} height={hauteur} className={className} priority={prioritaire} />;
}
