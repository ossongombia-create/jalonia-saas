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
// - Soumettre, vérifier et approuver demandent la FONCTION de la personne (migration 0012) ; son nom est celui de son
//   compte. Aucune signature : nom, fonction et date alimentent le tableau de validation du document imprimé.
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
// - Désignation nominative (migration 0013) : à la soumission, la personne désigne le vérificateur et l'approbateur
//   parmi les membres actifs qui ont le rôle (ni elle, ni l'auteur ; en mode standard, deux personnes distinctes).
//   Eux seuls décident ; la personne qui a soumis ou un administrateur peut changer la désignation en cours de route.
//   Sans personne à désigner, la soumission est refusée (message clair). Retour au brouillon : désignations effacées.
//   Document en circuit d'avant la migration (aucune désignation) : tout membre qui a le rôle décide, comme avant.
// - Notifications (notifications/service.ts) : soumis → le vérificateur désigné ; vérifié → l'approbateur désigné ;
//   refusé ou publié → la personne qui a soumis et l'auteur ; 5 jours ouvrés sans décision → relance (taches/).
//   Jamais à soi-même ni à qui la séparation des tâches interdit de décider.
// - Chaque décision est rangée (decisions_document, ajout seul) avec la version, le motif et l'empreinte SHA-256 du
//   contenu : c'est une TRACE D'APPROBATION, pas une signature électronique (aucune valeur légale revendiquée).
import type { Pool, PoolClient } from "pg";
import { aLeDroit, type Droit, type RoleOrganisation } from "@/lib/rbac";
import { joursOuvres, jourLocal } from "@/lib/dates";
import { avecOrganisation, dansOrganisation, enTransaction } from "../db/transactions";
import type { OrganisationCible } from "../membres/service";
import { journaliserOrganisation, journaliserPlateforme, type EntreeJournal } from "../audit/journal";
import type { Action } from "@/lib/actions-journal";
import { ErreurMetier } from "../erreurs";
import { nomActeur, traceActeur, type Acteur } from "../acteur";
import { estIdentifiant, type EtatDocument, type TypeDocument } from "./service";
import { copier, type MotifCopie } from "./copies";
import { ayantRole, membresDestinataires, notifier, type MembreDestinataire, type NouvelleNotification } from "../notifications/service";

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
export const FONCTION_MAX = 200;

/** Les étapes validées par une personne nommée (rédigé, vérifié, approuvé) : sa fonction est demandée. */
export const TRANSITIONS_FONCTION = ["soumettre", "verifier", "approuver"] as const satisfies readonly Transition[];

export function demandeFonction(t: Transition): boolean {
  return (TRANSITIONS_FONCTION as readonly string[]).includes(t);
}

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

/**
 * Qui a déjà agi sur la version en cours de circuit : son auteur, celui qui l'a soumise, celui qui l'a vérifiée ; et
 * qui a été désigné pour vérifier et approuver (absent ou null : pas de désignation, tout membre qui a le rôle décide).
 */
export interface Intervenants {
  auteur: string | null;
  soumisPar: string | null;
  verifiePar: string | null;
  verificateurDesigne?: string | null;
  approbateurDesigne?: string | null;
}

/** Qui peut être désigné : membres actifs qui ont le rôle, hors personnes exclues (celle qui soumet, l'auteur). */
export function candidatsDesignation(membres: readonly MembreDestinataire[], exclus: readonly (string | null | undefined)[]): { verificateurs: MembreDestinataire[]; approbateurs: MembreDestinataire[] } {
  const parmi = (role: RoleOrganisation) => membres.filter((m) => m.roles.includes(role) && !exclus.includes(m.id));
  return { verificateurs: parmi("VERIFICATEUR"), approbateurs: parmi("APPROBATEUR") };
}

/** Refus éventuel d'une désignation à la soumission (règle pure) : clé de message, ou null. */
export function refusDesignation(
  membres: readonly MembreDestinataire[], exclus: readonly (string | null | undefined)[], mode: ModeValidation,
  verificateur: string, approbateur: string,
): string | null {
  const c = candidatsDesignation(membres, exclus);
  if (c.verificateurs.length === 0) return "circuit.aucun_verificateur";
  if (c.approbateurs.length === 0) return "circuit.aucun_approbateur";
  if (mode === "standard" && c.verificateurs.length === 1 && c.approbateurs.length === 1 && c.verificateurs[0]!.id === c.approbateurs[0]!.id) return "circuit.une_seule_personne";
  if (!verificateur || !approbateur) return "circuit.designation_requise";
  if (!c.verificateurs.some((m) => m.id === verificateur)) return "circuit.verificateur_invalide";
  if (!c.approbateurs.some((m) => m.id === approbateur)) return "circuit.approbateur_invalide";
  if (mode === "standard" && verificateur === approbateur) return "circuit.designation_identique";
  return null;
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
  const designe = t === "verifier" || t === "refuser_verification" ? intervenants.verificateurDesigne : t === "approuver" || t === "refuser_approbation" ? intervenants.approbateurDesigne : null;
  if (designe && personne !== designe) return "circuit.reserve_designe";
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
  acteurFonction: string;
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
  /** Personnes désignées (vides hors circuit, ou pour un document soumis avant la migration 0013). */
  designes: Designes;
  /** Dernière décision (soumission, vérification…) : depuis quand le document attend. */
  attendDepuis: Date | null;
  decisions: Decision[];
}

/** Personnes désignées pour la version en circuit (colonnes du document, migration 0013). */
export interface Designes {
  verificateur: { id: string; nom: string } | null;
  approbateur: { id: string; nom: string } | null;
}
export const SANS_DESIGNATION: Designes = { verificateur: null, approbateur: null };
export const COLONNES_DESIGNES = "verificateur_designe, verificateur_designe_nom, approbateur_designe, approbateur_designe_nom";
export type LigneDesignes = { verificateur_designe: string | null; verificateur_designe_nom: string; approbateur_designe: string | null; approbateur_designe_nom: string };
export function designesDe(l: LigneDesignes): Designes {
  return {
    verificateur: l.verificateur_designe ? { id: l.verificateur_designe, nom: l.verificateur_designe_nom } : null,
    approbateur: l.approbateur_designe ? { id: l.approbateur_designe, nom: l.approbateur_designe_nom } : null,
  };
}

// La version en cours de circuit : depuis la dernière soumission (les décisions d'un cycle précédent ne comptent pas).
export async function lireIntervenants(client: PoolClient, id: string, auteur: string | null, etat: EtatDocument, designes: Designes = SANS_DESIGNATION): Promise<Intervenants> {
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
    verificateurDesigne: designes.verificateur?.id ?? null,
    approbateurDesigne: designes.approbateur?.id ?? null,
  };
}

export async function lireCircuit(pool: Pool, org: OrganisationCible, id: string): Promise<EtatCircuit | null> {
  if (!estIdentifiant(id)) return null;
  return avecOrganisation(pool, org, async (client) => {
    const d = await client.query<{ id: string; type: TypeDocument; titre: string; reference: string; version: number; etat: EtatDocument; version_publiee: number | null; publie_le: Date | null; revue_le: Date | null; modifie_par: string | null } & LigneDesignes>(
      `SELECT id, type, titre, reference, version, etat, version_publiee, publie_le, revue_le, modifie_par, ${COLONNES_DESIGNES} FROM documents WHERE id = $1 AND supprime_le IS NULL`,
      [id],
    );
    const doc = d.rows[0];
    if (!doc) return null;
    const decisions = await client.query<{ version: number; transition: Transition; etat_avant: EtatDocument; etat_apres: EtatDocument; motif: string; empreinte: string; acteur_nom: string; acteur_fonction: string; decide_le: Date }>(
      "SELECT version, transition, etat_avant, etat_apres, motif, empreinte, acteur_nom, acteur_fonction, decide_le FROM decisions_document WHERE document_id = $1 ORDER BY id DESC",
      [id],
    );
    return {
      id: doc.id, type: doc.type, titre: doc.titre, reference: doc.reference, version: doc.version, etat: doc.etat,
      versionPubliee: doc.version_publiee, publieLe: doc.publie_le, revueLe: doc.revue_le,
      intervenants: await lireIntervenants(client, id, doc.modifie_par, doc.etat, designesDe(doc)),
      designes: designesDe(doc),
      attendDepuis: decisions.rows[0]?.decide_le ?? null,
      decisions: decisions.rows.map((x) => ({
        version: x.version, transition: x.transition, etatAvant: x.etat_avant, etatApres: x.etat_apres, motif: x.motif, empreinte: x.empreinte, acteurNom: x.acteur_nom, acteurFonction: x.acteur_fonction, decideLe: x.decide_le,
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
  e: { motif: string; versionVue: number; roles: readonly RoleOrganisation[]; fonction?: string; verificateur?: string; approbateur?: string },
  acteur: Acteur,
): Promise<{ etat: EtatDocument }> {
  if (!estIdentifiant(id) || !estTransition(t)) throw new ErreurMetier("erreur.introuvable");
  const regle = TRANSITIONS[t];
  const motif = e.motif.trim();
  // Fonction : demandée aux étapes validées par une personne nommée ; ignorée ailleurs.
  const fonction = demandeFonction(t) ? (e.fonction ?? "").trim() : "";
  return enTransaction(pool, async (client) => {
    // Membres actifs (tables de la plateforme : lues avant de passer dans l'organisation), pour les notifications ; mode
    // de validation de l'organisation et second facteur de la personne, LUS EN BASE (jamais fournis par l'appelant).
    const membres = await membresDestinataires(client, org.id);
    const contexte = await lireContexteDecision(client, org.id, acteur.id);
    const r = await dansOrganisation(client, org, async () => {
      const lu = await client.query<{ version: number; etat: EtatDocument; modifie_par: string | null; type: TypeDocument; titre: string; reference: string; empreinte: string } & LigneDesignes>(
        `SELECT version, etat, modifie_par, type, titre, reference, encode(sha256(convert_to(contenu::text, 'UTF8')), 'hex') AS empreinte, ${COLONNES_DESIGNES}
           FROM documents WHERE id = $1 AND supprime_le IS NULL FOR UPDATE`,
        [id],
      );
      const doc = lu.rows[0];
      if (!doc) throw new ErreurMetier("erreur.introuvable");
      if (doc.version !== e.versionVue) throw new ErreurMetier("versions.document_modifie");
      const intervenants = await lireIntervenants(client, id, doc.modifie_par, doc.etat, designesDe(doc));
      const refus = refusTransition(t, doc.etat, e.roles, acteur.id, intervenants, motif, contexte);
      if (refus) throw new ErreurMetier(refus);
      if (demandeFonction(t) && fonction === "") throw new ErreurMetier("circuit.fonction_requise");
      if (fonction.length > FONCTION_MAX) throw new ErreurMetier("circuit.fonction_trop_longue");
      // Soumettre : le vérificateur et l'approbateur sont désignés par la personne qui soumet (ni elle, ni l'auteur).
      let designes = designesDe(doc);
      if (t === "soumettre") {
        const v = e.verificateur ?? "";
        const a = e.approbateur ?? "";
        const refusD = refusDesignation(membres, [acteur.id, doc.modifie_par], contexte.mode, v, a);
        if (refusD) throw new ErreurMetier(refusD);
        const nom = (x: string) => membres.find((m) => m.id === x)!.nom.slice(0, 200);
        designes = { verificateur: { id: v, nom: nom(v) }, approbateur: { id: a, nom: nom(a) } };
      }

      const decision = await client.query<{ id: string }>(
        `INSERT INTO decisions_document (document_id, version, transition, etat_avant, etat_apres, motif, empreinte, acteur, acteur_nom, acteur_fonction)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id::text AS id`,
        [id, doc.version, t, doc.etat, regle.vers, motif, doc.empreinte, acteur.id, nomActeur(acteur), fonction],
      );
      if (t === "approuver") {
        await client.query("UPDATE documents SET etat = $2, version_publiee = version, publie_le = now(), revue_le = now() WHERE id = $1", [id, regle.vers]);
      } else if (t === "confirmer_revue") {
        await client.query("UPDATE documents SET revue_le = now() WHERE id = $1", [id]);
      } else {
        await client.query("UPDATE documents SET etat = $2 WHERE id = $1", [id, regle.vers]);
      }
      if (regle.copie) await copier(client, id, regle.copie);
      if (t === "soumettre" || regle.vers === "brouillon") {
        if (regle.vers === "brouillon") designes = SANS_DESIGNATION;
        await client.query(
          "UPDATE documents SET verificateur_designe = $2, verificateur_designe_nom = $3, approbateur_designe = $4, approbateur_designe_nom = $5 WHERE id = $1",
          [id, designes.verificateur?.id ?? null, designes.verificateur?.nom ?? "", designes.approbateur?.id ?? null, designes.approbateur?.nom ?? ""],
        );
      }

      // Notifications de la décision (jamais à soi-même).
      const destinataires = (() => {
        const soumisPar = t === "soumettre" ? acteur.id : intervenants.soumisPar;
        switch (t) {
          case "soumettre": return { nature: "a_verifier" as const, qui: [designes.verificateur!.id] };
          case "verifier": return {
            nature: "a_approuver" as const,
            // Désigné : lui seul ; document soumis avant la désignation nominative : tous les approbateurs, comme avant.
            qui: designes.approbateur
              ? [designes.approbateur.id].filter((x) => x !== acteur.id && membres.some((m) => m.id === x))
              : ayantRole(membres, ["APPROBATEUR"], [acteur.id, doc.modifie_par, soumisPar]),
          };
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
        details: { ...meta, version: doc.version, transition: t, etatAvant: doc.etat, etatApres: regle.vers, ...(motif ? { motif } : {}), ...(fonction ? { fonction } : {}), empreinte: doc.empreinte },
      };
      await journaliserOrganisation(client, entree);
      return { entree, type: doc.type };
    });
    // Côté plateforme : l'opération, sans titre ni motif.
    await journaliserPlateforme(client, { ...r.entree, details: { type: r.type, transition: t }, organisationId: org.id });
    return { etat: regle.vers };
  });
}

/** Membres actifs de l'organisation et leurs rôles (pour proposer les personnes à désigner). */
export async function lireMembresActifs(pool: Pool, organisationId: string): Promise<MembreDestinataire[]> {
  return enTransaction(pool, (client) => membresDestinataires(client, organisationId));
}

/** Jours ouvrés sans décision avant de relancer la personne désignée (puis tous les 5 jours ouvrés). */
export const RELANCE_JOURS_OUVRES = 5;

/**
 * Relances (tâches quotidiennes, dans l'organisation) : un document en vérification ou en approbation qui attend la même
 * personne désignée depuis 5 jours ouvrés (puis 10, 15…) lui est rappelé. Une seule relance par palier (clé). Les
 * documents sans désignation (soumis avant la migration 0013) ne sont pas relancés.
 */
export async function relancesValidation(client: PoolClient, membres: readonly MembreDestinataire[], fuseau: string, aujourdhui: string): Promise<NouvelleNotification[]> {
  const r = await client.query<{ id: string; titre: string; reference: string; version: number; etat: EtatDocument; decision: string; decide_le: Date } & LigneDesignes>(
    `SELECT d.id, d.titre, d.reference, d.version, d.etat, x.id::text AS decision, x.decide_le, ${COLONNES_DESIGNES.split(", ").map((c) => `d.${c}`).join(", ")}
       FROM documents d
       JOIN LATERAL (SELECT id, decide_le FROM decisions_document WHERE document_id = d.id ORDER BY id DESC LIMIT 1) x ON true
      WHERE d.etat IN ('en_verification', 'en_approbation') AND d.supprime_le IS NULL ORDER BY d.id`,
  );
  const liste: NouvelleNotification[] = [];
  for (const d of r.rows) {
    const designe = (d.etat === "en_verification" ? designesDe(d).verificateur : designesDe(d).approbateur)?.id;
    if (!designe || !membres.some((m) => m.id === designe)) continue;
    const jours = joursOuvres(jourLocal(d.decide_le, fuseau), aujourdhui);
    if (jours < RELANCE_JOURS_OUVRES) continue;
    const palier = Math.floor(jours / RELANCE_JOURS_OUVRES);
    liste.push({
      destinataire: designe, nature: "validation_relance", cle: `relance:${d.decision}:${designe}:${palier}`, documentId: d.id,
      details: { titre: d.titre, reference: d.reference, version: d.version, jours },
    });
  }
  return liste;
}

export type RoleDesigne = "verificateur" | "approbateur";

/**
 * Change la personne désignée en cours de circuit (absence, départ, erreur) : la personne qui a soumis la version, ou un
 * administrateur de l'organisation. Vérificateur : seulement tant que le document est en vérification ; approbateur :
 * en vérification ou en approbation. Mêmes règles qu'à la soumission ; la nouvelle personne est prévenue.
 */
export async function changerDesignation(
  pool: Pool, org: OrganisationCible, id: string, quoi: RoleDesigne, personne: string, roles: readonly RoleOrganisation[], acteur: Acteur,
): Promise<void> {
  if (!estIdentifiant(id) || !estIdentifiant(personne) || (quoi !== "verificateur" && quoi !== "approbateur")) throw new ErreurMetier("erreur.introuvable");
  await enTransaction(pool, async (client) => {
    const membres = await membresDestinataires(client, org.id);
    const contexte = await lireContexteDecision(client, org.id, acteur.id);
    const r = await dansOrganisation(client, org, async () => {
      const lu = await client.query<{ version: number; etat: EtatDocument; modifie_par: string | null; type: TypeDocument; titre: string; reference: string } & LigneDesignes>(
        `SELECT version, etat, modifie_par, type, titre, reference, ${COLONNES_DESIGNES} FROM documents WHERE id = $1 AND supprime_le IS NULL FOR UPDATE`,
        [id],
      );
      const doc = lu.rows[0];
      if (!doc) throw new ErreurMetier("erreur.introuvable");
      const designes = designesDe(doc);
      const intervenants = await lireIntervenants(client, id, doc.modifie_par, doc.etat, designes);
      if (acteur.id !== intervenants.soumisPar && !roles.includes("ADMIN_ORGANISATION")) throw new ErreurMetier("erreur.interdit");
      const permis = quoi === "verificateur" ? doc.etat === "en_verification" : doc.etat === "en_verification" || doc.etat === "en_approbation";
      if (!permis) throw new ErreurMetier("circuit.etat_incompatible");
      const c = candidatsDesignation(membres, [intervenants.soumisPar, intervenants.auteur]);
      const liste = quoi === "verificateur" ? c.verificateurs : c.approbateurs;
      if (!liste.some((m) => m.id === personne)) throw new ErreurMetier(quoi === "verificateur" ? "circuit.verificateur_invalide" : "circuit.approbateur_invalide");
      // Mode standard : vérificateur et approbateur restent deux personnes distinctes (celle qui a vérifié n'approuve pas).
      const autre = quoi === "verificateur" ? designes.approbateur?.id : (intervenants.verifiePar ?? designes.verificateur?.id);
      if (contexte.mode === "standard" && personne === autre) throw new ErreurMetier("circuit.designation_identique");
      const nom = membres.find((m) => m.id === personne)!.nom.slice(0, 200);
      await client.query(
        quoi === "verificateur"
          ? "UPDATE documents SET verificateur_designe = $2, verificateur_designe_nom = $3 WHERE id = $1"
          : "UPDATE documents SET approbateur_designe = $2, approbateur_designe_nom = $3 WHERE id = $1",
        [id, personne, nom],
      );
      // La nouvelle personne est prévenue si c'est à elle d'agir maintenant (l'approbateur l'est aussi à la vérification).
      // Texte « X a soumis… » / « X a vérifié… » : la personne qui a soumis, ou qui a vérifié.
      const nomDe = (x: string | null) => membres.find((m) => m.id === x)?.nom ?? nomActeur(acteur);
      const aAgir = quoi === "verificateur" || doc.etat === "en_approbation";
      if (aAgir && personne !== acteur.id) {
        await notifier(client, [{
          destinataire: personne, nature: quoi === "verificateur" ? "a_verifier" : "a_approuver", cle: `designation:${id}:${quoi}:${Date.now()}`, documentId: id,
          details: { titre: doc.titre, reference: doc.reference, version: doc.version, par: nomDe(quoi === "verificateur" ? intervenants.soumisPar : intervenants.verifiePar) },
        }]);
      }
      const entree: EntreeJournal = {
        action: "DOCUMENT_DESIGNATION_MODIFIEE", ...traceActeur(acteur), cibleType: "document", cibleId: id,
        details: { type: doc.type, titre: doc.titre, reference: doc.reference, version: doc.version, role: quoi, avant: (quoi === "verificateur" ? designes.verificateur?.nom : designes.approbateur?.nom) ?? "", apres: nom },
      };
      await journaliserOrganisation(client, entree);
      return { entree, type: doc.type };
    });
    await journaliserPlateforme(client, { ...r.entree, details: { type: r.type, role: quoi }, organisationId: org.id });
  });
}

export interface Signataire {
  nom: string;
  fonction: string;
  /** Jour de la décision (AAAA-MM-JJ, fuseau de l'organisation). */
  date: string;
}

/**
 * Tableau « Rédigé / Vérifié / Approuvé » du document imprimé (TC-07), tiré des décisions du circuit : rempli seulement
 * pour un document APPROUVÉ (publié, ou archivé après publication), avec les décisions de la version publiée ; sinon
 * c'est un PROJET (tableau vide, mention « non approuvé » à l'impression). `decisions` : la plus récente d'abord.
 */
export function validationImprimable(
  c: Pick<EtatCircuit, "etat" | "versionPubliee" | "decisions">, jour: (d: Date) => string,
): { etat: "approuve" | "projet"; signataires: { redige: Signataire; verifie: Signataire; approuve: Signataire } | null } {
  const v = c.versionPubliee;
  if ((c.etat !== "publie" && c.etat !== "archive") || v === null) return { etat: "projet", signataires: null };
  const i = c.decisions.findIndex((d) => d.transition === "approuver" && d.version === v);
  const j = i < 0 ? -1 : c.decisions.findIndex((d, k) => k > i && d.transition === "verifier" && d.version === v);
  const k = j < 0 ? -1 : c.decisions.findIndex((d, n) => n > j && d.transition === "soumettre" && d.version === v);
  if (k < 0) return { etat: "projet", signataires: null };
  const sig = (d: Decision): Signataire => ({ nom: d.acteurNom, fonction: d.acteurFonction, date: jour(d.decideLe) });
  return { etat: "approuve", signataires: { redige: sig(c.decisions[k]!), verifie: sig(c.decisions[j]!), approuve: sig(c.decisions[i]!) } };
}

/** Dernière fonction saisie par une personne dans cette organisation (pré-remplissage du formulaire), ou "". */
export async function derniereFonction(pool: Pool, org: OrganisationCible, personneId: string): Promise<string> {
  return avecOrganisation(pool, org, async (client) => {
    const r = await client.query<{ f: string }>(
      "SELECT acteur_fonction AS f FROM decisions_document WHERE acteur = $1 AND acteur_fonction <> '' ORDER BY id DESC LIMIT 1",
      [personneId],
    );
    return r.rows[0]?.f ?? "";
  });
}
