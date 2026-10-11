// Connexion par e-mail + mot de passe : vérification, verrouillage après échecs répétés, ouverture d'une
// session suivie (table platform.sessions) et journalisation. Indépendant de Next.js : testable seul.
import type { Pool } from "pg";
import { enTransaction } from "../db/transactions";
import { ipValide, journaliserPlateforme } from "../audit/journal";
import { verifierContreLeurre, verifierMotDePasse } from "./motdepasse";

export const ECHECS_AVANT_VERROU = 5;
export const MINUTES_DE_VERROU = 15;

export interface DemandeConnexion {
  email: string; // déjà normalisé (minuscules, sans espaces)
  motDePasse: string;
  ip: string | null;
  agent: string | null;
}

export type ResultatConnexion =
  | { ok: true; utilisateur: { id: string; email: string; nom: string; estSuperadmin: boolean }; sessionId: string }
  | { ok: false; raison: "identifiants" | "verrouille" | "desactive" };

interface LigneUtilisateur {
  id: string;
  email: string;
  nom: string;
  mot_de_passe_hash: string;
  est_superadmin: boolean;
  statut: "actif" | "desactive";
  echecs_connexion: number;
  verrouille: boolean;
}

export async function authentifier(pool: Pool, d: DemandeConnexion): Promise<ResultatConnexion> {
  const contexteJournal = { ip: d.ip, agent: d.agent };
  return enTransaction(pool, async (client) => {
    const lu = await client.query<LigneUtilisateur>(
      `SELECT id, email, nom, mot_de_passe_hash, est_superadmin, statut, echecs_connexion,
              (verrouille_jusqua IS NOT NULL AND verrouille_jusqua > now()) AS verrouille
         FROM platform.utilisateurs WHERE email = $1 FOR UPDATE`,
      [d.email],
    );
    const u = lu.rows[0];

    // E-mail inconnu : même temps de réponse que pour un compte existant, même message.
    if (!u) {
      await verifierContreLeurre(d.motDePasse);
      await journaliserPlateforme(client, { action: "CONNEXION_ECHEC", acteurEmail: d.email, details: { raison: "inconnu" }, ...contexteJournal });
      return { ok: false, raison: "identifiants" };
    }

    const motDePasseJuste = await verifierMotDePasse(u.mot_de_passe_hash, d.motDePasse);
    const acteur = { acteurId: u.id, acteurEmail: u.email, ...contexteJournal };

    if (u.verrouille) {
      await journaliserPlateforme(client, { action: "CONNEXION_ECHEC", ...acteur, details: { raison: "verrouille" } });
      return { ok: false, raison: "verrouille" };
    }
    if (u.statut !== "actif") {
      await journaliserPlateforme(client, { action: "CONNEXION_ECHEC", ...acteur, details: { raison: "desactive" } });
      return { ok: false, raison: "desactive" };
    }
    if (!motDePasseJuste) {
      const echecs = u.echecs_connexion + 1;
      if (echecs >= ECHECS_AVANT_VERROU) {
        await client.query(
          `UPDATE platform.utilisateurs
              SET echecs_connexion = 0, verrouille_jusqua = now() + ($2::int * interval '1 minute')
            WHERE id = $1`,
          [u.id, MINUTES_DE_VERROU],
        );
        await journaliserPlateforme(client, { action: "COMPTE_VERROUILLE", ...acteur, details: { minutes: MINUTES_DE_VERROU } });
      } else {
        await client.query("UPDATE platform.utilisateurs SET echecs_connexion = $2 WHERE id = $1", [u.id, echecs]);
      }
      await journaliserPlateforme(client, { action: "CONNEXION_ECHEC", ...acteur, details: { raison: "mot_de_passe", echecs } });
      return { ok: false, raison: "identifiants" };
    }

    await client.query(
      "UPDATE platform.utilisateurs SET echecs_connexion = 0, verrouille_jusqua = NULL, derniere_connexion = now() WHERE id = $1",
      [u.id],
    );
    const session = await client.query<{ id: string }>(
      "INSERT INTO platform.sessions (utilisateur_id, ip, agent) VALUES ($1, $2::inet, $3) RETURNING id",
      [u.id, ipValide(d.ip), d.agent ? d.agent.slice(0, 500) : null],
    );
    const sessionId = session.rows[0]!.id;
    await journaliserPlateforme(client, { action: "CONNEXION", ...acteur, cibleType: "session", cibleId: sessionId });
    return { ok: true, utilisateur: { id: u.id, email: u.email, nom: u.nom, estSuperadmin: u.est_superadmin }, sessionId };
  });
}
