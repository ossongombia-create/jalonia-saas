// Documents Qualigramme d'une organisation : procédures (niveau 2), instructions de travail (niveau 3) et
// cartographie des processus (niveau 1, une seule par organisation).
//
// Le contenu est celui de l'éditeur (le même objet que les fichiers .json de l'application d'origine). C'est
// l'éditeur qui le « nettoie » champ par champ à l'ouverture (store.js et cartographie.js), exactement comme un
// fichier .json ouvert depuis le disque. Ici, le serveur contrôle la FORME (objet, tableaux attendus,
// profondeur, taille), retire ce que PostgreSQL ne sait pas ranger (caractère nul, demi-caractères), et gère
// les versions : un enregistrement fait à partir d'une version dépassée est refusé (ConflitVersion) au lieu
// d'écraser le travail d'un collègue — sauf si la personne choisit explicitement de garder sa version.
//
// Toutes les requêtes passent par le rôle PostgreSQL de l'organisation (dansOrganisation) : elles ne peuvent
// atteindre que les tables de cette organisation. Chaque création, modification et suppression est tracée
// dans le journal de l'organisation ET dans celui de la plateforme (ce dernier sans le titre des documents).
import type { Pool, PoolClient } from "pg";
import { avecOrganisation, dansOrganisation, enTransaction } from "../db/transactions";
import type { OrganisationCible } from "../membres/service";
import { journaliserOrganisation, journaliserPlateforme, type EntreeJournal } from "../audit/journal";
import { ErreurMetier } from "../erreurs";
import { nomActeur, traceActeur, type Acteur } from "../acteur";
import { analyserCoherence, dependancesDe, lireLiens, lireProcessusCartographie, type Constat, type Dependance } from "./coherence";
import { copier, copiesAPrendre, derniereCopie } from "./copies";

/** Taille maximale d'un contenu (JSON compact, en octets) : la limite des fichiers .json de l'éditeur. */
export const TAILLE_MAX_CONTENU = 2_000_000;
/** Profondeur maximale d'imbrication d'un contenu (un document de l'éditeur en compte moins de 10). */
export const PROFONDEUR_MAX = 32;
/** Les enregistrements automatiques d'une même personne sur une même cible sont tracés une fois par période. */
export const REGROUPEMENT_MINUTES = 30;

export type TypeDocument = "" | "procedure" | "instruction";
export const TYPES_CREATION = ["procedure", "instruction"] as const;
export type TypeCreation = (typeof TYPES_CREATION)[number];

export type Contenu = Record<string, unknown>;

/** État dans le circuit de validation (circuit.ts) : seul un brouillon se modifie. */
export type EtatDocument = "brouillon" | "en_verification" | "en_approbation" | "publie" | "archive";

export interface ResumeDocument {
  id: string;
  type: TypeDocument;
  etat: EtatDocument;
  versionPubliee: number | null;
  titre: string;
  reference: string;
  version: number;
  creeParNom: string;
  creeLe: Date;
  modifieParNom: string;
  modifieLe: Date;
}

export interface DocumentComplet extends ResumeDocument {
  contenu: Contenu;
}

/** Où en est un document (ou la cartographie) : sa version et son dernier auteur. */
export interface EtatVersion {
  version: number;
  modifieParNom: string;
  modifieLe: Date | null;
}

export interface CartographieStockee extends EtatVersion {
  contenu: Contenu;
}

/** Enregistrement refusé : quelqu'un a enregistré une version plus récente entre-temps. */
export class ConflitVersion extends Error {
  constructor(public readonly actuel: EtatVersion) {
    super("conflit de version");
    this.name = "ConflitVersion";
  }
}

export interface Enregistrement {
  contenu: unknown;
  /** Version sur laquelle la personne a travaillé (celle reçue à l'ouverture ou au dernier enregistrement). */
  version: number;
  /** Vrai : remplacer la version du serveur même si elle a changé (choix explicite après un conflit). */
  forcer?: boolean;
}

const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function estIdentifiant(valeur: unknown): valeur is string {
  return typeof valeur === "string" && MOTIF_UUID.test(valeur);
}

function estObjet(v: unknown): v is Contenu {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Copie « rangeable » d'une valeur JSON : sans caractère nul (refusé par PostgreSQL dans un jsonb), avec les
 * demi-caractères isolés remplacés par « � » (sinon refusés aussi), profondeur limitée.
 */
function texteRangeable(s: string): string {
  return s.replaceAll("\u0000", "").toWellFormed();
}

function assainir(valeur: unknown, profondeur = 0): unknown {
  if (profondeur > PROFONDEUR_MAX) throw new ErreurMetier("docs.erreur.contenu_invalide");
  if (typeof valeur === "string") return texteRangeable(valeur);
  if (typeof valeur === "number") {
    if (!Number.isFinite(valeur)) throw new ErreurMetier("docs.erreur.contenu_invalide");
    return valeur;
  }
  if (typeof valeur === "boolean" || valeur === null) return valeur;
  if (Array.isArray(valeur)) return valeur.map((v) => assainir(v, profondeur + 1));
  // Object.fromEntries crée de vraies propriétés : une clé « __proto__ » reste une donnée, sans toucher au prototype.
  if (estObjet(valeur)) return Object.fromEntries(Object.entries(valeur).map(([cle, v]) => [texteRangeable(cle), assainir(v, profondeur + 1)]));
  throw new ErreurMetier("docs.erreur.contenu_invalide"); // undefined, fonction… : n'existe pas en JSON
}

function controlerTaille(contenu: Contenu): string {
  const texte = JSON.stringify(contenu);
  if (Buffer.byteLength(texte, "utf8") > TAILLE_MAX_CONTENU) throw new ErreurMetier("docs.erreur.trop_volumineux");
  return texte;
}

/** Contenu d'un document (procédure ou instruction) : la forme attendue par l'éditeur. Renvoie le JSON à ranger. */
export function preparerContenuDocument(brut: unknown): { contenu: Contenu; json: string } {
  if (!estObjet(brut) || !Array.isArray(brut.roles) || !Array.isArray(brut.etapes) || ("meta" in brut && !estObjet(brut.meta))) {
    throw new ErreurMetier("docs.erreur.contenu_invalide");
  }
  const contenu = assainir(brut) as Contenu;
  return { contenu, json: controlerTaille(contenu) };
}

/** Contenu de la cartographie : la forme produite par l'éditeur (processus, échanges, registre des documents). */
export function preparerContenuCartographie(brut: unknown): { contenu: Contenu; json: string } {
  if (!estObjet(brut) || !Array.isArray(brut.processus) || !Array.isArray(brut.flux) || !Array.isArray(brut.documents)) {
    throw new ErreurMetier("docs.erreur.contenu_invalide");
  }
  const contenu = assainir(brut) as Contenu;
  return { contenu, json: controlerTaille(contenu) };
}

function texteCourt(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, 500).toWellFormed() : "";
}

/** Titre, code et type d'un document, lus dans son contenu (pour la liste des documents). */
export function metaDepuisContenu(contenu: Contenu): { type: TypeDocument; titre: string; reference: string } {
  const meta = estObjet(contenu.meta) ? contenu.meta : {};
  const t = meta.typeDocument;
  // « les_deux » (fichiers d'avant la v0.16 de l'éditeur) se rouvre comme une procédure.
  const type: TypeDocument = t === "procedure" || t === "instruction" ? t : t === "les_deux" ? "procedure" : "";
  return { type, titre: texteCourt(meta.titre), reference: texteCourt(meta.reference) };
}

/** Contenu d'un document neuf : l'éditeur le complète à l'ouverture (comme « Nouvelle procédure »). */
export function contenuInitial(type: TypeCreation): Contenu {
  return { meta: { typeDocument: type }, roles: [], etapes: [] };
}

// ---------------------------------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------------------------------

/** Vrai si la personne a déjà une trace de cette opération sur cette cible pendant la période de regroupement. */
async function dejaTrace(client: PoolClient, action: string, acteurId: string, cibleId: string | null): Promise<boolean> {
  const r = cibleId
    ? await client.query(
        `SELECT 1 FROM journal
          WHERE cible_id = $1 AND action = $2 AND acteur_id = $3 AND horodatage > now() - ($4::int * interval '1 minute')
          LIMIT 1`,
        [cibleId, action, acteurId, REGROUPEMENT_MINUTES],
      )
    : await client.query(
        `SELECT 1 FROM journal
          WHERE action = $1 AND acteur_id = $2 AND horodatage > now() - ($3::int * interval '1 minute')
          LIMIT 1`,
        [action, acteurId, REGROUPEMENT_MINUTES],
      );
  return (r.rowCount ?? 0) > 0;
}

/** Trace côté plateforme : mêmes opération, personne et cible, sans le contenu des détails (titres…). */
function versPlateforme(org: OrganisationCible, e: EntreeJournal, details: Record<string, unknown>) {
  return { ...e, details, organisationId: org.id };
}

// ---------------------------------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------------------------------

interface LigneDocument {
  id: string;
  type: TypeDocument;
  etat: EtatDocument;
  version_publiee: number | null;
  titre: string;
  reference: string;
  version: number;
  cree_par_nom: string;
  cree_le: Date;
  modifie_par_nom: string;
  modifie_le: Date;
}

const COLONNES_RESUME = "id, type, etat, version_publiee, titre, reference, version, cree_par_nom, cree_le, modifie_par_nom, modifie_le";

function versResume(l: LigneDocument): ResumeDocument {
  return {
    id: l.id, type: l.type, etat: l.etat, versionPubliee: l.version_publiee, titre: l.titre, reference: l.reference, version: l.version,
    creeParNom: l.cree_par_nom, creeLe: l.cree_le, modifieParNom: l.modifie_par_nom, modifieLe: l.modifie_le,
  };
}

export async function listerDocuments(pool: Pool, org: OrganisationCible): Promise<ResumeDocument[]> {
  return avecOrganisation(pool, org, async (client) => {
    const r = await client.query<LigneDocument>(`SELECT ${COLONNES_RESUME} FROM documents WHERE supprime_le IS NULL ORDER BY modifie_le DESC, id`);
    return r.rows.map(versResume);
  });
}

export async function lireDocument(pool: Pool, org: OrganisationCible, id: string): Promise<DocumentComplet | null> {
  if (!estIdentifiant(id)) return null;
  return avecOrganisation(pool, org, async (client) => {
    // Un document à la corbeille ne s'ouvre plus (l'éditeur l'annonce comme supprimé) : il se rétablit d'abord.
    const r = await client.query<LigneDocument & { contenu: Contenu }>(`SELECT ${COLONNES_RESUME}, contenu FROM documents WHERE id = $1 AND supprime_le IS NULL`, [id]);
    const l = r.rows[0];
    return l ? { ...versResume(l), contenu: l.contenu } : null;
  });
}

export async function creerDocument(pool: Pool, org: OrganisationCible, brut: unknown, acteur: Acteur): Promise<{ id: string; version: number }> {
  const { contenu, json } = preparerContenuDocument(brut);
  const meta = metaDepuisContenu(contenu);
  const nom = nomActeur(acteur);
  return enTransaction(pool, async (client) => {
    const r = await dansOrganisation(client, org, async () => {
      const ins = await client.query<{ id: string; version: number }>(
        `INSERT INTO documents (type, titre, reference, contenu, cree_par, cree_par_nom, modifie_par, modifie_par_nom)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $5, $6)
         RETURNING id, version`,
        [meta.type, meta.titre, meta.reference, json, acteur.id, nom],
      );
      const doc = ins.rows[0]!;
      await copier(client, doc.id, "creation");
      const entree: EntreeJournal = { action: "DOCUMENT_CREE", ...traceActeur(acteur), cibleType: "document", cibleId: doc.id, details: meta };
      await journaliserOrganisation(client, entree);
      return { doc, entree };
    });
    await journaliserPlateforme(client, versPlateforme(org, r.entree, { type: meta.type }));
    return r.doc;
  });
}

export async function enregistrerDocument(pool: Pool, org: OrganisationCible, id: string, e: Enregistrement, acteur: Acteur): Promise<EtatVersion> {
  if (!estIdentifiant(id)) throw new ErreurMetier("erreur.introuvable");
  if (!Number.isSafeInteger(e.version) || e.version < 0) throw new ErreurMetier("erreur.saisie_invalide");
  const { contenu, json } = preparerContenuDocument(e.contenu);
  const meta = metaDepuisContenu(contenu);
  const nom = nomActeur(acteur);
  return enTransaction(pool, async (client) => {
    const r = await dansOrganisation(client, org, async () => {
      const lu = await client.query<{ version: number; etat: EtatDocument; modifie_par: string | null; modifie_par_nom: string; modifie_le: Date; validation: string | null }>(
        `SELECT version, etat, modifie_par, modifie_par_nom, modifie_le,
                CASE WHEN jsonb_typeof(contenu -> 'validation') = 'string' THEN contenu ->> 'validation' END AS validation
           FROM documents WHERE id = $1 AND supprime_le IS NULL FOR UPDATE`,
        [id],
      );
      const avant = lu.rows[0];
      if (!avant) throw new ErreurMetier("erreur.introuvable");
      if (avant.etat !== "brouillon") throw new ErreurMetier("circuit.non_modifiable"); // version soumise, publiée ou archivée : figée
      const ecrase = avant.version !== e.version;
      if (ecrase && !e.forcer) throw new ConflitVersion({ version: avant.version, modifieParNom: avant.modifie_par_nom, modifieLe: avant.modifie_le });
      // Historique (copies.ts) : l'état d'un collègue ou l'état remplacé est copié AVANT d'écrire ; le nouvel état ensuite
      // s'il marque une étape (remplacement, validation) ou si la période est écoulée.
      const copies = copiesAPrendre({
        derniere: await derniereCopie(client, id),
        versionAvant: avant.version,
        auteurAvant: avant.modifie_par,
        auteur: acteur.id,
        force: ecrase,
        validationAvant: avant.validation ?? "",
        validationApres: typeof contenu.validation === "string" ? contenu.validation : "",
        maintenant: new Date(),
      });
      if (copies.avant) await copier(client, id, copies.avant);
      const maj = await client.query<{ version: number; modifie_le: Date }>(
        `UPDATE documents
            SET contenu = $2::jsonb, type = $3, titre = $4, reference = $5, version = version + 1,
                modifie_par = $6, modifie_par_nom = $7, modifie_le = now()
          WHERE id = $1
          RETURNING version, modifie_le`,
        [id, json, meta.type, meta.titre, meta.reference, acteur.id, nom],
      );
      const apres = maj.rows[0]!;
      if (copies.apres) await copier(client, id, copies.apres);
      // Un remplacement de la version d'un collègue est toujours tracé ; un enregistrement ordinaire, une fois par période.
      let entree: EntreeJournal | null = null;
      if (ecrase || !(await dejaTrace(client, "DOCUMENT_MODIFIE", acteur.id, id))) {
        entree = {
          action: "DOCUMENT_MODIFIE", ...traceActeur(acteur), cibleType: "document", cibleId: id,
          details: ecrase ? { ...meta, versionRemplacee: avant.version, auteurRemplace: avant.modifie_par_nom } : meta,
        };
        await journaliserOrganisation(client, entree);
      }
      return { etat: { version: apres.version, modifieParNom: nom, modifieLe: apres.modifie_le }, entree, ecrase };
    });
    if (r.entree) await journaliserPlateforme(client, versPlateforme(org, r.entree, r.ecrase ? { type: meta.type, remplacement: true } : { type: meta.type }));
    return r.etat;
  });
}

/**
 * Met un document à la corbeille (il se rétablit : versions.ts). S'il est lié à d'autres (instructions de travail d'une
 * procédure, procédure qui cite une instruction ou appelle une sous-procédure : voir coherence.ts), la suppression exige
 * `confirmerLiens` — la personne a vu l'avertissement — et les documents liés ne sont jamais supprimés avec lui. Les
 * liens confirmés sont tracés.
 */
export async function supprimerDocument(pool: Pool, org: OrganisationCible, id: string, acteur: Acteur, options: { confirmerLiens?: boolean } = {}): Promise<void> {
  if (!estIdentifiant(id)) throw new ErreurMetier("erreur.introuvable");
  await enTransaction(pool, async (client) => {
    const r = await dansOrganisation(client, org, async () => {
      const etat = await client.query<{ etat: EtatDocument }>("SELECT etat FROM documents WHERE id = $1 AND supprime_le IS NULL FOR UPDATE", [id]);
      if (etat.rows[0] && etat.rows[0].etat !== "brouillon") throw new ErreurMetier("circuit.suppression_impossible"); // publié : on l'archive
      const liees = dependancesDe(await lireLiens(client), id);
      if (liees.length > 0 && !options.confirmerLiens) throw new ErreurMetier("docs.suppression_liee");
      // Corbeille (migration 0004) : le document est marqué, jamais effacé ; son état est copié dans l'historique.
      const sup = await client.query<{ type: TypeDocument; titre: string; reference: string; version: number }>(
        `UPDATE documents SET supprime_le = now(), supprime_par = $2, supprime_par_nom = $3
          WHERE id = $1 AND supprime_le IS NULL AND etat = 'brouillon' RETURNING type, titre, reference, version`,
        [id, acteur.id, nomActeur(acteur)],
      );
      const d = sup.rows[0];
      if (!d) throw new ErreurMetier("erreur.introuvable");
      await copier(client, id, "suppression");
      const details = liees.length > 0 ? { ...d, liensConfirmes: liees.map((l) => ({ id: l.id, lien: l.lien, reference: l.reference, titre: l.titre })) } : d;
      const entree: EntreeJournal = { action: "DOCUMENT_SUPPRIME", ...traceActeur(acteur), cibleType: "document", cibleId: id, details };
      await journaliserOrganisation(client, entree);
      return { entree, type: d.type };
    });
    await journaliserPlateforme(client, versPlateforme(org, r.entree, { type: r.type }));
  });
}

export interface Coherence {
  constats: Constat[];
  /** Pour chaque document lié à d'autres : ces documents (avertissement avant suppression). */
  dependances: Record<string, Dependance[]>;
}

/** Contrôles de cohérence entre tous les documents de l'organisation (coherence.ts) : ils signalent, sans rien modifier. */
export async function lireCoherence(pool: Pool, org: OrganisationCible): Promise<Coherence> {
  return avecOrganisation(pool, org, async (client) => {
    const [liens, processus] = [await lireLiens(client), await lireProcessusCartographie(client)];
    const dependances: Record<string, Dependance[]> = {};
    for (const d of liens) {
      const liees = dependancesDe(liens, d.id);
      if (liees.length > 0) dependances[d.id] = liees;
    }
    return { constats: analyserCoherence(liens, processus), dependances };
  });
}

// ---------------------------------------------------------------------------------------------------
// Cartographie (une seule par organisation : ligne id = 1, créée par la migration, version 0 au départ)
// ---------------------------------------------------------------------------------------------------

export async function lireCartographie(pool: Pool, org: OrganisationCible): Promise<CartographieStockee> {
  return avecOrganisation(pool, org, async (client) => {
    const r = await client.query<{ contenu: Contenu; version: number; modifie_par_nom: string; modifie_le: Date | null }>(
      "SELECT contenu, version, modifie_par_nom, modifie_le FROM cartographie WHERE id = 1",
    );
    const l = r.rows[0];
    if (!l) throw new Error("Cartographie absente : la migration 0002_documents n'a pas été appliquée à cette organisation.");
    return { contenu: l.contenu, version: l.version, modifieParNom: l.modifie_par_nom, modifieLe: l.modifie_le };
  });
}

export async function enregistrerCartographie(pool: Pool, org: OrganisationCible, e: Enregistrement, acteur: Acteur): Promise<EtatVersion> {
  if (!Number.isSafeInteger(e.version) || e.version < 0) throw new ErreurMetier("erreur.saisie_invalide");
  const { json } = preparerContenuCartographie(e.contenu);
  const nom = nomActeur(acteur);
  return enTransaction(pool, async (client) => {
    const r = await dansOrganisation(client, org, async () => {
      const lu = await client.query<{ version: number; modifie_par_nom: string; modifie_le: Date | null }>(
        "SELECT version, modifie_par_nom, modifie_le FROM cartographie WHERE id = 1 FOR UPDATE",
      );
      const avant = lu.rows[0];
      if (!avant) throw new Error("Cartographie absente : la migration 0002_documents n'a pas été appliquée à cette organisation.");
      const ecrase = avant.version !== e.version;
      if (ecrase && !e.forcer) throw new ConflitVersion({ version: avant.version, modifieParNom: avant.modifie_par_nom, modifieLe: avant.modifie_le });
      const maj = await client.query<{ version: number; modifie_le: Date }>(
        `UPDATE cartographie
            SET contenu = $1::jsonb, version = version + 1, modifie_par = $2, modifie_par_nom = $3, modifie_le = now()
          WHERE id = 1
          RETURNING version, modifie_le`,
        [json, acteur.id, nom],
      );
      const apres = maj.rows[0]!;
      let entree: EntreeJournal | null = null;
      if (ecrase || !(await dejaTrace(client, "CARTOGRAPHIE_MODIFIEE", acteur.id, null))) {
        entree = {
          action: "CARTOGRAPHIE_MODIFIEE", ...traceActeur(acteur), cibleType: "cartographie", cibleId: null,
          details: ecrase ? { versionRemplacee: avant.version, auteurRemplace: avant.modifie_par_nom } : {},
        };
        await journaliserOrganisation(client, entree);
      }
      return { etat: { version: apres.version, modifieParNom: nom, modifieLe: apres.modifie_le }, entree, ecrase };
    });
    if (r.entree) await journaliserPlateforme(client, versPlateforme(org, r.entree, r.ecrase ? { remplacement: true } : {}));
    return r.etat;
  });
}
