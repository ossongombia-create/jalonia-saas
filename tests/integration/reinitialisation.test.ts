// Réinitialisation d'un mot de passe par lien (décision n° 1 du 19/10/2026) : le superadmin ne choisit ni ne connaît
// plus aucun mot de passe. Il crée un lien à usage unique, valable 1 heure, envoyé par courriel à la personne, qui
// choisit le sien. Seule l'empreinte du jeton est rangée ; un nouveau lien annule le précédent.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  annulerReinitialisation,
  creerReinitialisation,
  desactiverUtilisateur,
  lireReinitialisation,
  reinitialiserParLien,
} from "../../src/server/utilisateurs/service";
import { authentifier } from "../../src/server/auth/connexion";
import { validerSession } from "../../src/server/auth/sessions";
import { enTransaction } from "../../src/server/db/transactions";
import type { Acteur } from "../../src/server/acteur";
import { cleErreur, creerOrgDeTest, creerSuperadmin, MDP_TEST, membreDeTest, ouvrirPools, RESEAU_TEST, suffixe, type OrgDeTest } from "./outils";

const REGLES = { inactiviteMinutes: 120, dureeMaxHeures: 8 };
const NOUVEAU = "choisi-par-la-personne-1";

let app: Pool;
let proprietaire: Pool;
let superadmin: Acteur;
let org: OrgDeTest;

beforeAll(async () => {
  ({ app, proprietaire } = ouvrirPools());
  superadmin = await creerSuperadmin(proprietaire);
  org = await creerOrgDeTest(app, proprietaire, superadmin);
});

afterAll(async () => {
  await app.end();
  await proprietaire.end();
});

async function nouvelUtilisateur(): Promise<{ id: string; email: string }> {
  const email = `reinit-${suffixe()}@test.local`;
  return { id: await membreDeTest(app, org.cible, { email, roles: ["LECTEUR"] }, superadmin), email };
}

const connexion = (email: string, motDePasse: string) => authentifier(app, { email, motDePasse, ip: "203.0.113.9", agent: "vitest" });

describe("création du lien", () => {
  it("seule l'empreinte SHA-256 est rangée ; échéance d'1 heure ; demande tracée sans aucun secret", async () => {
    const u = await nouvelUtilisateur();
    const lien = await creerReinitialisation(app, u.id, superadmin);
    expect(lien.jeton).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const ligne = await enTransaction(app, (c) =>
      c.query<{ jeton_empreinte: string; minutes: number; cree_par: string }>(
        "SELECT jeton_empreinte, round(extract(epoch FROM expire_le - cree_le) / 60)::int AS minutes, cree_par FROM platform.reinitialisations WHERE id = $1",
        [lien.id],
      ),
    );
    expect(ligne.rows[0]).toEqual({ jeton_empreinte: createHash("sha256").update(lien.jeton).digest("hex"), minutes: 60, cree_par: superadmin.id });
    const journal = await enTransaction(app, (c) =>
      c.query<{ details: Record<string, unknown> }>("SELECT details FROM platform.journal WHERE action = 'REINITIALISATION_DEMANDEE' AND cible_id = $1", [u.id]),
    );
    expect(journal.rows).toHaveLength(1);
    expect(JSON.stringify(journal.rows[0]!.details)).not.toContain(lien.jeton);
    expect(await lireReinitialisation(app, lien.jeton)).toMatchObject({ email: u.email });
  });

  it("un nouveau lien annule le précédent ; un lien annulé ne vaut plus rien", async () => {
    const u = await nouvelUtilisateur();
    const premier = await creerReinitialisation(app, u.id, superadmin);
    const second = await creerReinitialisation(app, u.id, superadmin);
    expect(await lireReinitialisation(app, premier.jeton)).toBeNull();
    expect(await cleErreur(reinitialiserParLien(app, premier.jeton, NOUVEAU, RESEAU_TEST))).toBe("reinit.invalide");
    await annulerReinitialisation(app, second.id);
    expect(await lireReinitialisation(app, second.jeton)).toBeNull();
  });

  it("jamais pour un compte superadmin ni pour soi-même", async () => {
    const autre = await creerSuperadmin(proprietaire);
    expect(await cleErreur(creerReinitialisation(app, autre.id, superadmin))).toBe("erreur.superadmin_protege");
    expect(await cleErreur(creerReinitialisation(app, superadmin.id, superadmin))).toBe("erreur.soi_meme");
  });
});

describe("utilisation du lien", () => {
  it("la personne choisit son mot de passe : ancien refusé, sessions fermées, verrou levé, rien à changer ensuite", async () => {
    const u = await nouvelUtilisateur();
    const ouverte = await connexion(u.email, MDP_TEST);
    if (!ouverte.ok) throw new Error("connexion attendue");
    await enTransaction(proprietaire, (c) => c.query("UPDATE platform.utilisateurs SET echecs_connexion = 3 WHERE id = $1", [u.id]));
    const lien = await creerReinitialisation(app, u.id, superadmin);
    await reinitialiserParLien(app, lien.jeton, NOUVEAU, RESEAU_TEST);
    expect(await validerSession(app, { utilisateurId: u.id, sessionId: ouverte.sessionId }, REGLES)).toBeNull();
    expect((await connexion(u.email, MDP_TEST)).ok).toBe(false);
    const r = await connexion(u.email, NOUVEAU);
    expect(r.ok).toBe(true);
    const compte = await enTransaction(app, (c) =>
      c.query<{ doit_changer_mdp: boolean; verrouille_jusqua: Date | null }>("SELECT doit_changer_mdp, verrouille_jusqua FROM platform.utilisateurs WHERE id = $1", [u.id]),
    );
    expect(compte.rows[0]).toEqual({ doit_changer_mdp: false, verrouille_jusqua: null });
  });

  it("à usage unique", async () => {
    const u = await nouvelUtilisateur();
    const lien = await creerReinitialisation(app, u.id, superadmin);
    await reinitialiserParLien(app, lien.jeton, NOUVEAU, RESEAU_TEST);
    expect(await lireReinitialisation(app, lien.jeton)).toBeNull();
    expect(await cleErreur(reinitialiserParLien(app, lien.jeton, "un-autre-mot-de-passe-1", RESEAU_TEST))).toBe("reinit.invalide");
  });

  it("mot de passe trop faible : refusé, et le lien reste utilisable", async () => {
    const u = await nouvelUtilisateur();
    const lien = await creerReinitialisation(app, u.id, superadmin);
    expect(await cleErreur(reinitialiserParLien(app, lien.jeton, "court", RESEAU_TEST))).not.toBeUndefined();
    expect(await lireReinitialisation(app, lien.jeton)).not.toBeNull();
    await reinitialiserParLien(app, lien.jeton, NOUVEAU, RESEAU_TEST);
  });

  it("expiré, ou compte désactivé entre-temps : lien non valable (même réponse)", async () => {
    const u = await nouvelUtilisateur();
    const lien = await creerReinitialisation(app, u.id, superadmin);
    await enTransaction(proprietaire, (c) =>
      c.query("UPDATE platform.reinitialisations SET cree_le = now() - interval '2 hours', expire_le = now() - interval '1 hour' WHERE id = $1", [lien.id]),
    );
    expect(await lireReinitialisation(app, lien.jeton)).toBeNull();
    expect(await cleErreur(reinitialiserParLien(app, lien.jeton, NOUVEAU, RESEAU_TEST))).toBe("reinit.invalide");

    const v = await nouvelUtilisateur();
    const lienV = await creerReinitialisation(app, v.id, superadmin);
    await desactiverUtilisateur(app, v.id, superadmin);
    expect(await lireReinitialisation(app, lienV.jeton)).toBeNull();
  });

  it("liens mal formés ou inconnus : même réponse", async () => {
    for (const jeton of ["", "abc", "x".repeat(43), "../../etc/passwd", "A".repeat(42) + "="]) {
      expect(await lireReinitialisation(app, jeton), jeton).toBeNull();
      expect(await cleErreur(reinitialiserParLien(app, jeton, NOUVEAU, RESEAU_TEST)), jeton).toBe("reinit.invalide");
    }
  });

  it("l'application ne peut ni effacer un lien ni en changer l'échéance", async () => {
    const u = await nouvelUtilisateur();
    const lien = await creerReinitialisation(app, u.id, superadmin);
    const code = async (sql: string) => {
      try {
        await enTransaction(app, (c) => c.query(sql, [lien.id]));
        return undefined;
      } catch (e) {
        return (e as { code?: string }).code;
      }
    };
    expect(await code("UPDATE platform.reinitialisations SET expire_le = now() + interval '1 day' WHERE id = $1")).toBe("42501");
    expect(await code("DELETE FROM platform.reinitialisations WHERE id = $1")).toBe("42501");
  });
});
