// Plan d'actions de l'organisation (audit Q1 ; migration organisation 0007).
//
// Une action a une origine (risque, opportunité, indicateur, revue, audit, non-conformité, réclamation, autre), peut
// viser un élément d'un document (risque, opportunité ou instruction portant un indicateur), a un responsable (membre
// actif de l'organisation), une échéance et un avancement : à faire ↔ en cours → réalisée → close (efficacité
// vérifiée, ISO 9001 § 10.2), ou abandonnée (motif). Close et abandonnée sont définitives. Aucune action ne se supprime.
// Séparation (décision n° 5 du 19/10/2026, règle dans src/lib/qse.ts) : le responsable fait avancer SON action et en
// écrit le résultat, même sans le droit actions.gerer ; une AUTRE personne ayant ce droit la clôt ou l'abandonne,
// jamais le responsable. L'auteur de la clôture (ou de l'abandon) est rangé avec l'action (migration 0010).
// Chaque création ou modification est inscrite au journal de l'organisation (avec les champs changés) ; la plateforme
// ne reçoit que l'opération. Verrou optimiste : une modification faite sur une page périmée est refusée.
// Notifications : action confiée (au responsable, sauf s'il se l'est confiée lui-même) ; échéances proches, dépassées
// et escaladées (tâches quotidiennes).
import type { Pool, PoolClient } from "pg";
import { ecartJours, estJour, situationEcheance } from "@/lib/dates";
import { estOrigine, estStatut, refusIntervenant, refusStatut, STATUTS_OUVERTS, type OrigineAction, type StatutAction } from "@/lib/qse";
import { aLeDroit, type Role } from "@/lib/rbac";
import { avecOrganisation, dansOrganisation, enTransaction } from "../db/transactions";
import type { OrganisationCible } from "../membres/service";
import { journaliserOrganisation, journaliserPlateforme, type EntreeJournal } from "../audit/journal";
import type { Action as ActionJournal } from "@/lib/actions-journal";
import { ErreurMetier } from "../erreurs";
import { nomActeur, traceActeur, type Acteur } from "../acteur";
import { estIdentifiant } from "../documents/service";
import type { Parametres } from "../documents/revues";
import { ayantRole, notifier, type MembreDestinataire, type NouvelleNotification } from "../notifications/service";
import { trouverElement } from "./registres";

export const TITRE_MAX = 200;
export const DESCRIPTION_MAX = 4000;
export const RESULTAT_MAX = 4000;

export interface ActionQse {
  id: string;
  numero: number;
  titre: string;
  description: string;
  origine: OrigineAction;
  documentId: string | null;
  documentReference: string;
  documentTitre: string;
  elementId: string | null;
  elementLibelle: string;
  responsable: string | null;
  responsableNom: string;
  echeance: string | null;
  statut: StatutAction;
  resultat: string;
  efficace: boolean | null;
  version: number;
  creeParNom: string;
  creeLe: Date;
  modifieParNom: string;
  modifieLe: Date;
  clotureLe: Date | null;
  /** Qui l'a close ou abandonnée (vide pour une action close avant la v1.8 : voir le journal). */
  clotureParNom: string;
}

export interface SaisieAction {
  titre: string;
  description: string;
  origine: string;
  responsableId: string | null;
  echeance: string | null;
}

export interface CreationAction extends SaisieAction {
  documentId?: string | null;
  /** Élément visé dans le document (risque, opportunité, instruction portant un indicateur) : il doit y exister. */
  elementId?: string | null;
}

/**
 * Modification d'une action. Les champs de la saisie (intitulé, description, origine, responsable, échéance) sont
 * facultatifs : absents, ils restent tels quels (formulaire réduit du responsable sans le droit actions.gerer).
 */
export interface ModificationAction extends Partial<SaisieAction> {
  version: number;
  statut: string;
  resultat: string;
  efficace: boolean | null;
}

/** Contrôle des champs saisis (clé de message en cas de refus). */
export function controlerSaisie(s: SaisieAction): string | null {
  const titre = s.titre.trim();
  if (titre.length < 1 || titre.length > TITRE_MAX) return "actions.erreur.titre";
  if (s.description.length > DESCRIPTION_MAX) return "actions.erreur.description";
  if (!estOrigine(s.origine)) return "actions.erreur.origine";
  if (s.echeance !== null && !estJour(s.echeance)) return "actions.erreur.echeance";
  if (s.responsableId !== null && !estIdentifiant(s.responsableId)) return "actions.erreur.responsable";
  return null;
}

const COLONNES = `a.id, a.numero, a.titre, a.description, a.origine, a.document_id, coalesce(d.reference, '') AS document_reference,
  coalesce(d.titre, '') AS document_titre, a.element_id, a.element_libelle, a.responsable, a.responsable_nom, to_char(a.echeance, 'YYYY-MM-DD') AS echeance,
  a.statut, a.resultat, a.efficace, a.version, a.cree_par_nom, a.cree_le, a.modifie_par_nom, a.modifie_le, a.cloture_le, a.cloture_par_nom`;

interface LigneAction {
  id: string; numero: number; titre: string; description: string; origine: OrigineAction; document_id: string | null; document_reference: string;
  document_titre: string; element_id: string | null; element_libelle: string; responsable: string | null; responsable_nom: string; echeance: string | null;
  statut: StatutAction; resultat: string; efficace: boolean | null; version: number; cree_par_nom: string; cree_le: Date; modifie_par_nom: string;
  modifie_le: Date; cloture_le: Date | null; cloture_par_nom: string;
}

function versAction(l: LigneAction): ActionQse {
  return {
    id: l.id, numero: l.numero, titre: l.titre, description: l.description, origine: l.origine, documentId: l.document_id,
    documentReference: l.document_reference, documentTitre: l.document_titre, elementId: l.element_id, elementLibelle: l.element_libelle,
    responsable: l.responsable, responsableNom: l.responsable_nom, echeance: l.echeance, statut: l.statut, resultat: l.resultat, efficace: l.efficace,
    version: l.version, creeParNom: l.cree_par_nom, creeLe: l.cree_le, modifieParNom: l.modifie_par_nom, modifieLe: l.modifie_le, clotureLe: l.cloture_le,
    clotureParNom: l.cloture_par_nom,
  };
}

export interface FiltreActions {
  /** « ouvertes » : à faire et en cours ; « a_verifier » : réalisées (efficacité à vérifier) ; « toutes ». */
  statut?: "ouvertes" | "a_verifier" | "toutes";
  responsable?: string;
  documentId?: string;
}

export async function listerActions(pool: Pool, org: OrganisationCible, filtre: FiltreActions = {}): Promise<ActionQse[]> {
  return avecOrganisation(pool, org, async (client) => {
    const r = await client.query<LigneAction>(
      `SELECT ${COLONNES} FROM actions a LEFT JOIN documents d ON d.id = a.document_id
        WHERE ($1 = 'toutes' OR ($1 = 'ouvertes' AND a.statut IN ('a_faire', 'en_cours')) OR ($1 = 'a_verifier' AND a.statut = 'realisee'))
          AND ($2::uuid IS NULL OR a.responsable = $2::uuid)
          AND ($3::uuid IS NULL OR a.document_id = $3::uuid)
        ORDER BY (a.statut IN ('a_faire', 'en_cours')) DESC, a.echeance NULLS LAST, a.numero DESC`,
      [filtre.statut ?? "toutes", filtre.responsable && estIdentifiant(filtre.responsable) ? filtre.responsable : null, filtre.documentId && estIdentifiant(filtre.documentId) ? filtre.documentId : null],
    );
    return r.rows.map(versAction);
  });
}

export async function lireAction(pool: Pool, org: OrganisationCible, id: string): Promise<ActionQse | null> {
  if (!estIdentifiant(id)) return null;
  return avecOrganisation(pool, org, async (client) => {
    const r = await client.query<LigneAction>(`SELECT ${COLONNES} FROM actions a LEFT JOIN documents d ON d.id = a.document_id WHERE a.id = $1`, [id]);
    return r.rows[0] ? versAction(r.rows[0]) : null;
  });
}

/** Le responsable désigné : un membre ACTIF de l'organisation (tables de la plateforme : hors de l'organisation). */
async function responsableValide(client: PoolClient, organisationId: string, id: string | null): Promise<{ id: string; nom: string } | null> {
  if (id === null) return null;
  const r = await client.query<{ nom: string; email: string }>(
    `SELECT u.nom, u.email FROM platform.adhesions a JOIN platform.utilisateurs u ON u.id = a.utilisateur_id
      WHERE a.organisation_id = $1 AND a.utilisateur_id = $2 AND u.statut = 'actif'`,
    [organisationId, id],
  );
  const l = r.rows[0];
  if (!l) throw new ErreurMetier("actions.erreur.responsable");
  return { id, nom: (l.nom ?? "").trim() || l.email };
}

function notificationConfiee(a: { id: string; titre: string; echeance: string | null }, responsable: string, cle: string, acteur: Acteur): NouvelleNotification {
  return { destinataire: responsable, nature: "action_confiee", cle, actionId: a.id, details: { titre: a.titre, par: nomActeur(acteur), ...(a.echeance ? { echeance: a.echeance } : {}) } };
}

async function journaliser(client: PoolClient, org: OrganisationCible, action: ActionJournal, id: string, acteur: Acteur, detailsOrg: Record<string, unknown>, detailsPlateforme: Record<string, unknown>) {
  const entree: EntreeJournal = { action, ...traceActeur(acteur), cibleType: "action", cibleId: id, details: detailsOrg };
  await dansOrganisation(client, org, () => journaliserOrganisation(client, entree));
  await journaliserPlateforme(client, { ...entree, details: detailsPlateforme, organisationId: org.id });
}

export async function creerAction(pool: Pool, org: OrganisationCible, e: CreationAction, acteur: Acteur): Promise<{ id: string; numero: number }> {
  const refus = controlerSaisie(e);
  if (refus) throw new ErreurMetier(refus);
  const documentId = e.documentId ?? null;
  const elementId = e.elementId?.trim() ? e.elementId.trim() : null;
  if (documentId !== null && !estIdentifiant(documentId)) throw new ErreurMetier("actions.erreur.document");
  if (elementId !== null && (documentId === null || elementId.length > 100)) throw new ErreurMetier("actions.erreur.document");
  const titre = e.titre.trim();
  return enTransaction(pool, async (client) => {
    const responsable = await responsableValide(client, org.id, e.responsableId);
    const cree = await dansOrganisation(client, org, async () => {
      if (documentId !== null) {
        const d = await client.query("SELECT 1 FROM documents WHERE id = $1 AND supprime_le IS NULL", [documentId]);
        if (d.rowCount === 0) throw new ErreurMetier("actions.erreur.document");
      }
      // Le texte de l'élément visé est lu dans le document (jamais repris de la saisie).
      const element = elementId !== null && documentId !== null ? await trouverElement(client, documentId, elementId) : null;
      if (elementId !== null && !element) throw new ErreurMetier("actions.erreur.document");
      const elementLibelle = (element?.libelle ?? "").slice(0, 500);
      const r = await client.query<{ id: string; numero: number }>(
        `INSERT INTO actions (titre, description, origine, document_id, element_id, element_libelle, responsable, responsable_nom, echeance,
                              cree_par, cree_par_nom, modifie_par, modifie_par_nom)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $10, $11) RETURNING id, numero`,
        [titre, e.description, e.origine, documentId, elementId, elementLibelle, responsable?.id ?? null, responsable?.nom ?? "", e.echeance, acteur.id, nomActeur(acteur)],
      );
      const a = r.rows[0]!;
      if (responsable && responsable.id !== acteur.id) {
        await notifier(client, [notificationConfiee({ id: a.id, titre, echeance: e.echeance }, responsable.id, `action:${a.id}:confiee:1`, acteur)]);
      }
      return a;
    });
    await journaliser(client, org, "ACTION_CREEE", cree.id, acteur,
      { numero: cree.numero, titre, origine: e.origine, responsable: responsable?.nom ?? null, echeance: e.echeance, ...(documentId ? { documentId, elementId } : {}) },
      { origine: e.origine });
    return cree;
  });
}

/**
 * `roles` : rôles de la personne dans l'organisation ouverte (le droit actions.gerer en dépend) ; sans ce droit, seul
 * le responsable de l'action peut la faire avancer.
 */
export async function modifierAction(pool: Pool, org: OrganisationCible, id: string, e: ModificationAction, acteur: Acteur, roles: readonly Role[]): Promise<{ version: number; statut: StatutAction }> {
  if (!estIdentifiant(id)) throw new ErreurMetier("erreur.introuvable");
  if (!estStatut(e.statut)) throw new ErreurMetier("actions.statut_impossible");
  if (e.resultat.length > RESULTAT_MAX) throw new ErreurMetier("actions.erreur.resultat");
  const statut: StatutAction = e.statut;
  const gestionnaire = aLeDroit(roles, "actions.gerer");
  return enTransaction(pool, async (client) => {
    const { r, saisie } = await dansOrganisation(client, org, async () => {
      const lu = await client.query<LigneAction>(`SELECT ${COLONNES} FROM actions a LEFT JOIN documents d ON d.id = a.document_id WHERE a.id = $1 FOR UPDATE OF a`, [id]);
      const avant = lu.rows[0] ? versAction(lu.rows[0]) : null;
      if (!avant) throw new ErreurMetier("erreur.introuvable");
      // Ni gestionnaire ni responsable : refusé avant tout autre contrôle (rien n'est dit de l'action).
      if (!gestionnaire && avant.responsable !== acteur.id) throw new ErreurMetier("erreur.interdit");
      // Champs absents : inchangés.
      const saisie: SaisieAction = {
        titre: e.titre ?? avant.titre, description: e.description ?? avant.description, origine: e.origine ?? avant.origine,
        responsableId: e.responsableId === undefined ? avant.responsable : e.responsableId, echeance: e.echeance === undefined ? avant.echeance : e.echeance,
      };
      const refusSaisie = controlerSaisie(saisie);
      if (refusSaisie) throw new ErreurMetier(refusSaisie);
      if (avant.version !== e.version) throw new ErreurMetier("actions.modifiee");
      const reservesModifies = saisie.titre.trim() !== avant.titre || saisie.description !== avant.description || saisie.origine !== avant.origine
        || saisie.responsableId !== avant.responsable || saisie.echeance !== avant.echeance;
      const responsable = avant.responsable === acteur.id || saisie.responsableId === acteur.id;
      const refus = refusIntervenant(avant.statut, statut, { gestionnaire, responsable }, reservesModifies)
        ?? refusStatut(avant.statut, statut, statut === "cloturee" ? e.efficace : null, e.resultat);
      if (refus) throw new ErreurMetier(refus);
      return { r: avant, saisie };
    });
    const titre = saisie.titre.trim();
    // Responsable : vérifié seulement s'il change (un responsable parti reste nommé sur ses anciennes actions).
    const responsable = saisie.responsableId === r.responsable ? (r.responsable ? { id: r.responsable, nom: r.responsableNom } : null) : await responsableValide(client, org.id, saisie.responsableId);
    const efficace = statut === "cloturee" ? e.efficace : null;
    const apres = { titre, description: saisie.description, origine: saisie.origine, responsable: responsable?.nom ?? null, echeance: saisie.echeance, statut, resultat: e.resultat, efficace };
    const avantVue = { titre: r.titre, description: r.description, origine: r.origine, responsable: r.responsable ? r.responsableNom : null, echeance: r.echeance, statut: r.statut, resultat: r.resultat, efficace: r.efficace };
    const changements = Object.fromEntries(
      (Object.keys(apres) as (keyof typeof apres)[]).filter((k) => apres[k] !== avantVue[k]).map((k) => [k, { avant: avantVue[k], apres: apres[k] }]),
    );
    if (Object.keys(changements).length === 0) return { version: r.version, statut: r.statut };
    const version = r.version + 1;
    await dansOrganisation(client, org, async () => {
      await client.query(
        `UPDATE actions SET titre = $2, description = $3, origine = $4, responsable = $5, responsable_nom = $6, echeance = $7, statut = $8, resultat = $9,
                efficace = $10, version = $11, modifie_par = $12, modifie_par_nom = $13, modifie_le = now(),
                cloture_le = CASE WHEN $8 IN ('cloturee', 'abandonnee') THEN coalesce(cloture_le, now()) ELSE NULL END,
                cloture_par = CASE WHEN $8 IN ('cloturee', 'abandonnee') THEN $12::uuid ELSE NULL END,
                cloture_par_nom = CASE WHEN $8 IN ('cloturee', 'abandonnee') THEN $13 ELSE '' END
          WHERE id = $1`,
        [id, titre, saisie.description, saisie.origine, responsable?.id ?? null, responsable?.nom ?? "", saisie.echeance, statut, e.resultat, efficace, version, acteur.id, nomActeur(acteur)],
      );
      if (responsable && responsable.id !== r.responsable && responsable.id !== acteur.id) {
        await notifier(client, [notificationConfiee({ id, titre, echeance: saisie.echeance }, responsable.id, `action:${id}:confiee:${version}`, acteur)]);
      }
    });
    const nature: ActionJournal = statut !== r.statut && statut === "cloturee" ? "ACTION_CLOTUREE" : statut !== r.statut && statut === "abandonnee" ? "ACTION_ABANDONNEE" : "ACTION_MODIFIEE";
    await journaliser(client, org, nature, id, acteur, { numero: r.numero, titre, changements }, { champs: Object.keys(changements) });
    return { version, statut };
  });
}

/**
 * Échéances des actions OUVERTES (tâches quotidiennes ; client DANS l'organisation) : rappel au responsable dans les
 * `rappelJours` jours, retard au responsable, escalade aux administrateurs après `escaladeJours` jours de retard.
 * Sans responsable actif, ce sont les administrateurs qui sont prévenus.
 */
export async function echeancesActions(client: PoolClient, membres: readonly MembreDestinataire[], p: Parametres, aujourdhui: string): Promise<NouvelleNotification[]> {
  const r = await client.query<{ id: string; titre: string; responsable: string | null; echeance: string }>(
    `SELECT id, titre, responsable, to_char(echeance, 'YYYY-MM-DD') AS echeance FROM actions
      WHERE statut = ANY ($1::text[]) AND echeance IS NOT NULL ORDER BY id`,
    [STATUTS_OUVERTS],
  );
  const admins = ayantRole(membres, ["ADMIN_ORGANISATION"]);
  const liste: NouvelleNotification[] = [];
  for (const a of r.rows) {
    const situation = situationEcheance(a.echeance, aujourdhui, p.rappelJours, p.escaladeJours);
    if (situation === "a_jour") continue;
    const responsables = a.responsable && membres.some((m) => m.id === a.responsable) ? [a.responsable] : admins;
    const vers = (qui: readonly string[], nature: NouvelleNotification["nature"], stade: string, plus: object = {}) => {
      for (const destinataire of qui) liste.push({ destinataire, nature, cle: `action:${a.id}:${a.echeance}:${stade}`, actionId: a.id, details: { titre: a.titre, echeance: a.echeance, ...plus } });
    };
    if (situation === "proche") vers(responsables, "action_proche", "proche");
    else {
      vers(responsables, "action_retard", "retard");
      if (situation === "escalade") vers(admins, "action_escalade", "escalade", { jours: ecartJours(a.echeance, aujourdhui) });
    }
  }
  return liste;
}

/** Nombre d'actions OUVERTES par élément de document (registres) : clé « documentId:elementId ». */
export async function actionsOuvertesParElement(client: PoolClient): Promise<Map<string, number>> {
  const r = await client.query<{ document_id: string; element_id: string; n: number }>(
    `SELECT document_id, element_id, count(*)::int AS n FROM actions
      WHERE document_id IS NOT NULL AND element_id IS NOT NULL AND statut IN ('a_faire', 'en_cours', 'realisee')
      GROUP BY document_id, element_id`,
  );
  return new Map(r.rows.map((l) => [`${l.document_id}:${l.element_id}`, l.n]));
}

export interface EvenementAction {
  horodatage: Date;
  action: ActionJournal;
  acteurEmail: string | null;
  changements: Record<string, { avant: unknown; apres: unknown }>;
}

/** Historique d'une action, lu dans le journal de l'organisation (le plus récent d'abord, 200 au plus). */
export async function historiqueAction(pool: Pool, org: OrganisationCible, id: string): Promise<EvenementAction[]> {
  if (!estIdentifiant(id)) return [];
  return avecOrganisation(pool, org, async (client) => {
    const r = await client.query<{ horodatage: Date; action: ActionJournal; acteur_email: string | null; details: { changements?: Record<string, { avant: unknown; apres: unknown }> } | null }>(
      "SELECT horodatage, action, acteur_email, details FROM journal WHERE cible_type = 'action' AND cible_id = $1 ORDER BY id DESC LIMIT 200",
      [id],
    );
    return r.rows.map((l) => ({ horodatage: l.horodatage, action: l.action, acteurEmail: l.acteur_email, changements: l.details?.changements ?? {} }));
  });
}
