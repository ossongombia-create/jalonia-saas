// Connexion par e-mail + mot de passe : limites de tentatives, vérification, ouverture d'une session suivie
// (table platform.sessions) et journalisation. Indépendant de Next.js : testable seul.
//
// Protection contre les essais en masse (table platform.tentatives_connexion, fenêtre glissante de 15 min) :
//   1. une ADRESSE IP qui a échoué 10 fois (tous comptes confondus) est refusée, sans calcul ;
//   2. un couple (COMPTE, ADRESSE) qui a échoué 5 fois depuis sa dernière réussite est refusé, sans calcul :
//      la personne, depuis SON adresse, peut toujours se connecter (un tiers ne peut pas la bloquer) ;
//   3. un COMPTE qui a échoué 30 fois, toutes adresses confondues (attaque répartie), est verrouillé 15 min.
// Les refus sans calcul ne sont tracés qu'une fois par fenêtre et par adresse (ou couple) : le journal, qu'on ne
// peut pas purger, ne peut pas être inondé. Le calcul argon2id passe par un limiteur (motdepasse.ts).
//
// Déroulement : une lecture courte (limites, compte), la vérification HORS transaction (calcul coûteux : aucune
// connexion à la base n'est retenue pendant ce temps), puis une écriture courte (résultat, session, journal) qui
// revérifie que le compte n'a pas changé entre-temps (désactivation, nouveau mot de passe, verrouillage).
//
// Second facteur (second-facteur.ts) : pour un superadmin, un approbateur d'une organisation active (obligation.ts), ou
// un compte qui l'a activé, la session ouverte par le mot de passe est « en attente » : inutilisable tant que le code
// n'a pas été donné (ou, s'il n'est pas encore activé, tant que la personne ne l'a pas enrôlé).
import type { Pool, PoolClient } from "pg";
import { enTransaction } from "../db/transactions";
import { ipValide, journaliserPlateforme, type EntreeJournal } from "../audit/journal";
import { ErreurOccupe, verifierContreLeurre, verifierMotDePasse } from "./motdepasse";
import { sqlSecondFacteurObligatoire } from "./obligation";

export const FENETRE_MINUTES = 15;
/** Échecs d'un même compte depuis une même adresse avant refus (pour cette adresse). */
export const ECHECS_AVANT_VERROU = 5;
/** Échecs d'une même adresse, tous comptes confondus, avant refus. */
export const ECHECS_PAR_ADRESSE = 10;
/** Échecs d'un même compte, toutes adresses confondues, avant verrouillage du compte. */
export const ECHECS_COMPTE_MAX = 30;
export const MINUTES_DE_VERROU = 15;

export interface DemandeConnexion {
  email: string; // déjà normalisé (minuscules, sans espaces)
  motDePasse: string;
  ip: string | null;
  agent: string | null;
}

export type RaisonRefus = "identifiants" | "verrouille" | "desactive" | "limite" | "occupe";

export type ResultatConnexion =
  | { ok: true; utilisateur: { id: string; email: string; nom: string; estSuperadmin: boolean }; sessionId: string; secondFacteur: boolean }
  | { ok: false; raison: RaisonRefus };

interface LigneUtilisateur {
  id: string;
  email: string;
  nom: string;
  mot_de_passe_hash: string;
  est_superadmin: boolean;
  statut: "actif" | "desactive";
  verrouille: boolean;
  mfa_actif: boolean;
  /** Superadmin, ou approbateur d'une organisation active (obligation.ts). */
  mfa_obligatoire: boolean;
}

// ---------- Refus tracés une fois par fenêtre ----------
const refusTraces = new Map<string, number>();
const DUREE_FENETRE_MS = FENETRE_MINUTES * 60_000;

/** Vrai si ce refus n'a pas encore été tracé dans la fenêtre (mémoire du processus, bornée). */
function premierRefusDeLaFenetre(cle: string): boolean {
  const maintenant = Date.now();
  if (refusTraces.size > 10_000) {
    for (const [k, t] of refusTraces) if (maintenant - t >= DUREE_FENETRE_MS) refusTraces.delete(k);
    if (refusTraces.size > 10_000) refusTraces.clear();
  }
  const dernier = refusTraces.get(cle);
  if (dernier !== undefined && maintenant - dernier < DUREE_FENETRE_MS) return false;
  refusTraces.set(cle, maintenant);
  return true;
}

async function tracerRefus(pool: Pool, cle: string, entree: EntreeJournal): Promise<void> {
  if (!premierRefusDeLaFenetre(cle)) return;
  await enTransaction(pool, (client) => journaliserPlateforme(client, entree));
}

// ---------- Tentatives ----------
let dernierMenage = 0;

async function enregistrerTentative(client: PoolClient, ip: string | null, email: string, reussie: boolean): Promise<void> {
  await client.query("INSERT INTO platform.tentatives_connexion (ip, email, reussie) VALUES ($1::inet, $2, $3)", [ip, email.slice(0, 254), reussie]);
  // Ménage (au plus une fois par minute) : les tentatives de plus d'un jour ne servent plus.
  if (Date.now() - dernierMenage > 60_000) {
    dernierMenage = Date.now();
    await client.query("DELETE FROM platform.tentatives_connexion WHERE horodatage < now() - interval '1 day'");
  }
}

interface Compteurs {
  echecs_adresse: number;
  echecs_paire: number;
  echecs_compte: number;
}

/** Échecs récents : de l'adresse (tous comptes), du couple (depuis sa dernière réussite), du compte (toutes adresses). */
async function compter(client: PoolClient, ip: string | null, email: string): Promise<Compteurs> {
  const r = await client.query<Compteurs>(
    `WITH recentes AS (
       SELECT ip, email, reussie, horodatage FROM platform.tentatives_connexion
        WHERE horodatage > now() - ($3::int * interval '1 minute')
          AND (ip IS NOT DISTINCT FROM $1::inet OR email = $2)
     ), derniere_reussite AS (
       SELECT max(horodatage) AS h FROM recentes WHERE reussie AND email = $2 AND ip IS NOT DISTINCT FROM $1::inet
     )
     SELECT count(*) FILTER (WHERE NOT reussie AND ip IS NOT DISTINCT FROM $1::inet)::int AS echecs_adresse,
            count(*) FILTER (WHERE NOT reussie AND ip IS NOT DISTINCT FROM $1::inet AND email = $2
                             AND horodatage > coalesce((SELECT h FROM derniere_reussite), '-infinity'::timestamptz))::int AS echecs_paire,
            count(*) FILTER (WHERE NOT reussie AND email = $2)::int AS echecs_compte
       FROM recentes`,
    [ip, email, FENETRE_MINUTES],
  );
  return r.rows[0]!;
}

export async function authentifier(pool: Pool, d: DemandeConnexion): Promise<ResultatConnexion> {
  const ip = ipValide(d.ip);
  const contexteJournal = { ip, agent: d.agent };

  // 1. Lecture courte : limites et compte.
  const lu = await enTransaction(pool, async (client) => {
    const compteurs = await compter(client, ip, d.email);
    const u = await client.query<LigneUtilisateur>(
      `SELECT u.id, u.email, u.nom, u.mot_de_passe_hash, u.est_superadmin, u.statut, u.mfa_active_le IS NOT NULL AS mfa_actif,
              ${sqlSecondFacteurObligatoire("u")} AS mfa_obligatoire,
              (u.verrouille_jusqua IS NOT NULL AND u.verrouille_jusqua > now()) AS verrouille
         FROM platform.utilisateurs u WHERE u.email = $1`,
      [d.email],
    );
    return { compteurs, utilisateur: u.rows[0] };
  });

  // 2. Refus sans calcul (on ne sait même pas si le compte existe : rien n'est révélé).
  if (lu.compteurs.echecs_adresse >= ECHECS_PAR_ADRESSE) {
    await tracerRefus(pool, `adresse:${ip}`, {
      action: "CONNEXION_LIMITEE", acteurEmail: d.email, details: { echecs: lu.compteurs.echecs_adresse, fenetreMinutes: FENETRE_MINUTES }, ...contexteJournal,
    });
    return { ok: false, raison: "limite" };
  }
  if (lu.compteurs.echecs_paire >= ECHECS_AVANT_VERROU) {
    await tracerRefus(pool, `couple:${ip}:${d.email}`, {
      action: "CONNEXION_ECHEC", acteurId: lu.utilisateur?.id ?? null, acteurEmail: d.email, details: { raison: "verrouille", portee: "adresse" }, ...contexteJournal,
    });
    return { ok: false, raison: "verrouille" };
  }

  // 3. Vérification, hors transaction. Compte inconnu : même calcul, contre une empreinte leurre.
  const u = lu.utilisateur;
  let motDePasseJuste: boolean;
  try {
    motDePasseJuste = u ? await verifierMotDePasse(u.mot_de_passe_hash, d.motDePasse) : (await verifierContreLeurre(d.motDePasse), false);
  } catch (erreur) {
    if (erreur instanceof ErreurOccupe) return { ok: false, raison: "occupe" };
    throw erreur;
  }

  // 4. Écriture courte : résultat, verrous, session, journal.
  return enTransaction(pool, async (client): Promise<ResultatConnexion> => {
    if (!u) {
      await enregistrerTentative(client, ip, d.email, false);
      await journaliserPlateforme(client, { action: "CONNEXION_ECHEC", acteurEmail: d.email, details: { raison: "inconnu" }, ...contexteJournal });
      return { ok: false, raison: "identifiants" };
    }
    const acteur = { acteurId: u.id, acteurEmail: u.email, ...contexteJournal };

    if (u.verrouille || u.statut !== "actif" || !motDePasseJuste) {
      await enregistrerTentative(client, ip, d.email, false);
      if (u.verrouille) {
        await journaliserPlateforme(client, { action: "CONNEXION_ECHEC", ...acteur, details: { raison: "verrouille", portee: "compte" } });
        return { ok: false, raison: "verrouille" };
      }
      if (u.statut !== "actif") {
        await journaliserPlateforme(client, { action: "CONNEXION_ECHEC", ...acteur, details: { raison: "desactive" } });
        return { ok: false, raison: "desactive" };
      }
      const c = await compter(client, ip, d.email);
      if (c.echecs_paire === ECHECS_AVANT_VERROU) {
        await journaliserPlateforme(client, { action: "COMPTE_VERROUILLE", ...acteur, details: { portee: "adresse", minutes: FENETRE_MINUTES } });
      }
      if (c.echecs_compte >= ECHECS_COMPTE_MAX) {
        const verrou = await client.query(
          `UPDATE platform.utilisateurs SET verrouille_jusqua = now() + ($2::int * interval '1 minute')
            WHERE id = $1 AND (verrouille_jusqua IS NULL OR verrouille_jusqua <= now())`,
          [u.id, MINUTES_DE_VERROU],
        );
        if (verrou.rowCount) {
          await journaliserPlateforme(client, { action: "COMPTE_VERROUILLE", ...acteur, details: { portee: "compte", minutes: MINUTES_DE_VERROU, echecs: c.echecs_compte } });
        }
      }
      await journaliserPlateforme(client, { action: "CONNEXION_ECHEC", ...acteur, details: { raison: "mot_de_passe", echecs: c.echecs_paire } });
      return { ok: false, raison: "identifiants" };
    }

    // Bon mot de passe : on revérifie que le compte n'a pas changé depuis la lecture (désactivé, mot de passe
    // changé, verrouillé entre-temps) — sinon, refus.
    const maj = await client.query(
      `UPDATE platform.utilisateurs
          SET echecs_connexion = 0, verrouille_jusqua = NULL, derniere_connexion = now()
        WHERE id = $1 AND statut = 'actif' AND mot_de_passe_hash = $2
          AND (verrouille_jusqua IS NULL OR verrouille_jusqua <= now())`,
      [u.id, u.mot_de_passe_hash],
    );
    if (!maj.rowCount) {
      await enregistrerTentative(client, ip, d.email, false);
      await journaliserPlateforme(client, { action: "CONNEXION_ECHEC", ...acteur, details: { raison: "compte_modifie" } });
      return { ok: false, raison: "identifiants" };
    }
    await enregistrerTentative(client, ip, d.email, true);
    const secondFacteur = u.mfa_obligatoire || u.mfa_actif;
    const session = await client.query<{ id: string }>(
      "INSERT INTO platform.sessions (utilisateur_id, ip, agent, en_attente_mfa) VALUES ($1, $2::inet, $3, $4) RETURNING id",
      [u.id, ip, d.agent ? d.agent.slice(0, 500) : null, secondFacteur],
    );
    const sessionId = session.rows[0]!.id;
    await journaliserPlateforme(client, {
      action: "CONNEXION", ...acteur, cibleType: "session", cibleId: sessionId, ...(secondFacteur ? { details: { secondFacteur: "attendu" } } : {}),
    });
    return { ok: true, utilisateur: { id: u.id, email: u.email, nom: u.nom, estSuperadmin: u.est_superadmin }, sessionId, secondFacteur };
  });
}
