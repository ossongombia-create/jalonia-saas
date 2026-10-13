// Cookies de confort posés par l'application (langue, organisation ouverte) : jamais lisibles par un script,
// envoyés seulement en HTTPS en production, et pas lors d'une navigation lancée depuis un autre site (sauf lien).
import "server-only";
import { cookies } from "next/headers";
import { COOKIE_LANGUE, COOKIE_ORGANISATION } from "./contexte";

const OPTIONS = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };

export async function poserCookieLangue(langue: string): Promise<void> {
  (await cookies()).set(COOKIE_LANGUE, langue, { ...OPTIONS, maxAge: 365 * 24 * 3600 });
}

export async function poserCookieOrganisation(organisationId: string): Promise<void> {
  (await cookies()).set(COOKIE_ORGANISATION, organisationId, { ...OPTIONS, maxAge: 30 * 24 * 3600 });
}
