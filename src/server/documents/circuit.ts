// Circuit de validation des documents (audit W1, W3 ; migration organisation 0005).
//
//   brouillon ──soumettre──▶ en_verification ──verifier──▶ en_approbation ──approuver──▶ publie ──archiver──▶ archive
//       ▲                        │ refuser_verification         │ refuser_approbation      │ reviser
//       └────────────────────────┴──────────────────────────────┴──────────────────────────┘
//
// - Seul un BROUILLON se modifie (éditeur, restauration d'une version, mise à la corbeille) : une version soumise est
//   figée ; pour changer un document publié, on le « révise » (retour au brouillon : la version publiée reste dans
//   l'historique et le document garde son numéro de version publiée jusqu'à la publication suivante).
// - Refuser et archiver demandent un MOTIF.
// - Séparation des tâches (décision n° 2 du 19/10/2026) : la personne qui a soumis la version, ou qui l'a rédigée (dernier
//   auteur), ne peut ni la vérifier ni l'approuver. En mode « standard » (par défaut), celle qui l'a vérifiée ne peut pas
//   l'approuver : trois personnes distinctes. En mode « petite organisation » (activé par l'exploitant), cette dernière
//   règle tombe : deux personnes suffisent.
// - Second facteur (décision n° 4 du 19/10/2026) : approuver, refuser l'approbation, archiver et confirmer une revue sont
//   refusés tant que la personne n'a pas activé son second facteur (en plus de son obligation à la connexion).
// - La version soumise est copiée dans l'historique (copie « soumission ») : c'est elle qui est vérifiée, approuvée, publiée
//   puis archivée, sans changer ; le document garde le numéro de la version publiée (version_publiee).
// - Revue périodique (revues.ts) : un approbateur « confirme la revue » d'un document publié (il reste publié, nouvelle
//   échéance) ; sinon le document est révisé.
// - Notifications (notifications/service.ts) : soumis → vérificateurs ; vérifié → approbateurs ; refusé ou publié → la
//   personne qui a soumis et l'auteur. Jamais à soi-même ni à qui la séparation des tâches interdit de décider.
// - Chaque décision est rangée (decisions_document, ajout seul) avec la version, le motif et l'empreinte SHA-256 du
//   contenu : c'est une TRACE D'APPROBATION, pas une signature électronique (aucune valeur légale revendiquée).
import type { Pool, PoolClient } from "pg";
import { aLeDroit, type Droit, type RoleOrganisation } from "@/lib/rbac";
import { avecOrganisation, dansOrganisation, enTransaction } from "../db/transactions";
import type { OrganisationCible } from "../membres/service";
import { journaliserOrganisation, journaliserPlateforme, type EntreeJournal } from "../audit/journal";
import type { Action } from "@/lib/actions-journal";
import { ErreurMetier } from "../erreurs";
import { nomActeur, traceActeur, type Acteur } from "../acteur";
import { estIdentifiant, type EtatDocument, type TypeDocument } from "./service";
import { copier, type MotifCopie } from "./copies";
import { ayantRole, membresDestinataires, notifier, type NouvelleNotification } from "../notifications/service";

export type { EtatDocument };
/** Les états, dans l'ordre du circuit (la contrainte CHECK de la migration 0005 porte la même liste : test unitaire). */
export const ETATS = ["brouillon", "en_verification", "en_approbation", "publie", "archive"] as const satisfies readonly EtatDocument[];
// Aucun état du type n'est oublié dans la liste :
const _etatsComplets: Exclude<EtatDocument, (typeof ETATS)[number]> extends never ? true : false = true;
void _etatsComplets;

export const TRANSITIONS = {
  soumettre: { de: ["brouillon"], vers: "en_verification", droit: "documents.soumettre", motifObligatoire: false, action: "DOCUMENT_SOUMIS", copie: "soumission" },
  verifier: { de: ["en_verification"], vers: "en_approbation", droit: "documents.verifier", motifObligatoire: false, action: "DOCUMENT_VERIFIE", copie: null },
  refuser_verification: { de: ["en_verification"], vers: "brouillon", droit: "documents.verifier", motifObligatoire: true, action: "DOCUMENT_REFUSE", copie: null },
  approuver: { de: ["en_approbation"], vers: "publie", droit: "documents.approuver", motifObligatoire: false, action: "DOCUMENT_APPROUVE", copie: null },
  refuser_approbation: { de: ["en_approbation"], vers: "brouillon", droit: "documents.approuver", motifObligatoire: true, action: "DOCUMENT_REFUSE", copie: null },
  archiver: { de: ["publie"], vers: "archive", droit: "documents.archiver", motifObligatoire: true, action: "DOCUMENT_ARCHIVE", copie: null },
  reviser: { de: ["publie"], vers: "brouillon", droit: "documents.soumettre", motifObligatoire: false, action: "DOCUMENT_REVISE", copie: null },
  // Revue périodique (revues.ts) : le document publié est revu et maintenu tel quel ; nouvelle échéance.
  confirmer_revue: { de: ["publie"], vers: "publie", droit: "documents.approuver", motifObligatoire: false, action: "DOCUMENT_REVUE_CONFIRMEE", copie: null },
} as const satisfies Record<string, { de: readonly EtatDocument[]; vers: EtatDocument; droit: Droit; motifObligatoire: boolean; action: Action; copie: MotifCopie | null }>;

export type Transition = keyof typeof TRANSITIONS;
export const LISTE_TRANSITIONS = Object.keys(TRANSITIONS) as Transition[];
export const MOTIF_MAX = 2000;

export function estTransition(v: unknown): v is Transition {
  return typeof v === "string" && Object.hasOwn(TRANSITIONS, v);
}

export const MODES_VALIDATION = ["standard", "petite_organisation"] as const;
export type ModeValidation = (typeof MODES_VALIDATION)[number];

/** Les décisions réservées à l'approbateur : elles exigent un second facteur actif. */
export const TRANSITIONS_SECOND_FACTEUR = ["approuver", "refuser_approbation", "archiver", "confirmer_revue"] as const satisfies readonly Transition[];

/** Ce qui, en plus des rôles, conditionne une décision : le mode de l'organisation, le second facteur de la personne. */
export interface ContexteDecision {
  mode: ModeValidation;
  secondFacteurActif: boolean;
}

/**
 * Par défaut (affichage) : mode standard, second facteur supposé actif. Le serveur, lui, lit les deux en base avant
 * chaque décision (appliquerTransition).
 */
export const CONTEXTE_STANDARD: ContexteDecision = { mode: "standard", secondFacteurActif: true };

/** Qui a déjà agi sur la version en cours de circuit : son auteur, celui qui l'a soumise, celui qui l'a vérifiée. */
export interface Intervenants {
  auteur: string | null;
  soumisPar: string | null;
  verifiePar: string | null;
}

/**
 * Refus éventuel d'une transition (règle pure, testée sans base) : clé de message, ou null si elle est permise.
 * Les rôles sont ceux de la personne dans l'organisation ouverte.
 */
export function refusTransition(
  t: Transition, etat: EtatDocument, roles: readonly RoleOrganisation[], personne: string, intervenants: Intervenants, motif: string,
  contexte: ContexteDecision = CONTEXTE_STANDARD,
): string | null {
  const regle = TRANSITIONS[t];
  if (!aLeDroit(roles, regle.droit)) return "erreur.interdit";
  if (!(regle.de as readonly string[]).includes(etat)) return "circuit.etat_incompatible";
  if (regle.motifObligatoire && motif.trim() === "") return "circuit.motif_requis";
  if (motif.length > MOTIF_MAX) return "circuit.motif_trop_long";
  if ((TRANSITIONS_SECOND_FACTEUR as readonly string[]).includes(t) && !contexte.secondFacteurActif) return "circuit.second_facteur_requis";
  const decide = t === "verifier" || t === "refuser_verification" || t === "approuver" || t === "refuser_approbation";
  if (decide && (personne === intervenants.auteur || personne === intervenants.soumisPar)) return "circuit.separation_auteur";
  if (contexte.mode === "standard" && (t === "approuver" || t === "refuser_approbation") && personne === intervenants.verifiePar) return "circuit.separation_verificateur";
  return null;
}

/** Les transitions qu'une personne peut déclencher maintenant (pour n'afficher que les boutons utiles). */
export function transitionsPossibles(
  etat: EtatDocument, roles: readonly RoleOrganisation[], personne: string, intervenants: Intervenants, contexte: ContexteDecision = CONTEXTE_STANDARD,
): Transition[] {
  return LISTE_TRANSITIONS.filter((t) => {
    const r = refusTransition(t, etat, roles, personne, intervenants, "x", contexte);
    return r === null;
  });
}

// ---------------------------------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------------------------------

export interface Decision {
  version: number;
  transition: Transition;
  etatAvant: EtatDocument;
  etatApres: EtatDocument;
  motif: string;
  empreinte: string;
  acteurNom: string;
  decideLe: Date;
}

export interface EtatCircuit {
  id: string;
  type: TypeDocument;
  titre: string;
  reference: string;
  version: number;
  etat: EtatDocument;
  versionPubliee: number | null;
  publieLe: Date | null;
  /** Dernière approbation ou dernière revue confirmée (revues.ts). */
  revueLe: Date | null;
  intervenants: Intervenants;
  decisions: Decision[];
}

// La version en cours de circuit : depuis la dernière soumission (les décisions d'un cycle précédent ne comptent pas).
export async function lireIntervenants(client: PoolClient, id: string, auteur: string | null, etat: EtatDocument): Promise<Intervenants> {
  if (etat !== "en_verification" && etat !== "en_approbation") return { auteur, soumisPar: null, verifiePar: null };
  const r = await client.query<{ transition: Transition; acteur: string | null }>(
    `SELECT transition, acteur FROM decisions_document
      WHERE document_id = $1 AND id >= (SELECT max(id) FROM decisions_document WHERE document_id = $1 AND transition = 'soumettre')
      ORDER BY id`,
    [id],
  );
  return {
    auteur,
    soumisPar: r.rows.find((d) => d.transition === "soumettre")?.acteur ?? null,
    verifiePar: r.rows.find((d) => d.transition === "verifier")?.acteur ?? null,
  };
}

export async function lireCircuit(pool: Pool, org: OrganisationCible, id: string): Promise<EtatCircuit | null> {
  if (!estIdentifiant(id)) return null;
  return avecOrganisation(pool, org, async (client) => {
    const d = await client.query<{ id: string; type: TypeDocument; titre: string; reference: string; version: number; etat: EtatDocument; version_publiee: number | null; publie_le: Date | null; revue_le: Date | null; modifie_par: string | null }>(
      "SELECT id, type, titre, reference, version, etat, version_publiee, publie_le, revue_le, modifie_par FROM documents WHERE id = $1 AND supprime_le IS NULL",
      [id],
    );
    const doc = d.rows[0];
    if (!doc) return null;
    const decisions = await client.query<{ version: number; transition: Transition; etat_avant: EtatDocument; etat_apres: EtatDocument; motif: string; empreinte: string; acteur_nom: string; decide_le: Date }>(
      "SELECT version, transition, etat_avant, etat_apres, motif, empreinte, acteur_nom, decide_le FROM decisions_document WHERE document_id = $1 ORDER BY id DESC",
      [id],
    );
    return {
      id: doc.id, type: doc.type, titre: doc.titre, reference: doc.reference, version: doc.version, etat: doc.etat,
      versionPubliee: doc.version_publiee, publieLe: doc.publie_le, revueLe: doc.revue_le,
      intervenants: await lireIntervenants(client, id, doc.modifie_par, doc.etat),
      decisions: decisions.rows.map((x) => ({
        version: x.version, transition: x.transition, etatAvant: x.etat_avant, etatApres: x.etat_apres, motif: x.motif, empreinte: x.empreinte, acteurNom: x.acteur_nom, decideLe: x.decide_le,
      })),
    };
  });
}

/** Mode de validation de l'organisation et second facteur de la personne (tables de la plateforme). */
export async function lireContexteDecision(client: PoolClient, organisationId: string, personneId: string): Promise<ContexteDecision> {
  const r = await client.query<{ mode: ModeValidation | null; actif: boolean | null }>(
    `SELECT (SELECT mode_validation FROM platform.organisations WHERE id = $1) AS mode,
            (SELECT mfa_active_le IS NOT NULL FROM platform.utilisateurs WHERE id = $2) AS actif`,
    [organisationId, personneId],
  );
  const l = r.rows[0];
  return { mode: l?.mode ?? "standard", secondFacteurActif: l?.actif === true };
}

/**
 * Applique une transition. `versionVue` : la version que la personne avait sous les yeux (refus si le document a changé
 * depuis : elle décide sur ce qu'elle a lu). Les rôles sont revérifiés ici, en plus de l'action.
 */
export async function appliquerTransition(
  pool: Pool,
  org: OrganisationCible,
  id: string,
  t: Transition,
  e: { motif: string; versionVue: number; roles: readonly RoleOrganisation[] },
  acteur: Acteur,
): Promise<{ etat: EtatDocument }> {
  if (!estIdentifiant(id) || !estTransition(t)) throw new ErreurMetier("erreur.introuvable");
  const regle = TRANSITIONS[t];
  const motif = e.motif.trim();
  return enTransaction(pool, async (client) => {
    // Membres actifs (tables de la plateforme : lues avant de passer dans l'organisation), pour les notifications ; mode
    // de validation de l'organisation et second facteur de la personne, LUS EN BASE (jamais fournis par l'appelant).
    const membres = await membresDestinataires(client, org.id);
    const contexte = await lireContexteDecision(client, org.id, acteur.id);
    const r = await dansOrganisation(client, org, async () => {
      const lu = await client.query<{ version: number; etat: EtatDocument; modifie_par: string | null; type: TypeDocument; titre: string; reference: string; empreinte: string }>(
        `SELECT version, etat, modifie_par, type, titre, reference, encode(sha256(convert_to(contenu::text, 'UTF8')), 'hex') AS empreinte
           FROM documents WHERE id = $1 AND supprime_le IS NULL FOR UPDATE`,
        [id],
      );
      const doc = lu.rows[0];
      if (!doc) throw new ErreurMetier("erreur.introuvable");
      if (doc.version !== e.versionVue) throw new ErreurMetier("versions.document_modifie");
      const intervenants = await lireIntervenants(client, id, doc.modifie_par, doc.etat);
      const refus = refusTransition(t, doc.etat, e.roles, acteur.id, intervenants, motif, contexte);
      if (refus) throw new ErreurMetier(refus);

      const decision = await client.query<{ id: string }>(
        `INSERT INTO decisions_document (document_id, version, transition, etat_avant, etat_apres, motif, empreinte, acteur, acteur_nom)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id::text AS id`,
        [id, doc.version, t, doc.etat, regle.vers, motif, doc.empreinte, acteur.id, nomActeur(acteur)],
      );
      if (t === "approuver") {
        await client.query("UPDATE documents SET etat = $2, version_publiee = version, publie_le = now(), revue_le = now() WHERE id = $1", [id, regle.vers]);
      } else if (t === "confirmer_revue") {
        await client.query("UPDATE documents SET revue_le = now() WHERE id = $1", [id]);
      } else {
        await client.query("UPDATE documents SET etat = $2 WHERE id = $1", [id, regle.vers]);
      }
      if (regle.copie) await copier(client, id, regle.copie);

      // Notifications de la décision (jamais à soi-même).
      const destinataires = (() => {
        const soumisPar = t === "soumettre" ? acteur.id : intervenants.soumisPar;
        switch (t) {
          case "soumettre": return { nature: "a_verifier" as const, qui: ayantRole(membres, ["VERIFICATEUR"], [acteur.id, doc.modifie_par]) };
          case "verifier": return { nature: "a_approuver" as const, qui: ayantRole(membres, ["APPROBATEUR"], [acteur.id, doc.modifie_par, soumisPar]) };
          case "refuser_verification":
          case "refuser_approbation":
          case "approuver": {
            const qui = [...new Set([soumisPar, doc.modifie_par])].filter((x): x is string => !!x && x !== acteur.id && membres.some((m) => m.id === x));
            return { nature: t === "approuver" ? ("publie" as const) : ("refuse" as const), qui };
          }
          default: return null;
        }
      })();
      if (destinataires) {
        const liste: NouvelleNotification[] = destinataires.qui.map((destinataire) => ({
          destinataire, nature: destinataires.nature, cle: `circuit:${decision.rows[0]!.id}`, documentId: id,
          details: { titre: doc.titre, reference: doc.reference, version: doc.version, par: nomActeur(acteur), ...(motif && destinataires.nature === "refuse" ? { motif } : {}) },
        }));
        await notifier(client, liste);
      }

      const meta = { type: doc.type, titre: doc.titre, reference: doc.reference };
      const entree: EntreeJournal = {
        action: regle.action, ...traceActeur(acteur), cibleType: "document", cibleId: id,
        details: { ...meta, version: doc.version, transition: t, etatAvant: doc.etat, etatApres: regle.vers, ...(motif ? { motif } : {}), empreinte: doc.empreinte },
      };
      await journaliserOrganisation(client, entree);
      return { entree, type: doc.type };
    });
    // Côté plateforme : l'opération, sans titre ni motif.
    await journaliserPlateforme(client, { ...r.entree, details: { type: r.type, transition: t }, organisationId: org.id });
    return { etat: regle.vers };
  });
}
