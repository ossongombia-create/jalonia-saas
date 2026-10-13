// Revues périodiques (W2) : jours calendaires, échéances, situation d'une revue, réglages, destinataires — sans base.
import { describe, expect, it } from "vitest";
import { ajouterJours, ajouterMois, ecartJours, estJour, jourLocal, situationEcheance } from "../../src/lib/dates";
import { formaterJour } from "../../src/lib/format";
import { BORNES, controlerParametres, echeanceRevue, revueDe } from "../../src/server/documents/revues";
import { ayantRole, type MembreDestinataire } from "../../src/server/notifications/service";

describe("jours calendaires", () => {
  it("estJour : seulement des dates réelles AAAA-MM-JJ", () => {
    for (const j of ["2026-10-13", "2024-02-29", "2000-02-29", "1999-12-31"]) expect(estJour(j), j).toBe(true);
    for (const j of ["2026-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-1-01", "26-10-13", "2026-10-13T00:00", "", null, 20261013, "1900-02-29"]) {
      expect(estJour(j), String(j)).toBe(false);
    }
  });

  it("jourLocal : le jour dans le fuseau de la plateforme (pas celui du serveur)", () => {
    const instant = new Date("2026-03-31T23:30:00Z");
    expect(jourLocal(instant, "UTC")).toBe("2026-03-31");
    expect(jourLocal(instant, "Africa/Libreville")).toBe("2026-04-01"); // UTC+1
    expect(jourLocal(instant, "America/New_York")).toBe("2026-03-31");
    expect(jourLocal(new Date("2026-01-01T04:59:00Z"), "America/New_York")).toBe("2025-12-31");
    // Changement d'heure (Europe/Paris, 29/03/2026 à 2 h → 3 h) : aucun jour sauté ni doublé.
    expect(jourLocal(new Date("2026-03-28T23:30:00Z"), "Europe/Paris")).toBe("2026-03-29");
    expect(jourLocal(new Date("2026-03-29T22:30:00Z"), "Europe/Paris")).toBe("2026-03-30");
  });

  it("ajouterMois : fin de mois ramenée au dernier jour (comme PostgreSQL)", () => {
    expect(ajouterMois("2026-01-31", 1)).toBe("2026-02-28");
    expect(ajouterMois("2028-01-31", 1)).toBe("2028-02-29");
    expect(ajouterMois("2026-10-13", 24)).toBe("2028-10-13");
    expect(ajouterMois("2026-08-31", 6)).toBe("2027-02-28");
    expect(ajouterMois("2026-12-15", 1)).toBe("2027-01-15");
    expect(ajouterMois("2026-03-31", -1)).toBe("2026-02-28");
    expect(ajouterMois("2024-02-29", 12)).toBe("2025-02-28");
    expect(ajouterMois("2026-10-13", 120)).toBe("2036-10-13");
  });

  it("ajouterJours et ecartJours (années bissextiles, changement d'année)", () => {
    expect(ajouterJours("2026-12-31", 1)).toBe("2027-01-01");
    expect(ajouterJours("2028-02-28", 1)).toBe("2028-02-29");
    expect(ajouterJours("2026-03-01", -1)).toBe("2026-02-28");
    expect(ecartJours("2026-10-13", "2026-11-12")).toBe(30);
    expect(ecartJours("2026-11-12", "2026-10-13")).toBe(-30);
    expect(ecartJours("2028-02-01", "2028-03-01")).toBe(29);
    expect(ecartJours("2026-03-28", "2026-03-30")).toBe(2); // pas d'effet du changement d'heure
    expect(() => ajouterJours("2026-02-30", 1)).toThrow();
  });

  it("situationEcheance : à jour, proche (rappel), retard, escalade — bornes comprises", () => {
    const s = (aujourdhui: string) => situationEcheance("2026-12-31", aujourdhui, 30, 30);
    expect(s("2026-11-30")).toBe("a_jour"); // 31 jours avant
    expect(s("2026-12-01")).toBe("proche"); // 30 jours avant : rappel
    expect(s("2026-12-31")).toBe("proche"); // le jour même
    expect(s("2027-01-01")).toBe("retard"); // le lendemain
    expect(s("2027-01-29")).toBe("retard"); // 29 jours de retard
    expect(s("2027-01-30")).toBe("escalade"); // 30 jours de retard
    expect(situationEcheance("2026-12-31", "2026-12-30", 0, 1)).toBe("a_jour"); // sans rappel : seulement le jour même
    expect(situationEcheance("2026-12-31", "2026-12-31", 0, 1)).toBe("proche");
    expect(situationEcheance("2026-12-31", "2027-01-01", 0, 1)).toBe("escalade");
  });

  it("formaterJour : sans décalage de fuseau, selon la langue", () => {
    expect(formaterJour("fr", "2026-10-13")).toBe("13/10/2026");
    expect(formaterJour("en", "2026-10-13")).toBe("13/10/2026");
    expect(formaterJour("fr", "2026-01-01")).toBe("01/01/2026");
    expect(formaterJour("fr", undefined)).toBe("—");
    expect(formaterJour("fr", "13/10/2026")).toBe("—");
  });
});

describe("revue d'un document", () => {
  const p = { periodeRevueMois: 24, rappelJours: 30, escaladeJours: 30 };
  it("échéance = jour de la dernière approbation (fuseau de la plateforme) + période", () => {
    expect(echeanceRevue(new Date("2026-10-13T08:00:00Z"), 24, "UTC")).toBe("2028-10-13");
    expect(echeanceRevue(new Date("2026-10-13T23:30:00Z"), 12, "Africa/Libreville")).toBe("2027-10-14");
    expect(echeanceRevue(null, 24, "UTC")).toBeNull();
  });
  it("seuls les documents PUBLIÉS ont une revue", () => {
    const revueLe = new Date("2024-01-10T10:00:00Z");
    expect(revueDe({ etat: "publie", revueLe }, p, "UTC", "2026-01-10")).toEqual({ echeance: "2026-01-10", situation: "proche" });
    expect(revueDe({ etat: "publie", revueLe }, p, "UTC", "2025-12-11")).toEqual({ echeance: "2026-01-10", situation: "proche" }); // 30 jours avant
    expect(revueDe({ etat: "publie", revueLe }, p, "UTC", "2025-12-10")).toEqual({ echeance: "2026-01-10", situation: "a_jour" }); // 31 jours avant
    expect(revueDe({ etat: "publie", revueLe }, p, "UTC", "2026-02-09")).toEqual({ echeance: "2026-01-10", situation: "escalade" });
    for (const etat of ["brouillon", "en_verification", "en_approbation", "archive"]) expect(revueDe({ etat, revueLe }, p, "UTC", "2030-01-01"), etat).toBeNull();
    expect(revueDe({ etat: "publie", revueLe: null }, p, "UTC", "2030-01-01")).toBeNull();
  });
  it("un changement de période vaut aussitôt", () => {
    const revueLe = new Date("2026-01-10T10:00:00Z");
    expect(revueDe({ etat: "publie", revueLe }, { ...p, periodeRevueMois: 12 }, "UTC", "2027-01-11")?.situation).toBe("retard");
    expect(revueDe({ etat: "publie", revueLe }, { ...p, periodeRevueMois: 36 }, "UTC", "2027-01-11")?.situation).toBe("a_jour");
  });
});

describe("réglages", () => {
  it("bornes : entiers seulement, dans les limites de la base (CHECK de la migration 0006)", () => {
    const ok = { periodeRevueMois: 24, rappelJours: 30, escaladeJours: 30 };
    expect(controlerParametres(ok)).toBeNull();
    expect(controlerParametres({ ...ok, periodeRevueMois: 1 })).toBeNull();
    expect(controlerParametres({ ...ok, periodeRevueMois: 120, rappelJours: 0, escaladeJours: 365 })).toBeNull();
    expect(controlerParametres({ ...ok, periodeRevueMois: 0 })).toBe("parametres.erreur.periodeRevueMois");
    expect(controlerParametres({ ...ok, periodeRevueMois: 121 })).toBe("parametres.erreur.periodeRevueMois");
    expect(controlerParametres({ ...ok, periodeRevueMois: 1.5 })).toBe("parametres.erreur.periodeRevueMois");
    expect(controlerParametres({ ...ok, periodeRevueMois: Number.NaN })).toBe("parametres.erreur.periodeRevueMois");
    expect(controlerParametres({ ...ok, rappelJours: -1 })).toBe("parametres.erreur.rappelJours");
    expect(controlerParametres({ ...ok, escaladeJours: 0 })).toBe("parametres.erreur.escaladeJours");
    expect(BORNES).toEqual({ periodeRevueMois: { min: 1, max: 120 }, rappelJours: { min: 0, max: 365 }, escaladeJours: { min: 1, max: 365 } });
  });
});

describe("destinataires", () => {
  const membres: MembreDestinataire[] = [
    { id: "a", nom: "A", roles: ["ADMIN_ORGANISATION"] },
    { id: "v", nom: "V", roles: ["VERIFICATEUR", "APPROBATEUR"] },
    { id: "p", nom: "P", roles: ["APPROBATEUR"] },
    { id: "r", nom: "R", roles: ["REDACTEUR"] },
  ];
  it("par rôle, sans doublon, sans les personnes exclues", () => {
    expect(ayantRole(membres, ["APPROBATEUR"])).toEqual(["v", "p"]);
    expect(ayantRole(membres, ["APPROBATEUR", "VERIFICATEUR"])).toEqual(["v", "p"]);
    expect(ayantRole(membres, ["APPROBATEUR"], ["v", null, undefined])).toEqual(["p"]);
    expect(ayantRole(membres, ["LECTEUR"])).toEqual([]);
  });
});
