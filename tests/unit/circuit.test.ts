// Circuit de validation (W1) : règles pures (droits, états, motif, séparation des tâches), sans base.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ETATS, LISTE_TRANSITIONS, MOTIF_MAX, TRANSITIONS, TRANSITIONS_SECOND_FACTEUR, estTransition, refusTransition, transitionsPossibles, type ContexteDecision, type Intervenants } from "../../src/server/documents/circuit";
import { estCle } from "../../src/lib/i18n";
import { en } from "../../src/lib/i18n/en";
import type { RoleOrganisation } from "../../src/lib/rbac";

const aucun: Intervenants = { auteur: null, soumisPar: null, verifiePar: null };
const R = (...r: RoleOrganisation[]) => r;

describe("circuit : transitions et états", () => {
  it("les états et les transitions sont ceux des contraintes CHECK des migrations (0005, puis 0006 pour les transitions)", () => {
    const lire = (f: string) => readFileSync(new URL(`../../db/migrations/organisation/${f}`, import.meta.url), "utf8");
    const sql = lire("0005_circuit.sql");
    const liste = (texte: string, re: RegExp) => [...texte.match(re)![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(liste(sql, /etat text NOT NULL DEFAULT 'brouillon' CHECK \(etat IN \(([^)]*)\)\)/)).toEqual([...ETATS]);
    expect(liste(lire("0006_revues_notifications.sql"), /CHECK \(transition IN \(([^)]*)\)\)/)).toEqual(LISTE_TRANSITIONS);
    const motifsCopie = liste(sql, /CHECK \(motif IN \(([^)]*)\)\)/);
    for (const t of LISTE_TRANSITIONS) {
      const c = TRANSITIONS[t].copie;
      if (c) expect(motifsCopie, t).toContain(c);
    }
  });

  it("chaque transition part d'états connus et mène à un état connu", () => {
    for (const t of LISTE_TRANSITIONS) {
      for (const de of TRANSITIONS[t].de) expect(ETATS, t).toContain(de);
      expect(ETATS, t).toContain(TRANSITIONS[t].vers);
    }
    // Vers « publié » : approuver (depuis l'approbation) ou confirmer la revue (le document l'est déjà) ; un seul chemin
    // vers « archivé » (archiver) ; l'archivage est définitif.
    expect(LISTE_TRANSITIONS.filter((t) => TRANSITIONS[t].vers === "publie")).toEqual(["approuver", "confirmer_revue"]);
    expect(TRANSITIONS.confirmer_revue.de).toEqual(["publie"]);
    expect(LISTE_TRANSITIONS.filter((t) => TRANSITIONS[t].vers === "archive")).toEqual(["archiver"]);
    expect(LISTE_TRANSITIONS.filter((t) => (TRANSITIONS[t].de as readonly string[]).includes("archive"))).toEqual([]);
  });

  it("estTransition n'accepte que les transitions déclarées (pas les propriétés héritées)", () => {
    for (const t of LISTE_TRANSITIONS) expect(estTransition(t)).toBe(true);
    for (const x of ["", "publier", "toString", "__proto__", "constructor", 1, null, undefined]) expect(estTransition(x), String(x)).toBe(false);
  });

  it("chaque état et chaque décision ont leurs textes, en français et en anglais", () => {
    const cles = [
      ...ETATS.flatMap((e) => [`etat.${e}`, `circuit.etape.${e}`]),
      ...LISTE_TRANSITIONS.flatMap((t) => [`circuit.t.${t}`, `circuit.d.${t}`, `journal.action.${TRANSITIONS[t].action}`]),
    ];
    for (const c of cles) {
      expect(estCle(c), c).toBe(true);
      expect((en as Record<string, string>)[c], c).toBeTruthy();
    }
  });
});

describe("circuit : refus d'une transition", () => {
  it("droit du rôle : soumettre/réviser (rédaction), vérifier (vérificateur), approuver et archiver (approbateur)", () => {
    expect(refusTransition("soumettre", "brouillon", R("REDACTEUR"), "u", aucun, "")).toBeNull();
    expect(refusTransition("soumettre", "brouillon", R("ADMIN_ORGANISATION"), "u", aucun, "")).toBeNull();
    for (const r of ["VERIFICATEUR", "APPROBATEUR", "LECTEUR"] as const) expect(refusTransition("soumettre", "brouillon", [r], "u", aucun, ""), r).toBe("erreur.interdit");
    expect(refusTransition("verifier", "en_verification", R("VERIFICATEUR"), "u", aucun, "")).toBeNull();
    for (const r of ["ADMIN_ORGANISATION", "REDACTEUR", "APPROBATEUR", "LECTEUR"] as const) {
      expect(refusTransition("verifier", "en_verification", [r], "u", aucun, ""), r).toBe("erreur.interdit");
      expect(refusTransition("refuser_verification", "en_verification", [r], "u", aucun, "m"), r).toBe("erreur.interdit");
    }
    expect(refusTransition("approuver", "en_approbation", R("APPROBATEUR"), "u", aucun, "")).toBeNull();
    for (const r of ["ADMIN_ORGANISATION", "REDACTEUR", "VERIFICATEUR", "LECTEUR"] as const) {
      expect(refusTransition("approuver", "en_approbation", [r], "u", aucun, ""), r).toBe("erreur.interdit");
      expect(refusTransition("refuser_approbation", "en_approbation", [r], "u", aucun, "m"), r).toBe("erreur.interdit");
      expect(refusTransition("archiver", "publie", [r], "u", aucun, "m"), r).toBe("erreur.interdit");
    }
    expect(refusTransition("reviser", "publie", R("REDACTEUR"), "u", aucun, "")).toBeNull();
    expect(refusTransition("reviser", "publie", R("APPROBATEUR"), "u", aucun, "")).toBe("erreur.interdit");
    expect(refusTransition("confirmer_revue", "publie", R("APPROBATEUR"), "u", aucun, "")).toBeNull();
    for (const r of ["ADMIN_ORGANISATION", "REDACTEUR", "VERIFICATEUR", "LECTEUR"] as const) expect(refusTransition("confirmer_revue", "publie", [r], "u", aucun, ""), r).toBe("erreur.interdit");
    // Le droit est vérifié avant l'état : un rôle sans droit n'apprend rien de l'état.
    expect(refusTransition("approuver", "brouillon", R("LECTEUR"), "u", aucun, "")).toBe("erreur.interdit");
    expect(refusTransition("approuver", "en_verification", [], "u", aucun, "")).toBe("erreur.interdit");
  });

  it("état : chaque transition n'est possible que depuis ses états de départ", () => {
    const tous = R("ADMIN_ORGANISATION", "REDACTEUR", "VERIFICATEUR", "APPROBATEUR");
    for (const t of LISTE_TRANSITIONS) {
      for (const e of ETATS) {
        const attendu = (TRANSITIONS[t].de as readonly string[]).includes(e) ? null : "circuit.etat_incompatible";
        expect(refusTransition(t, e, tous, "u", aucun, "motif"), `${t} depuis ${e}`).toBe(attendu);
      }
    }
  });

  it("motif : obligatoire pour refuser et archiver (les espaces ne comptent pas), limité à MOTIF_MAX caractères", () => {
    expect(refusTransition("refuser_verification", "en_verification", R("VERIFICATEUR"), "u", aucun, "")).toBe("circuit.motif_requis");
    expect(refusTransition("refuser_verification", "en_verification", R("VERIFICATEUR"), "u", aucun, "  \n\t ")).toBe("circuit.motif_requis");
    expect(refusTransition("refuser_approbation", "en_approbation", R("APPROBATEUR"), "u", aucun, "")).toBe("circuit.motif_requis");
    expect(refusTransition("archiver", "publie", R("APPROBATEUR"), "u", aucun, "")).toBe("circuit.motif_requis");
    expect(refusTransition("archiver", "publie", R("APPROBATEUR"), "u", aucun, "Remplacé par PR-02")).toBeNull();
    for (const t of ["soumettre", "verifier", "approuver", "reviser", "confirmer_revue"] as const) expect(TRANSITIONS[t].motifObligatoire, t).toBe(false);
    expect(refusTransition("verifier", "en_verification", R("VERIFICATEUR"), "u", aucun, "x".repeat(MOTIF_MAX))).toBeNull();
    expect(refusTransition("verifier", "en_verification", R("VERIFICATEUR"), "u", aucun, "x".repeat(MOTIF_MAX + 1))).toBe("circuit.motif_trop_long");
  });

  it("séparation des tâches : l'auteur et la personne qui a soumis ne vérifient ni n'approuvent ; le vérificateur n'approuve pas", () => {
    const tous = R("REDACTEUR", "VERIFICATEUR", "APPROBATEUR");
    const i: Intervenants = { auteur: "alice", soumisPar: "bob", verifiePar: "carla" };
    for (const qui of ["alice", "bob"]) {
      expect(refusTransition("verifier", "en_verification", tous, qui, i, ""), qui).toBe("circuit.separation_auteur");
      expect(refusTransition("refuser_verification", "en_verification", tous, qui, i, "m"), qui).toBe("circuit.separation_auteur");
      expect(refusTransition("approuver", "en_approbation", tous, qui, i, ""), qui).toBe("circuit.separation_auteur");
      expect(refusTransition("refuser_approbation", "en_approbation", tous, qui, i, "m"), qui).toBe("circuit.separation_auteur");
    }
    expect(refusTransition("verifier", "en_verification", tous, "carla", i, "")).toBeNull();
    expect(refusTransition("approuver", "en_approbation", tous, "carla", i, "")).toBe("circuit.separation_verificateur");
    expect(refusTransition("refuser_approbation", "en_approbation", tous, "carla", i, "m")).toBe("circuit.separation_verificateur");
    expect(refusTransition("approuver", "en_approbation", tous, "dan", i, "")).toBeNull();
    // Hors décisions de vérification et d'approbation, la séparation ne s'applique pas.
    expect(refusTransition("soumettre", "brouillon", tous, "alice", i, "")).toBeNull();
    expect(refusTransition("reviser", "publie", tous, "alice", i, "")).toBeNull();
    expect(refusTransition("archiver", "publie", tous, "carla", i, "m")).toBeNull();
    // Intervenant inconnu (null) : jamais confondu avec la personne.
    expect(refusTransition("approuver", "en_approbation", tous, "dan", aucun, "")).toBeNull();
  });
});

describe("circuit : décisions proposées", () => {
  const i: Intervenants = { auteur: "alice", soumisPar: "alice", verifiePar: "carla" };
  it("chacun ne voit que ce qu'il peut décider", () => {
    expect(transitionsPossibles("brouillon", R("REDACTEUR"), "alice", aucun)).toEqual(["soumettre"]);
    expect(transitionsPossibles("brouillon", R("LECTEUR"), "lea", aucun)).toEqual([]);
    expect(transitionsPossibles("en_verification", R("VERIFICATEUR"), "carla", i)).toEqual(["verifier", "refuser_verification"]);
    expect(transitionsPossibles("en_verification", R("VERIFICATEUR", "REDACTEUR"), "alice", i)).toEqual([]);
    expect(transitionsPossibles("en_approbation", R("APPROBATEUR"), "paul", i)).toEqual(["approuver", "refuser_approbation"]);
    expect(transitionsPossibles("en_approbation", R("APPROBATEUR", "VERIFICATEUR"), "carla", i)).toEqual([]);
    expect(transitionsPossibles("publie", R("APPROBATEUR"), "paul", aucun)).toEqual(["archiver", "confirmer_revue"]);
    expect(transitionsPossibles("publie", R("REDACTEUR"), "alice", aucun)).toEqual(["reviser"]);
    expect(transitionsPossibles("publie", R("ADMIN_ORGANISATION", "APPROBATEUR"), "zoe", aucun)).toEqual(["archiver", "reviser", "confirmer_revue"]);
    for (const r of ["ADMIN_ORGANISATION", "REDACTEUR", "VERIFICATEUR", "APPROBATEUR", "LECTEUR"] as const) expect(transitionsPossibles("archive", [r], "u", aucun), r).toEqual([]);
  });
});

describe("circuit : second facteur (décision n° 4 du 19/10/2026)", () => {
  const sansMfa: ContexteDecision = { mode: "standard", secondFacteurActif: false };
  const tous = R("ADMIN_ORGANISATION", "REDACTEUR", "VERIFICATEUR", "APPROBATEUR");
  it("les décisions de l'approbateur exigent un second facteur actif ; les autres non", () => {
    expect([...TRANSITIONS_SECOND_FACTEUR].sort()).toEqual(["approuver", "archiver", "confirmer_revue", "refuser_approbation"]);
    expect(refusTransition("approuver", "en_approbation", tous, "u", aucun, "", sansMfa)).toBe("circuit.second_facteur_requis");
    expect(refusTransition("refuser_approbation", "en_approbation", tous, "u", aucun, "m", sansMfa)).toBe("circuit.second_facteur_requis");
    expect(refusTransition("archiver", "publie", tous, "u", aucun, "m", sansMfa)).toBe("circuit.second_facteur_requis");
    expect(refusTransition("confirmer_revue", "publie", tous, "u", aucun, "", sansMfa)).toBe("circuit.second_facteur_requis");
    expect(refusTransition("soumettre", "brouillon", tous, "u", aucun, "", sansMfa)).toBeNull();
    expect(refusTransition("verifier", "en_verification", tous, "u", aucun, "", sansMfa)).toBeNull();
    expect(refusTransition("reviser", "publie", tous, "u", aucun, "", sansMfa)).toBeNull();
    expect(transitionsPossibles("publie", tous, "u", aucun, sansMfa)).toEqual(["reviser"]);
  });
  it("le rôle et l'état passent avant : un non-approbateur reste « interdit »", () => {
    expect(refusTransition("approuver", "en_approbation", R("LECTEUR"), "u", aucun, "", sansMfa)).toBe("erreur.interdit");
    expect(refusTransition("approuver", "publie", tous, "u", aucun, "", sansMfa)).toBe("circuit.etat_incompatible");
  });
});

describe("circuit : mode « petite organisation » (décision n° 2 du 19/10/2026)", () => {
  const petite: ContexteDecision = { mode: "petite_organisation", secondFacteurActif: true };
  const standard: ContexteDecision = { mode: "standard", secondFacteurActif: true };
  const tous = R("REDACTEUR", "VERIFICATEUR", "APPROBATEUR");
  const i: Intervenants = { auteur: "alice", soumisPar: "bob", verifiePar: "carla" };
  it("la personne qui a vérifié peut approuver ; en mode standard, non", () => {
    expect(refusTransition("approuver", "en_approbation", tous, "carla", i, "", petite)).toBeNull();
    expect(refusTransition("refuser_approbation", "en_approbation", tous, "carla", i, "m", petite)).toBeNull();
    expect(refusTransition("approuver", "en_approbation", tous, "carla", i, "", standard)).toBe("circuit.separation_verificateur");
    expect(transitionsPossibles("en_approbation", tous, "carla", i, petite)).toEqual(["approuver", "refuser_approbation"]);
    expect(transitionsPossibles("en_approbation", tous, "carla", i, standard)).toEqual([]);
  });
  it("l'auteur et la personne qui a soumis restent exclus dans les deux modes", () => {
    for (const contexte of [petite, standard]) {
      for (const qui of ["alice", "bob"]) {
        expect(refusTransition("verifier", "en_verification", tous, qui, i, "", contexte), `${contexte.mode} ${qui}`).toBe("circuit.separation_auteur");
        expect(refusTransition("approuver", "en_approbation", tous, qui, i, "", contexte), `${contexte.mode} ${qui}`).toBe("circuit.separation_auteur");
      }
    }
  });
});

