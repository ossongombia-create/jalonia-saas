"use client";
// Lien de navigation : mis en évidence quand il correspond à la page affichée.
import Link from "next/link";
import { usePathname } from "next/navigation";

export function LienNav({ href, exact = false, children }: { href: string; exact?: boolean; children: React.ReactNode }) {
  const chemin = usePathname();
  const actif = exact ? chemin === href : chemin === href || chemin.startsWith(`${href}/`);
  return (
    <Link href={href} className={actif ? "nav-lien nav-actif" : "nav-lien"} aria-current={actif ? "page" : undefined}>
      {children}
    </Link>
  );
}
