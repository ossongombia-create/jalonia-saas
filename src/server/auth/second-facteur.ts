// Second facteur d'authentification (audit S3) : codes TOTP d'une application d'authentification et codes de
// secours. OBLIGATOIRE pour les superadministrateurs, facultatif pour les autres comptes.
//
// Connexion en deux temps : le mot de passe ouvre une session « en attente » (platform.sessions.en_attente_mfa),
// refusée partout (validerSession) tant que le code n'a pas été donné sur /connexion/second-facteur.
// Limites : 5 codes faux ferment la session (il faut redonner le mot de passe) ; 10 échecs consécutifs sur le
// compte, toutes sessions confondues, le verrouillent 15 minutes. Un code TOTP ne sert qu'une fois (dernier pas
// retenu), un code de secours aussi.
//
// La clé (CLE_SECOND_FACTEUR) est passée en paramètre : sans elle, rien ne peut être activé ni vérifié.
import type { Pool, PoolClient } from "pg";
import { dansOrganisation, enTransaction } from "../db/transactions";
import { journaliserOrganisation, journaliserPlateforme } from "../audit/journal";
import { ErreurMetier } from "../erreurs";
import { traceActeur, type Acteur } from "../acteur";
import { revoquerSessionsDe } from "./sessions";
import { MINUTES_DE_VERROU } from "./connexion";
import {
  adresseOtpauth, chiffrer, dechiffrer, empreinteCodeSecours, normaliserCodeSecours, nouveauSecret, nouveauxCodesSecours,
  verifierTotp, versBase32,
} from "./totp";

export const ECHECS_MFA_PAR_SESSION = 5;
export const ECHECS_MFA_AVANT_VERROU = 10;
/** Une session en attente du code expire au bout de 10 minutes. */
export const MINUTES_SESSION_EN_ATTENTE = 10;

export interface EtatSecondFacteur {
  actif: boolean;
  obligatoire: boolean;
  codesRestants: number;
}

export async function lireEtatSecondFacteur(pool: Pool, utilisateurId: string): Promise<EtatSecondFacteur> {
  return enTransaction(pool, async (client) => {
    const r = await client.query<{ actif: boolean; obligatoire: boolean; codes: number }>(
      `SELECT u.mfa_active_le IS NOT NULL AS actif, u.est_superadmin AS obligatoire,
              (SELECT count(*)::int FROM platform.codes_secours c WHERE c.utilisateur_id = u.id AND c.utilise_le IS NULL) AS codes
         FROM platform.utilisateurs u WHERE u.id = $1`,
      [utilisateurId],
    );
    const e = r.rows[0];
    if (!e) throw new ErreurMetier("erreur.introuvable");
    return { actif: e.actif, obligatoire: e.obligatoire, codesRestants: e.codes };
  });
}

function exigerCle(cle: Buffer | null): Buffer {
  if (!cle) throw new ErreurMetier("mfa.indisponible");
  return cle;
}

export interface Enrolement {
  /** Secret en base32, à saisir à la main si le code QR ne peut pas être scanné. */
  secret: string;
  /** Adresse otpauth:// (contenu du code QR). */
  adresse: string;
}

/** Prépare l'enrôlement (ou reprend celui en cours) : secret candidat chiffré en base, pas encore actif. */
export async function preparerEnrolement(pool: Pool, cleOuNull: Buffer | null, utilisateur: { id: string; email: string }): Promise<Enrolement> {
  const cle = exigerCle(cleOuNull);
  return enTransaction(pool, async (client) => {
    const r = await client.query<{ mfa_secret_chiffre: string | null; actif: boolean }>(
      "SELECT mfa_secret_chiffre, mfa_active_le IS NOT NULL AS actif FROM platform.utilisateurs WHERE id = $1 FOR UPDATE",
      [utilisateur.id],
    );
    const u = r.rows[0];
    if (!u) throw new ErreurMetier("erreur.introuvable");
    if (u.actif) throw new ErreurMetier("mfa.deja_actif");
    let secret: Buffer | null = null;
    if (u.mfa_secret_chiffre) {
      try {
        secret = dechiffrer(u.mfa_secret_chiffre, cle, utilisateur.id);
      } catch {
        secret = null; // clé changée depuis : on repart d'un nouveau secret
      }
    }
    if (!secret) {
      secret = nouveauSecret();
      await client.query("UPDATE platform.utilisateurs SET mfa_secret_chiffre = $2 WHERE id = $1", [utilisateur.id, chiffrer(secret, cle, utilisateur.id)]);
    }
    return { secret: versBase32(secret), adresse: adresseOtpauth(secret, utilisateur.email) };
  });
}

async function remplacerCodesSecours(client: PoolClient, cle: Buffer, utilisateurId: string): Promise<string[]> {
  const codes = nouveauxCodesSecours();
  await client.query("DELETE FROM platform.codes_secours WHERE utilisateur_id = $1", [utilisateurId]);
  for (const c of codes) {
    await client.query("INSERT INTO platform.codes_secours (utilisateur_id, empreinte) VALUES ($1, $2)", [utilisateurId, empreinteCodeSecours(c, cle)]);
  }
  return codes;
}

/**
 * Active le second facteur avec un premier code de l'application. Renvoie les codes de secours EN CLAIR (à montrer
 * une seule fois). Si l'activation se fait pendant une connexion en attente (superadmin), la session devient valable.
 */
export async function activerSecondFacteur(
  pool: Pool,
  cleOuNull: Buffer | null,
  utilisateur: Acteur,
  code: string,
  sessionEnAttente?: string,
): Promise<string[]> {
  const cle = exigerCle(cleOuNull);
  return enTransaction(pool, async (client) => {
    const r = await client.query<{ mfa_secret_chiffre: string | null; actif: boolean }>(
      "SELECT mfa_secret_chiffre, mfa_active_le IS NOT NULL AS actif FROM platform.utilisateurs WHERE id = $1 FOR UPDATE",
      [utilisateur.id],
    );
    const u = r.rows[0];
    if (!u) throw new ErreurMetier("erreur.introuvable");
    if (u.actif) throw new ErreurMetier("mfa.deja_actif");
    if (!u.mfa_secret_chiffre) throw new ErreurMetier("mfa.enrolement_expire");
    let secret: Buffer;
    try {
      secret = dechiffrer(u.mfa_secret_chiffre, cle, utilisateur.id);
    } catch {
      throw new ErreurMetier("mfa.enrolement_expire");
    }
    const pas = verifierTotp(secret, code.trim(), null, Date.now());
    if (pas === null) throw new ErreurMetier("mfa.code_faux");
    await client.query("UPDATE platform.utilisateurs SET mfa_active_le = now(), mfa_dernier_pas = $2, echecs_mfa = 0 WHERE id = $1", [utilisateur.id, pas]);
    const codes = await remplacerCodesSecours(client, cle, utilisateur.id);
    if (sessionEnAttente) {
      await client.query(
        "UPDATE platform.sessions SET en_attente_mfa = false, derniere_activite = now() WHERE id = $1 AND utilisateur_id = $2 AND fin IS NULL AND en_attente_mfa",
        [sessionEnAttente, utilisateur.id],
      );
    }
    await journaliserPlateforme(client, { action: "SECOND_FACTEUR_ACTIVE", ...traceActeur(utilisateur), cibleType: "utilisateur", cibleId: utilisateur.id });
    return codes;
  });
}

interface LigneVerification {
  email: string;
  mfa_secret_chiffre: string | null;
  mfa_active_le: Date | null;
  mfa_dernier_pas: string | null; // bigint
  echecs_mfa: number;
}

type Verdict = { ok: true; methode: "totp" | "secours"; codesRestants: number } | { ok: false };

/** Vérifie un code (TOTP ou de secours) pour un compte verrouillé (FOR UPDATE) ; consomme le code s'il est bon. */
async function verifierCode(client: PoolClient, cle: Buffer, utilisateurId: string, u: LigneVerification, saisie: string): Promise<Verdict> {
  if (!u.mfa_active_le || !u.mfa_secret_chiffre) return { ok: false };
  const code = saisie.trim().replace(/\s+/g, "");
  if (/^\d{6}$/.test(code)) {
    let secret: Buffer;
    try {
      secret = dechiffrer(u.mfa_secret_chiffre, cle, utilisateurId);
    } catch (erreur) {
      console.error("[jalonia] secret de second facteur indéchiffrable (CLE_SECOND_FACTEUR changée ?)", erreur);
      return { ok: false };
    }
    const pas = verifierTotp(secret, code, u.mfa_dernier_pas === null ? null : Number(u.mfa_dernier_pas), Date.now());
    if (pas === null) return { ok: false };
    await client.query("UPDATE platform.utilisateurs SET mfa_dernier_pas = $2, echecs_mfa = 0 WHERE id = $1", [utilisateurId, pas]);
    return { ok: true, methode: "totp", codesRestants: await codesRestants(client, utilisateurId) };
  }
  const secours = normaliserCodeSecours(saisie);
  if (!secours) return { ok: false };
  const r = await client.query(
    "UPDATE platform.codes_secours SET utilise_le = now() WHERE utilisateur_id = $1 AND empreinte = $2 AND utilise_le IS NULL",
    [utilisateurId, empreinteCodeSecours(secours, cle)],
  );
  if (!r.rowCount) return { ok: false };
  await client.query("UPDATE platform.utilisateurs SET echecs_mfa = 0 WHERE id = $1", [utilisateurId]);
  return { ok: true, methode: "secours", codesRestants: await codesRestants(client, utilisateurId) };
}

async function codesRestants(client: PoolClient, utilisateurId: string): Promise<number> {
  const r = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM platform.codes_secours WHERE utilisateur_id = $1 AND utilise_le IS NULL", [utilisateurId]);
  return r.rows[0]?.n ?? 0;
}

/** Échec : compteur du compte ; au-delà du seuil, verrouillage du compte et fermeture de toutes ses sessions. */
async function compterEchecCompte(client: PoolClient, utilisateurId: string, trace: ReturnType<typeof traceActeur>): Promise<{ verrouille: boolean; echecs: number }> {
  const r = await client.query<{ echecs_mfa: number }>("UPDATE platform.utilisateurs SET echecs_mfa = echecs_mfa + 1 WHERE id = $1 RETURNING echecs_mfa", [utilisateurId]);
  const echecs = r.rows[0]?.echecs_mfa ?? 0;
  if (echecs < ECHECS_MFA_AVANT_VERROU) return { verrouille: false, echecs };
  await client.query(
    "UPDATE platform.utilisateurs SET echecs_mfa = 0, verrouille_jusqua = now() + ($2::int * interval '1 minute') WHERE id = $1",
    [utilisateurId, MINUTES_DE_VERROU],
  );
  const fermees = await revoquerSessionsDe(client, utilisateurId);
  await journaliserPlateforme(client, {
    action: "COMPTE_VERROUILLE", ...trace, cibleType: "utilisateur", cibleId: utilisateurId, details: { portee: "second_facteur", minutes: MINUTES_DE_VERROU, echecs, sessionsFermees: fermees },
  });
  return { verrouille: true, echecs };
}

export type ResultatCode =
  | { ok: true; methode: "totp" | "secours"; codesRestants: number }
  | { ok: false; raison: "code" | "session_fermee" | "verrouille" | "indisponible" };

/** Le code demandé après le mot de passe : la session en attente devient valable, ou l'échec est compté. */
export async function validerSessionParCode(
  pool: Pool,
  cle: Buffer | null,
  ids: { sessionId: string; utilisateurId: string },
  saisie: string,
  reseau: { ip: string | null; agent: string | null },
): Promise<ResultatCode> {
  return enTransaction(pool, async (client): Promise<ResultatCode> => {
    const r = await client.query<LigneVerification & { en_attente_mfa: boolean; fin: Date | null; trop_ancienne: boolean; echecs_session: number; statut: string; verrouille: boolean }>(
      `SELECT s.en_attente_mfa, s.fin, s.echecs_mfa AS echecs_session,
              s.debut < now() - ($3::int * interval '1 minute') AS trop_ancienne,
              u.email, u.statut, u.mfa_secret_chiffre, u.mfa_active_le, u.mfa_dernier_pas, u.echecs_mfa,
              (u.verrouille_jusqua IS NOT NULL AND u.verrouille_jusqua > now()) AS verrouille
         FROM platform.sessions s JOIN platform.utilisateurs u ON u.id = s.utilisateur_id
        WHERE s.id = $1 AND s.utilisateur_id = $2
        FOR UPDATE OF s, u`,
      [ids.sessionId, ids.utilisateurId, MINUTES_SESSION_EN_ATTENTE],
    );
    const l = r.rows[0];
    if (!l || l.fin !== null || !l.en_attente_mfa) return { ok: false, raison: "session_fermee" };
    const trace = { acteurId: ids.utilisateurId, acteurEmail: l.email, ip: reseau.ip, agent: reseau.agent };
    const fermer = (motif: "expiration" | "revocation") =>
      client.query("UPDATE platform.sessions SET fin = now(), motif_fin = $2 WHERE id = $1 AND fin IS NULL", [ids.sessionId, motif]);
    if (l.trop_ancienne) {
      await fermer("expiration");
      return { ok: false, raison: "session_fermee" };
    }
    if (l.statut !== "actif" || l.verrouille) {
      await fermer("revocation");
      return { ok: false, raison: "verrouille" };
    }
    if (!cle || !l.mfa_active_le) return { ok: false, raison: "indisponible" };

    const verdict = await verifierCode(client, cle, ids.utilisateurId, l, saisie);
    if (verdict.ok) {
      await client.query("UPDATE platform.sessions SET en_attente_mfa = false, derniere_activite = now() WHERE id = $1", [ids.sessionId]);
      await journaliserPlateforme(client, {
        action: "SECOND_FACTEUR_VALIDE", ...trace, cibleType: "session", cibleId: ids.sessionId, details: { methode: verdict.methode, codesRestants: verdict.codesRestants },
      });
      return verdict;
    }
    const s = await client.query<{ echecs_mfa: number }>("UPDATE platform.sessions SET echecs_mfa = echecs_mfa + 1 WHERE id = $1 RETURNING echecs_mfa", [ids.sessionId]);
    const echecsSession = s.rows[0]?.echecs_mfa ?? 0;
    const compte = await compterEchecCompte(client, ids.utilisateurId, trace);
    await journaliserPlateforme(client, {
      action: "SECOND_FACTEUR_ECHEC", ...trace, cibleType: "session", cibleId: ids.sessionId, details: { echecsSession, echecsCompte: compte.echecs },
    });
    if (compte.verrouille) return { ok: false, raison: "verrouille" };
    if (echecsSession >= ECHECS_MFA_PAR_SESSION) {
      await fermer("revocation");
      return { ok: false, raison: "session_fermee" };
    }
    return { ok: false, raison: "code" };
  });
}

/** Opération sensible depuis une session ouverte (désactiver, nouveaux codes) : un code est exigé, l'échec compte. */
async function exigerCode<T>(pool: Pool, cle: Buffer, utilisateur: Acteur, saisie: string, travail: (client: PoolClient) => Promise<T>): Promise<T> {
  const r = await enTransaction(pool, async (client): Promise<{ ok: true; valeur: T } | { ok: false; cle: string }> => {
    const lu = await client.query<LigneVerification>(
      "SELECT email, mfa_secret_chiffre, mfa_active_le, mfa_dernier_pas, echecs_mfa FROM platform.utilisateurs WHERE id = $1 FOR UPDATE",
      [utilisateur.id],
    );
    const u = lu.rows[0];
    if (!u?.mfa_active_le) return { ok: false, cle: "mfa.inactif" };
    const verdict = await verifierCode(client, cle, utilisateur.id, u, saisie);
    if (!verdict.ok) {
      const compte = await compterEchecCompte(client, utilisateur.id, traceActeur(utilisateur));
      await journaliserPlateforme(client, { action: "SECOND_FACTEUR_ECHEC", ...traceActeur(utilisateur), cibleType: "utilisateur", cibleId: utilisateur.id, details: { echecsCompte: compte.echecs } });
      return { ok: false, cle: compte.verrouille ? "mfa.verrouille" : "mfa.code_faux" };
    }
    return { ok: true, valeur: await travail(client) };
  });
  // L'échec est ENREGISTRÉ (la transaction est validée), puis signalé.
  if (!r.ok) throw new ErreurMetier(r.cle);
  return r.valeur;
}

/** Désactive le second facteur (comptes NON superadmin : pour eux, il est obligatoire). */
export async function desactiverSecondFacteur(pool: Pool, cleOuNull: Buffer | null, utilisateur: Acteur & { estSuperadmin: boolean }, saisie: string): Promise<void> {
  if (utilisateur.estSuperadmin) throw new ErreurMetier("mfa.obligatoire");
  const cle = exigerCle(cleOuNull);
  await exigerCode(pool, cle, utilisateur, saisie, async (client) => {
    await client.query("UPDATE platform.utilisateurs SET mfa_active_le = NULL, mfa_secret_chiffre = NULL, mfa_dernier_pas = NULL, echecs_mfa = 0 WHERE id = $1", [utilisateur.id]);
    await client.query("DELETE FROM platform.codes_secours WHERE utilisateur_id = $1", [utilisateur.id]);
    await journaliserPlateforme(client, { action: "SECOND_FACTEUR_DESACTIVE", ...traceActeur(utilisateur), cibleType: "utilisateur", cibleId: utilisateur.id });
  });
}

/** Nouveaux codes de secours (les anciens ne servent plus). Renvoie les codes EN CLAIR. */
export async function regenererCodesSecours(pool: Pool, cleOuNull: Buffer | null, utilisateur: Acteur, saisie: string): Promise<string[]> {
  const cle = exigerCle(cleOuNull);
  return exigerCode(pool, cle, utilisateur, saisie, async (client) => {
    const codes = await remplacerCodesSecours(client, cle, utilisateur.id);
    await journaliserPlateforme(client, { action: "CODES_SECOURS_REGENERES", ...traceActeur(utilisateur), cibleType: "utilisateur", cibleId: utilisateur.id });
    return codes;
  });
}

/**
 * Le superadmin retire le second facteur d'un compte (téléphone perdu, plus de codes de secours) — jamais celui d'un
 * superadmin (ligne de commande sur le serveur seulement). Sessions fermées. Tracé dans le journal de la plateforme
 * ET dans celui de chaque organisation de la personne : l'organisation le voit.
 */
export async function reinitialiserSecondFacteur(pool: Pool, cibleId: string, acteur: Acteur): Promise<void> {
  if (cibleId === acteur.id) throw new ErreurMetier("erreur.soi_meme");
  await enTransaction(pool, async (client) => {
    const cible = await client.query<{ est_superadmin: boolean }>("SELECT est_superadmin FROM platform.utilisateurs WHERE id = $1", [cibleId]);
    if (!cible.rows[0]) throw new ErreurMetier("erreur.introuvable");
    if (cible.rows[0].est_superadmin) throw new ErreurMetier("erreur.superadmin_protege");
    const r = await client.query<{ email: string }>(
      `UPDATE platform.utilisateurs SET mfa_active_le = NULL, mfa_secret_chiffre = NULL, mfa_dernier_pas = NULL, echecs_mfa = 0
        WHERE id = $1 AND NOT est_superadmin AND mfa_active_le IS NOT NULL RETURNING email`,
      [cibleId],
    );
    if (!r.rowCount) throw new ErreurMetier("mfa.inactif");
    const email = r.rows[0]!.email;
    await client.query("DELETE FROM platform.codes_secours WHERE utilisateur_id = $1", [cibleId]);
    const fermees = await revoquerSessionsDe(client, cibleId);
    const details = { email, parSuperadmin: true, sessionsFermees: fermees };
    await journaliserPlateforme(client, { action: "SECOND_FACTEUR_REINITIALISE", ...traceActeur(acteur), cibleType: "utilisateur", cibleId, details });
    const orgs = await client.query<{ schema_name: string; role_name: string }>(
      "SELECT o.schema_name, o.role_name FROM platform.adhesions a JOIN platform.organisations o ON o.id = a.organisation_id WHERE a.utilisateur_id = $1 ORDER BY o.id",
      [cibleId],
    );
    for (const o of orgs.rows) {
      await dansOrganisation(client, { schemaName: o.schema_name, roleName: o.role_name }, () =>
        journaliserOrganisation(client, { action: "SECOND_FACTEUR_REINITIALISE", ...traceActeur(acteur), cibleType: "utilisateur", cibleId, details }),
      );
    }
  });
}
