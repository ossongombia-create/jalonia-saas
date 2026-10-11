// Contexte de la requête : qui est connecté, dans quelle organisation, avec quels rôles.
//
// RÈGLE DE SÉCURITÉ : chaque page et chaque action serveur appelle exigerContexte(), exigerSuperadmin()
// ou exigerOrganisation(). Le filtre « proxy » ne fait qu'une redirection rapide quand il n'y a pas de
// cookie : il ne protège RIEN à lui seul.
import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { LANGUE_PAR_DEFAUT, estLangue, traducteur, type Langue, type Traducteur } from "@/lib/i18n";
import { aLeDroit, type Droit, type RoleOrganisation } from "@/lib/rbac";
import { config } from "../config";
import { enTransaction } from "../db/transactions";
import { poolApplication } from "../db/pools";
import { noterOrganisationDeSession, validerSession, type UtilisateurSession } from "../auth/sessions";
import type { Acteur } from "../acteur";
import type { OrganisationCible } from "../membres/service";
import { agentDepuisEntetes, ipDepuisEntetes } from "./reseau";

export const COOKIE_ORGANISATION = "jalonia_organisation";
export const COOKIE_LANGUE = "jalonia_langue";

export interface AdhesionActive extends OrganisationCible {
  nom: string;
  slug: string;
  statut: "active" | "suspendue";
  roles: RoleOrganisation[];
}

export interface Contexte {
  utilisateur: UtilisateurSession;
  sessionId: string;
  langue: Langue;
  t: Traducteur;
  fuseau: string;
  adhesions: AdhesionActive[];
  /** Organisation ouverte (active, dont l'utilisateur est membre), ou null. */
  organisation: AdhesionActive | null;
  acteur: Acteur;
}

export function reglesSession() {
  const c = config();
  return { inactiviteMinutes: c.SESSION_INACTIVITE_MINUTES, dureeMaxHeures: c.SESSION_DUREE_HEURES };
}

async function lireAdhesions(utilisateurId: string): Promise<AdhesionActive[]> {
  return enTransaction(poolApplication(), async (client) => {
    const r = await client.query<{ id: string; nom: string; slug: string; statut: "active" | "suspendue"; schema_name: string; role_name: string; roles: RoleOrganisation[] }>(
      `SELECT o.id, o.nom, o.slug, o.statut, o.schema_name, o.role_name, a.roles
         FROM platform.adhesions a JOIN platform.organisations o ON o.id = a.organisation_id
        WHERE a.utilisateur_id = $1
        ORDER BY o.nom`,
      [utilisateurId],
    );
    return r.rows.map((o) => ({ id: o.id, nom: o.nom, slug: o.slug, statut: o.statut, schemaName: o.schema_name, roleName: o.role_name, roles: o.roles }));
  });
}

/** Lit le contexte (une seule fois par requête grâce à cache()). null si personne n'est connecté. */
export const lireContexte = cache(async (): Promise<Contexte | null> => {
  const session = (await auth()) as { uid?: unknown; sid?: unknown } | null;
  if (!session || typeof session.uid !== "string" || typeof session.sid !== "string") return null;

  const valide = await validerSession(poolApplication(), { utilisateurId: session.uid, sessionId: session.sid }, reglesSession());
  if (!valide) return null;
  const { utilisateur } = valide;

  const adhesions = await lireAdhesions(utilisateur.id);
  const actives = adhesions.filter((a) => a.statut === "active");
  const choisie = (await cookies()).get(COOKIE_ORGANISATION)?.value;
  const organisation = actives.find((a) => a.id === choisie) ?? (actives.length === 1 ? actives[0]! : null);

  // Suivi d'activité : l'organisation ouverte est notée dans la session (écriture seulement si elle change).
  if (organisation && organisation.id !== valide.organisationId) {
    await noterOrganisationDeSession(poolApplication(), session.sid, organisation.id);
  }

  const entetes = await headers();
  return {
    utilisateur,
    sessionId: session.sid,
    langue: utilisateur.langue,
    t: traducteur(utilisateur.langue),
    fuseau: config().FUSEAU_HORAIRE,
    adhesions,
    organisation,
    acteur: { id: utilisateur.id, email: utilisateur.email, ip: ipDepuisEntetes(entetes), agent: agentDepuisEntetes(entetes) },
  };
});

/** Langue d'affichage, connecté ou non (cookie, sinon français). */
export const lireLangue = cache(async (): Promise<Langue> => {
  const ctx = await lireContexte();
  if (ctx) return ctx.langue;
  const cookie = (await cookies()).get(COOKIE_LANGUE)?.value;
  return estLangue(cookie) ? cookie : LANGUE_PAR_DEFAUT;
});

/** Exige une session valide. Sans session : page de connexion. Mot de passe provisoire : changement obligatoire. */
export async function exigerContexte(options: { permettreMdpProvisoire?: boolean } = {}): Promise<Contexte> {
  const ctx = await lireContexte();
  if (!ctx) redirect("/connexion");
  if (ctx.utilisateur.doitChangerMdp && !options.permettreMdpProvisoire) redirect("/compte/mot-de-passe");
  return ctx;
}

/** Exige le rôle SUPERADMIN_PLATFORM. Sinon : « page introuvable » (on ne révèle pas l'existence de l'espace). */
export async function exigerSuperadmin(): Promise<Contexte> {
  const ctx = await exigerContexte();
  if (!ctx.utilisateur.estSuperadmin) notFound();
  return ctx;
}

export type ContexteOrganisation = Contexte & { organisation: AdhesionActive };

/** Exige une organisation ouverte (et, si demandé, un droit dans cette organisation). */
export async function exigerOrganisation(droit?: Droit): Promise<ContexteOrganisation> {
  const ctx = await exigerContexte();
  if (!ctx.organisation) redirect("/choisir-organisation");
  if (droit && !aLeDroit(ctx.organisation.roles, droit)) notFound();
  return ctx as ContexteOrganisation;
}

/** Page d'accueil selon le profil. */
export function accueilDe(ctx: Contexte): string {
  if (ctx.utilisateur.doitChangerMdp) return "/compte/mot-de-passe";
  if (ctx.utilisateur.estSuperadmin) return "/plateforme";
  if (ctx.organisation) return "/app";
  return "/choisir-organisation";
}
