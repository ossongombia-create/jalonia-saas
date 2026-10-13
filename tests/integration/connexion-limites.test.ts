// Limitation des tentatives de connexion : par adresse IP, par couple (compte, adresse), par compte (attaque répartie).
// Chaque test utilise ses propres adresses (plage de documentation 198.51.100.0/24) : ils ne se gênent pas.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { authentifier, ECHECS_AVANT_VERROU, ECHECS_COMPTE_MAX, ECHECS_PAR_ADRESSE } from "../../src/server/auth/connexion";
import { enTransaction } from "../../src/server/db/transactions";
import type { Acteur } from "../../src/server/acteur";
import { creerOrgDeTest, creerSuperadmin, MDP_TEST, membreDeTest, ouvrirPools, suffixe, type OrgDeTest } from "./outils";

let app: Pool;
let proprietaire: Pool;
let superadmin: Acteur;
let org: OrgDeTest;
let prochaineAdresse = 1;

beforeAll(async () => {
  ({ app, proprietaire } = ouvrirPools());
  superadmin = await creerSuperadmin(proprietaire);
  org = await creerOrgDeTest(app, proprietaire, superadmin);
});

afterAll(async () => {
  await app.end();
  await proprietaire.end();
});

const adresse = () => `198.51.100.${prochaineAdresse++}`;

async function compte(): Promise<string> {
  const email = `lim-${suffixe()}@test.local`;
  await membreDeTest(app, org.cible, { email, nom: "Personne", roles: ["LECTEUR"] }, superadmin);
  return email;
}

const essayer = (email: string, motDePasse: string, ip: string) => authentifier(app, { email, motDePasse, ip, agent: "vitest" });

async function lignes(sql: string, valeurs: unknown[]): Promise<number> {
  const r = await enTransaction(proprietaire, (c) => c.query(sql, valeurs));
  return r.rowCount ?? 0;
}

describe("limitation des tentatives", () => {
  it("ménage : les tentatives de plus d'un jour sont supprimées", async () => {
    const email = `ancien-${suffixe()}@test.local`;
    await enTransaction(proprietaire, (c) =>
      c.query("INSERT INTO platform.tentatives_connexion (horodatage, ip, email, reussie) VALUES (now() - interval '2 days', '198.51.100.250', $1, false)", [email]),
    );
    await essayer(`declencheur-${suffixe()}@test.local`, "x".repeat(12), adresse());
    expect(await lignes("SELECT 1 FROM platform.tentatives_connexion WHERE email = $1", [email])).toBe(0);
  });

  it(`couple (compte, adresse) : refusé après ${ECHECS_AVANT_VERROU} échecs ; la personne, depuis une autre adresse, se connecte`, async () => {
    const email = await compte();
    const attaquant = adresse();
    for (let i = 0; i < ECHECS_AVANT_VERROU; i++) expect(await essayer(email, "mauvais-mot-de-passe", attaquant)).toEqual({ ok: false, raison: "identifiants" });
    expect(await essayer(email, MDP_TEST, attaquant)).toEqual({ ok: false, raison: "verrouille" });
    expect((await essayer(email, MDP_TEST, adresse())).ok).toBe(true);
  });

  it("une réussite remet le compteur du couple à zéro", async () => {
    const email = await compte();
    const ip = adresse();
    for (let i = 0; i < ECHECS_AVANT_VERROU - 1; i++) await essayer(email, "mauvais-mot-de-passe", ip);
    expect((await essayer(email, MDP_TEST, ip)).ok).toBe(true);
    for (let i = 0; i < ECHECS_AVANT_VERROU - 1; i++) await essayer(email, "mauvais-mot-de-passe", ip);
    expect((await essayer(email, MDP_TEST, ip)).ok).toBe(true);
  });

  it(`adresse : refusée après ${ECHECS_PAR_ADRESSE} échecs tous comptes confondus, sans calcul ni inondation du journal`, async () => {
    const email = await compte();
    const ip = adresse();
    for (let i = 0; i < ECHECS_PAR_ADRESSE; i++) await essayer(`inconnu-${suffixe()}@test.local`, "mauvais-mot-de-passe", ip);
    for (let i = 0; i < 5; i++) expect(await essayer(email, MDP_TEST, ip)).toEqual({ ok: false, raison: "limite" });
    expect(await lignes("SELECT 1 FROM platform.tentatives_connexion WHERE ip = $1", [ip])).toBe(ECHECS_PAR_ADRESSE);
    expect(await lignes("SELECT 1 FROM platform.journal WHERE ip = $1 AND action = 'CONNEXION_LIMITEE'", [ip])).toBe(1);
    expect((await essayer(email, MDP_TEST, adresse())).ok).toBe(true);
    // Fin de la fenêtre : l'adresse retrouve ses essais.
    await enTransaction(proprietaire, (c) => c.query("UPDATE platform.tentatives_connexion SET horodatage = horodatage - interval '16 minutes' WHERE ip = $1", [ip]));
    expect((await essayer(email, MDP_TEST, ip)).ok).toBe(true);
  });

  it(`compte attaqué depuis de nombreuses adresses : verrouillé après ${ECHECS_COMPTE_MAX} échecs, tracé une fois`, async () => {
    const email = await compte();
    const parAdresse = ECHECS_AVANT_VERROU;
    for (let n = 0; n < ECHECS_COMPTE_MAX / parAdresse; n++) {
      const ip = adresse();
      for (let i = 0; i < parAdresse; i++) await essayer(email, "mauvais-mot-de-passe", ip);
    }
    expect(await essayer(email, MDP_TEST, adresse())).toEqual({ ok: false, raison: "verrouille" });
    expect(await lignes("SELECT 1 FROM platform.utilisateurs WHERE email = $1 AND verrouille_jusqua > now()", [email])).toBe(1);
    expect(await lignes("SELECT 1 FROM platform.journal WHERE acteur_email = $1 AND action = 'COMPTE_VERROUILLE' AND details->>'portee' = 'compte'", [email])).toBe(1);
  });

  it("refus sans calcul : rien n'est enregistré comme tentative (un attaquant ne prolonge pas le blocage d'un tiers)", async () => {
    const email = await compte();
    const ip = adresse();
    for (let i = 0; i < ECHECS_AVANT_VERROU; i++) await essayer(email, "mauvais-mot-de-passe", ip);
    for (let i = 0; i < 10; i++) await essayer(email, "mauvais-mot-de-passe", ip);
    expect(await lignes("SELECT 1 FROM platform.tentatives_connexion WHERE email = $1", [email])).toBe(ECHECS_AVANT_VERROU);
    expect(await lignes("SELECT 1 FROM platform.journal WHERE acteur_email = $1 AND action = 'CONNEXION_ECHEC' AND details->>'raison' = 'verrouille'", [email])).toBe(1);
  });
});
