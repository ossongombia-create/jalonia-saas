// Comptes utilisateurs : consultation et gestion par le superadmin, mot de passe et langue par l'utilisateur.
// Les comptes superadministrateurs ne se gèrent PAS depuis l'interface (ligne de commande sur le serveur) :
// un compte superadmin compromis ne peut pas désactiver ou reprendre les autres.
import type { Pool, PoolClient } from "pg";
import type { Langue } from "@/lib/i18n";
import type { RoleOrganisation } from "@/lib/rbac";
import { dansOrganisation, enTransaction } from "../db/transactions";
import { journaliserOrganisation, journaliserPlateforme } from "../audit/journal";
import { controlerMotDePasse, hacherMotDePasse, verifierMotDePasse } from "../auth/motdepasse";
import { ECHECS_AVANT_VERROU, MINUTES_DE_VERROU } from "../auth/connexion";
import { revoquerSessionsDe, type ReglesSession } from "../auth/sessions";
import { ErreurMetier } from "../erreurs";
import { traceActeur, type Acteur } from "../acteur";

export interface UtilisateurResume {
  id: string;
  email: string;
  nom: string;
  estSuperadmin: boolean;
  statut: "actif" | "desactive";
  doitChangerMdp: boolean;
  mfaActif: boolean;
  verrouilleJusqua: Date | null;
  derniereConnexion: Date | null;
  creeLe: Date;
  organisations: string[];
  sessionsOuvertes: number;
  secondes30j: number;
}

export function listerUtilisateurs(pool: Pool, regles: ReglesSession): Promise<UtilisateurResume[]> {
  return enTransaction(pool, (client) => lireResumes(client, regles, null));
}

async function lireResumes(client: PoolClient, regles: ReglesSession, seulementId: string | null): Promise<UtilisateurResume[]> {
  const r = await client.query<{
    id: string; email: string; nom: string; est_superadmin: boolean; statut: "actif" | "desactive"; doit_changer_mdp: boolean; mfa_actif: boolean;
    verrouille_jusqua: Date | null; derniere_connexion: Date | null; cree_le: Date; organisations: string[]; sessions_ouvertes: number; secondes_30j: number;
  }>(
    `SELECT u.id, u.email, u.nom, u.est_superadmin, u.statut, u.doit_changer_mdp, u.mfa_active_le IS NOT NULL AS mfa_actif,
            CASE WHEN u.verrouille_jusqua > now() THEN u.verrouille_jusqua END AS verrouille_jusqua,
            u.derniere_connexion, u.cree_le,
            COALESCE((SELECT array_agg(o.nom ORDER BY o.nom)
                        FROM platform.adhesions a JOIN platform.organisations o ON o.id = a.organisation_id
                       WHERE a.utilisateur_id = u.id), '{}') AS organisations,
            (SELECT count(*)::int FROM platform.sessions s
              WHERE s.utilisateur_id = u.id AND s.fin IS NULL
                AND s.derniere_activite >= now() - ($1::int * interval '1 minute')
                AND s.debut >= now() - ($2::int * interval '1 hour')) AS sessions_ouvertes,
            (SELECT COALESCE(sum(extract(epoch FROM (COALESCE(s.fin, s.derniere_activite) - s.debut))), 0)::int
               FROM platform.sessions s
              WHERE s.utilisateur_id = u.id AND s.debut >= now() - interval '30 days') AS secondes_30j
       FROM platform.utilisateurs u
      WHERE ($3::uuid IS NULL OR u.id = $3::uuid)
      ORDER BY u.nom, u.email`,
    [regles.inactiviteMinutes, regles.dureeMaxHeures, seulementId],
  );
  return r.rows.map((u) => ({
    id: u.id, email: u.email, nom: u.nom, estSuperadmin: u.est_superadmin, statut: u.statut, doitChangerMdp: u.doit_changer_mdp, mfaActif: u.mfa_actif,
    verrouilleJusqua: u.verrouille_jusqua, derniereConnexion: u.derniere_connexion, creeLe: u.cree_le,
    organisations: u.organisations, sessionsOuvertes: u.sessions_ouvertes, secondes30j: u.secondes_30j,
  }));
}

export interface AdhesionUtilisateur {
  organisationId: string;
  nom: string;
  slug: string;
  statutOrganisation: "active" | "suspendue";
  roles: RoleOrganisation[];
}

export interface FicheUtilisateur extends UtilisateurResume {
  langue: Langue;
  adhesions: AdhesionUtilisateur[];
}

/** Fiche d'un utilisateur. `id` doit être un UUID valide (vérifié par l'appelant). */
export async function lireUtilisateur(pool: Pool, id: string, regles: ReglesSession): Promise<FicheUtilisateur | null> {
  return enTransaction(pool, async (client) => {
    const u = (await lireResumes(client, regles, id))[0];
    if (!u) return null;
    const l = await client.query<{ langue: Langue }>("SELECT langue FROM platform.utilisateurs WHERE id = $1", [id]);
    const a = await client.query<{ id: string; nom: string; slug: string; statut: "active" | "suspendue"; roles: RoleOrganisation[] }>(
      `SELECT o.id, o.nom, o.slug, o.statut, a.roles
         FROM platform.adhesions a JOIN platform.organisations o ON o.id = a.organisation_id
        WHERE a.utilisateur_id = $1 ORDER BY o.nom`,
      [id],
    );
    return {
      ...u,
      langue: l.rows[0]?.langue ?? "fr",
      adhesions: a.rows.map((o) => ({ organisationId: o.id, nom: o.nom, slug: o.slug, statutOrganisation: o.statut, roles: o.roles })),
    };
  });
}

/** Vérifie que le compte visé peut être géré depuis l'interface par cet acteur. */
async function cibleGerable(pool: Pool, cibleId: string, acteur: Acteur): Promise<{ email: string }> {
  if (cibleId === acteur.id) throw new ErreurMetier("erreur.soi_meme");
  const r = await enTransaction(pool, (client) =>
    client.query<{ email: string; est_superadmin: boolean }>("SELECT email, est_superadmin FROM platform.utilisateurs WHERE id = $1", [cibleId]),
  );
  const u = r.rows[0];
  if (!u) throw new ErreurMetier("erreur.introuvable");
  if (u.est_superadmin) throw new ErreurMetier("erreur.superadmin_protege");
  return { email: u.email };
}

/** Désactive un compte et ferme ses sessions. Renvoie le nombre de sessions fermées. */
export async function desactiverUtilisateur(pool: Pool, cibleId: string, acteur: Acteur): Promise<number> {
  await cibleGerable(pool, cibleId, acteur);
  return enTransaction(pool, async (client) => {
    const r = await client.query("UPDATE platform.utilisateurs SET statut = 'desactive' WHERE id = $1 AND statut = 'actif' AND NOT est_superadmin", [cibleId]);
    const fermees = await revoquerSessionsDe(client, cibleId);
    if (r.rowCount) {
      await journaliserPlateforme(client, { action: "UTILISATEUR_DESACTIVE", ...traceActeur(acteur), cibleType: "utilisateur", cibleId, details: { sessionsFermees: fermees } });
    }
    return fermees;
  });
}

export async function reactiverUtilisateur(pool: Pool, cibleId: string, acteur: Acteur): Promise<void> {
  await cibleGerable(pool, cibleId, acteur);
  await enTransaction(pool, async (client) => {
    const r = await client.query(
      "UPDATE platform.utilisateurs SET statut = 'actif', echecs_connexion = 0, verrouille_jusqua = NULL WHERE id = $1 AND statut = 'desactive' AND NOT est_superadmin",
      [cibleId],
    );
    if (r.rowCount) await journaliserPlateforme(client, { action: "UTILISATEUR_REACTIVE", ...traceActeur(acteur), cibleType: "utilisateur", cibleId });
  });
}

/** Ferme toutes les sessions ouvertes d'un compte (y compris superadmin : action défensive). */
export async function revoquerSessionsUtilisateur(pool: Pool, cibleId: string, acteur: Acteur): Promise<number> {
  if (cibleId === acteur.id) throw new ErreurMetier("erreur.soi_meme");
  return enTransaction(pool, async (client) => {
    const existe = await client.query("SELECT 1 FROM platform.utilisateurs WHERE id = $1", [cibleId]);
    if (!existe.rowCount) throw new ErreurMetier("erreur.introuvable");
    const fermees = await revoquerSessionsDe(client, cibleId);
    if (fermees > 0) {
      await journaliserPlateforme(client, { action: "SESSION_REVOQUEE", ...traceActeur(acteur), cibleType: "utilisateur", cibleId, details: { sessionsFermees: fermees } });
    }
    return fermees;
  });
}

/**
 * Le superadmin attribue un mot de passe PROVISOIRE (à changer à la prochaine connexion) et ferme les sessions.
 * Il pourrait ensuite se connecter sous le nom de la personne : la réinitialisation est donc tracée AUSSI dans le
 * journal de chaque organisation dont la personne est membre (audit S9) — l'organisation le voit.
 */
export async function reinitialiserMotDePasse(pool: Pool, cibleId: string, motDePasseProvisoire: string, acteur: Acteur): Promise<void> {
  const { email } = await cibleGerable(pool, cibleId, acteur);
  const refus = controlerMotDePasse(motDePasseProvisoire, email);
  if (refus) throw new ErreurMetier(refus);
  const empreinte = await hacherMotDePasse(motDePasseProvisoire);
  await enTransaction(pool, async (client) => {
    const r = await client.query(
      `UPDATE platform.utilisateurs
          SET mot_de_passe_hash = $2, doit_changer_mdp = true, echecs_connexion = 0, verrouille_jusqua = NULL
        WHERE id = $1 AND NOT est_superadmin`,
      [cibleId, empreinte],
    );
    if (!r.rowCount) throw new ErreurMetier("erreur.introuvable");
    const fermees = await revoquerSessionsDe(client, cibleId);
    await journaliserPlateforme(client, { action: "MOT_DE_PASSE_REINITIALISE", ...traceActeur(acteur), cibleType: "utilisateur", cibleId, details: { sessionsFermees: fermees } });
    const orgs = await client.query<{ schema_name: string; role_name: string }>(
      `SELECT o.schema_name, o.role_name FROM platform.adhesions a JOIN platform.organisations o ON o.id = a.organisation_id
        WHERE a.utilisateur_id = $1 ORDER BY o.id`,
      [cibleId],
    );
    for (const o of orgs.rows) {
      await dansOrganisation(client, { schemaName: o.schema_name, roleName: o.role_name }, () =>
        journaliserOrganisation(client, {
          action: "MOT_DE_PASSE_REINITIALISE", ...traceActeur(acteur), cibleType: "utilisateur", cibleId, details: { email, parSuperadmin: true, sessionsFermees: fermees },
        }),
      );
    }
  });
}

/**
 * L'utilisateur change SON mot de passe. Le mot de passe actuel est exigé ; une erreur compte comme un
 * échec de connexion (même verrouillage), pour qu'une session volée ne permette pas de le deviner.
 * Les autres sessions de l'utilisateur sont fermées.
 */
export async function changerMotDePasse(
  pool: Pool,
  utilisateur: Acteur,
  sessionId: string,
  saisie: { actuel: string; nouveau: string },
): Promise<void> {
  const refus = controlerMotDePasse(saisie.nouveau, utilisateur.email);
  if (refus) throw new ErreurMetier(refus);
  if (saisie.nouveau === saisie.actuel) throw new ErreurMetier("erreur.mdp_identique");
  const empreinte = await hacherMotDePasse(saisie.nouveau);
  const trace = traceActeur(utilisateur);

  // La transaction renvoie l'erreur au lieu de la lever : le compteur d'échecs doit être ENREGISTRÉ.
  const resultat = await enTransaction(pool, async (client): Promise<string | null> => {
    const lu = await client.query<{ mot_de_passe_hash: string; echecs_connexion: number }>(
      "SELECT mot_de_passe_hash, echecs_connexion FROM platform.utilisateurs WHERE id = $1 AND statut = 'actif' FOR UPDATE",
      [utilisateur.id],
    );
    const u = lu.rows[0];
    if (!u) return "erreur.introuvable";
    if (!(await verifierMotDePasse(u.mot_de_passe_hash, saisie.actuel))) {
      const echecs = u.echecs_connexion + 1;
      if (echecs >= ECHECS_AVANT_VERROU) {
        await client.query(
          "UPDATE platform.utilisateurs SET echecs_connexion = 0, verrouille_jusqua = now() + ($2::int * interval '1 minute') WHERE id = $1",
          [utilisateur.id, MINUTES_DE_VERROU],
        );
        await revoquerSessionsDe(client, utilisateur.id);
        await journaliserPlateforme(client, { action: "COMPTE_VERROUILLE", ...trace, cibleType: "utilisateur", cibleId: utilisateur.id, details: { minutes: MINUTES_DE_VERROU, origine: "changement_mdp" } });
      } else {
        await client.query("UPDATE platform.utilisateurs SET echecs_connexion = $2 WHERE id = $1", [utilisateur.id, echecs]);
      }
      return "erreur.mdp_actuel_faux";
    }
    await client.query(
      "UPDATE platform.utilisateurs SET mot_de_passe_hash = $2, doit_changer_mdp = false, echecs_connexion = 0 WHERE id = $1",
      [utilisateur.id, empreinte],
    );
    const fermees = await revoquerSessionsDe(client, utilisateur.id, sessionId);
    await journaliserPlateforme(client, { action: "MOT_DE_PASSE_MODIFIE", ...trace, cibleType: "utilisateur", cibleId: utilisateur.id, details: { autresSessionsFermees: fermees } });
    return null;
  });
  if (resultat) throw new ErreurMetier(resultat);
}

export async function changerLangue(pool: Pool, utilisateurId: string, langue: Langue): Promise<void> {
  await enTransaction(pool, (client) => client.query("UPDATE platform.utilisateurs SET langue = $2 WHERE id = $1", [utilisateurId, langue]));
}
