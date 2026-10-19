// Comptes utilisateurs : consultation et gestion par le superadmin, mot de passe et langue par l'utilisateur.
// Les comptes superadministrateurs ne se gèrent PAS depuis l'interface (ligne de commande sur le serveur) :
// un compte superadmin compromis ne peut pas désactiver ou reprendre les autres.
import { randomBytes } from "node:crypto";
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
import { empreinteJeton, jetonBienForme } from "../invitations/service";

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

/** Ce que la personne voit sur la page du lien : son adresse et l'échéance du lien. */
export interface ReinitialisationOuverte {
  email: string;
  nom: string;
  expireLe: Date;
}

export interface ReinitialisationCreee {
  id: string;
  jeton: string;
  email: string;
  nom: string;
  langue: Langue;
  expireLe: Date;
}

export const DUREE_REINITIALISATION_MINUTES = 60;

/** Chemin du lien de réinitialisation (relatif au site). */
export function cheminReinitialisation(jeton: string): string {
  return `/reinitialisation/${jeton}`;
}

/** Inscrit l'opération dans le journal de CHAQUE organisation dont la personne est membre (audit S9). */
async function journaliserDansSesOrganisations(client: PoolClient, utilisateurId: string, e: Parameters<typeof journaliserOrganisation>[1]): Promise<void> {
  const orgs = await client.query<{ schema_name: string; role_name: string }>(
    `SELECT o.schema_name, o.role_name FROM platform.adhesions a JOIN platform.organisations o ON o.id = a.organisation_id
      WHERE a.utilisateur_id = $1 ORDER BY o.id`,
    [utilisateurId],
  );
  for (const o of orgs.rows) {
    await dansOrganisation(client, { schemaName: o.schema_name, roleName: o.role_name }, () => journaliserOrganisation(client, e));
  }
}

/**
 * Le superadmin demande la réinitialisation du mot de passe d'un compte (décision n° 1 du 19/10/2026) : un lien à
 * usage unique, valable 1 heure, est créé pour être ENVOYÉ PAR COURRIEL à la personne (l'action refuse sans SMTP).
 * Le superadmin ne choisit ni ne connaît le nouveau mot de passe. Seule l'empreinte du jeton est rangée ; un lien
 * encore en attente pour ce compte est annulé. La demande est tracée dans le journal de la plateforme et dans celui
 * de chaque organisation de la personne.
 */
export async function creerReinitialisation(pool: Pool, cibleId: string, acteur: Acteur): Promise<ReinitialisationCreee> {
  const { email } = await cibleGerable(pool, cibleId, acteur);
  return enTransaction(pool, async (client) => {
    const u = await client.query<{ nom: string; langue: Langue }>(
      "SELECT nom, coalesce(langue, 'fr') AS langue FROM platform.utilisateurs WHERE id = $1 AND NOT est_superadmin",
      [cibleId],
    );
    const personne = u.rows[0];
    if (!personne) throw new ErreurMetier("erreur.introuvable");
    await client.query(
      "UPDATE platform.reinitialisations SET annulee_le = now() WHERE utilisateur_id = $1 AND utilisee_le IS NULL AND annulee_le IS NULL",
      [cibleId],
    );
    const jeton = randomBytes(32).toString("base64url");
    const r = await client.query<{ id: string; expire_le: Date }>(
      `INSERT INTO platform.reinitialisations (utilisateur_id, jeton_empreinte, cree_par, expire_le)
       VALUES ($1, $2, $3, now() + make_interval(mins => $4)) RETURNING id, expire_le`,
      [cibleId, empreinteJeton(jeton), acteur.id, DUREE_REINITIALISATION_MINUTES],
    );
    const id = r.rows[0]!.id;
    await journaliserPlateforme(client, { action: "REINITIALISATION_DEMANDEE", ...traceActeur(acteur), cibleType: "utilisateur", cibleId, details: { email } });
    await journaliserDansSesOrganisations(client, cibleId, {
      action: "REINITIALISATION_DEMANDEE", ...traceActeur(acteur), cibleType: "utilisateur", cibleId, details: { email, parSuperadmin: true },
    });
    return { id, jeton, email, nom: personne.nom, langue: personne.langue, expireLe: r.rows[0]!.expire_le };
  });
}

/** Annule un lien (le courriel n'a pas pu partir : le lien ne doit pas rester valable). */
export async function annulerReinitialisation(pool: Pool, id: string): Promise<void> {
  await enTransaction(pool, (client) =>
    client.query("UPDATE platform.reinitialisations SET annulee_le = now() WHERE id = $1 AND utilisee_le IS NULL AND annulee_le IS NULL", [id]),
  );
}

const CONDITIONS_LIEN = "r.utilisee_le IS NULL AND r.annulee_le IS NULL AND r.expire_le > now() AND u.statut = 'actif' AND NOT u.est_superadmin";

/** Le compte d'un lien, ou null s'il n'est pas (ou plus) valable — même réponse quelle qu'en soit la raison. */
export async function lireReinitialisation(pool: Pool, jeton: string): Promise<ReinitialisationOuverte | null> {
  if (!jetonBienForme(jeton)) return null;
  return enTransaction(pool, async (client) => {
    const r = await client.query<{ email: string; nom: string; expire_le: Date }>(
      `SELECT u.email, u.nom, r.expire_le FROM platform.reinitialisations r JOIN platform.utilisateurs u ON u.id = r.utilisateur_id
        WHERE r.jeton_empreinte = $1 AND ${CONDITIONS_LIEN}`,
      [empreinteJeton(jeton)],
    );
    const l = r.rows[0];
    return l ? { email: l.email, nom: l.nom, expireLe: l.expire_le } : null;
  });
}

/**
 * La personne choisit SON nouveau mot de passe avec le lien. Le lien ne sert qu'une fois ; toutes les sessions du
 * compte sont fermées, le verrouillage levé. Tracé (la personne en est l'auteur) dans le journal de la plateforme et
 * dans celui de chacune de ses organisations.
 */
export async function reinitialiserParLien(pool: Pool, jeton: string, motDePasse: string, reseau: { ip: string | null; agent: string | null }): Promise<{ email: string }> {
  const lu = await lireReinitialisation(pool, jeton);
  if (!lu) throw new ErreurMetier("reinit.invalide");
  const refus = controlerMotDePasse(motDePasse, lu.email);
  if (refus) throw new ErreurMetier(refus);
  const empreinte = await hacherMotDePasse(motDePasse); // calcul lent : hors transaction
  return enTransaction(pool, async (client) => {
    const r = await client.query<{ id: string; utilisateur_id: string; email: string }>(
      `SELECT r.id, r.utilisateur_id, u.email FROM platform.reinitialisations r JOIN platform.utilisateurs u ON u.id = r.utilisateur_id
        WHERE r.jeton_empreinte = $1 AND ${CONDITIONS_LIEN}
        FOR UPDATE OF r`,
      [empreinteJeton(jeton)],
    );
    const l = r.rows[0];
    if (!l) throw new ErreurMetier("reinit.invalide");
    await client.query(
      `UPDATE platform.utilisateurs
          SET mot_de_passe_hash = $2, doit_changer_mdp = false, echecs_connexion = 0, verrouille_jusqua = NULL
        WHERE id = $1 AND NOT est_superadmin`,
      [l.utilisateur_id, empreinte],
    );
    await client.query("UPDATE platform.reinitialisations SET utilisee_le = now() WHERE id = $1", [l.id]);
    const fermees = await revoquerSessionsDe(client, l.utilisateur_id);
    const personne: Acteur = { id: l.utilisateur_id, email: l.email, ip: reseau.ip, agent: reseau.agent };
    const details = { email: l.email, parLien: true, sessionsFermees: fermees };
    await journaliserPlateforme(client, { action: "MOT_DE_PASSE_REINITIALISE", ...traceActeur(personne), cibleType: "utilisateur", cibleId: l.utilisateur_id, details });
    await journaliserDansSesOrganisations(client, l.utilisateur_id, { action: "MOT_DE_PASSE_REINITIALISE", ...traceActeur(personne), cibleType: "utilisateur", cibleId: l.utilisateur_id, details });
    return { email: l.email };
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
