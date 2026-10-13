// Historique des versions et corbeille des documents (audit S5, D1 ; migration organisation 0004).
//
// La table versions_document est en AJOUT SEUL pour le rôle de l'organisation. Une copie du document est prise :
//   - à sa création ;
//   - quand une AUTRE personne enregistre : l'état laissé par la précédente est d'abord copié (rien de ce qu'elle a fait
//     ne disparaît sous le travail d'un collègue) ;
//   - avant et après un remplacement explicite (conflit tranché par « garder ma version », restauration) ;
//   - à la validation de la synthèse (version « validée ») ;
//   - à la mise en corbeille ;
//   - et, pendant l'enregistrement automatique (toutes les 1,5 s), au plus une fois par période (PERIODE_COPIES_MINUTES).
// LIMITE (assumée) : entre deux copies d'une même personne, les états intermédiaires ne sont pas gardés.
import type { Pool } from "pg";
import { avecOrganisation, dansOrganisation, enTransaction } from "../db/transactions";
import type { OrganisationCible } from "../membres/service";
import { journaliserOrganisation, journaliserPlateforme, type EntreeJournal } from "../audit/journal";
import { ErreurMetier } from "../erreurs";
import { nomActeur, traceActeur, type Acteur } from "../acteur";
import { estIdentifiant, metaDepuisContenu, type Contenu, type TypeDocument } from "./service";
import { copier, type MotifCopie } from "./copies";

// ---------------------------------------------------------------------------------------------------
// Consultation
// ---------------------------------------------------------------------------------------------------

export interface LigneVersion {
  version: number;
  titre: string;
  reference: string;
  auteurNom: string;
  enregistreLe: Date;
  motif: MotifCopie;
}

export interface Historique {
  document: { id: string; type: TypeDocument; titre: string; reference: string; version: number; supprimeLe: Date | null };
  versions: LigneVersion[];
}

export async function listerVersions(pool: Pool, org: OrganisationCible, id: string): Promise<Historique | null> {
  if (!estIdentifiant(id)) return null;
  return avecOrganisation(pool, org, async (client) => {
    const d = await client.query<{ id: string; type: TypeDocument; titre: string; reference: string; version: number; supprime_le: Date | null }>(
      "SELECT id, type, titre, reference, version, supprime_le FROM documents WHERE id = $1",
      [id],
    );
    const doc = d.rows[0];
    if (!doc) return null;
    const v = await client.query<{ version: number; titre: string; reference: string; auteur_nom: string; enregistre_le: Date; motif: MotifCopie }>(
      "SELECT version, titre, reference, auteur_nom, enregistre_le, motif FROM versions_document WHERE document_id = $1 ORDER BY version DESC",
      [id],
    );
    return {
      document: { id: doc.id, type: doc.type, titre: doc.titre, reference: doc.reference, version: doc.version, supprimeLe: doc.supprime_le },
      versions: v.rows.map((l) => ({ version: l.version, titre: l.titre, reference: l.reference, auteurNom: l.auteur_nom, enregistreLe: l.enregistre_le, motif: l.motif })),
    };
  });
}

export async function lireVersion(pool: Pool, org: OrganisationCible, id: string, version: number): Promise<{ contenu: Contenu; auteurNom: string; enregistreLe: Date } | null> {
  if (!estIdentifiant(id) || !Number.isSafeInteger(version) || version < 1) return null;
  return avecOrganisation(pool, org, async (client) => {
    const r = await client.query<{ contenu: Contenu; auteur_nom: string; enregistre_le: Date }>(
      "SELECT contenu, auteur_nom, enregistre_le FROM versions_document WHERE document_id = $1 AND version = $2",
      [id, version],
    );
    const l = r.rows[0];
    return l ? { contenu: l.contenu, auteurNom: l.auteur_nom, enregistreLe: l.enregistre_le } : null;
  });
}

// ---------------------------------------------------------------------------------------------------
// Restauration d'une version, corbeille
// ---------------------------------------------------------------------------------------------------

function versPlateforme(org: OrganisationCible, e: EntreeJournal, details: Record<string, unknown>) {
  return { ...e, details, organisationId: org.id };
}

/**
 * Remet le contenu d'une version ancienne dans le document : c'est une NOUVELLE version (rien n'est effacé, l'état
 * remplacé est copié avant). `versionActuelle` : la version que la personne avait sous les yeux ; si le document a été
 * enregistré depuis, refus plutôt que d'écraser ce travail sans le savoir.
 */
export async function restaurerVersion(pool: Pool, org: OrganisationCible, id: string, version: number, versionActuelle: number, acteur: Acteur): Promise<{ version: number }> {
  if (!estIdentifiant(id) || !Number.isSafeInteger(version) || version < 1) throw new ErreurMetier("erreur.introuvable");
  const nom = nomActeur(acteur);
  return enTransaction(pool, async (client) => {
    const r = await dansOrganisation(client, org, async () => {
      const lu = await client.query<{ version: number }>(
        "SELECT version FROM documents WHERE id = $1 AND supprime_le IS NULL FOR UPDATE",
        [id],
      );
      const doc = lu.rows[0];
      if (!doc) throw new ErreurMetier("erreur.introuvable");
      if (doc.version !== versionActuelle) throw new ErreurMetier("versions.document_modifie");
      if (version >= doc.version) throw new ErreurMetier("versions.deja_actuelle");
      const v = await client.query<{ contenu: Contenu }>("SELECT contenu FROM versions_document WHERE document_id = $1 AND version = $2", [id, version]);
      const copie = v.rows[0];
      if (!copie) throw new ErreurMetier("erreur.introuvable");
      const meta = metaDepuisContenu(copie.contenu);
      await copier(client, id, "avant_remplacement");
      const maj = await client.query<{ version: number }>(
        `UPDATE documents SET contenu = v.contenu, type = $3, titre = $4, reference = $5, version = documents.version + 1,
                modifie_par = $6, modifie_par_nom = $7, modifie_le = now()
           FROM versions_document v
          WHERE documents.id = $1 AND v.document_id = $1 AND v.version = $2
          RETURNING documents.version`,
        [id, version, meta.type, meta.titre, meta.reference, acteur.id, nom],
      );
      await copier(client, id, "restauration");
      const nouvelle = maj.rows[0]!.version;
      const entree: EntreeJournal = {
        action: "DOCUMENT_RESTAURE", ...traceActeur(acteur), cibleType: "document", cibleId: id,
        details: { ...meta, versionRestauree: version, versionRemplacee: doc.version, nouvelleVersion: nouvelle },
      };
      await journaliserOrganisation(client, entree);
      return { entree, type: meta.type, nouvelle };
    });
    await journaliserPlateforme(client, versPlateforme(org, r.entree, { type: r.type }));
    return { version: r.nouvelle };
  });
}

export interface DocumentCorbeille {
  id: string;
  type: TypeDocument;
  titre: string;
  reference: string;
  version: number;
  supprimeLe: Date;
  supprimeParNom: string;
}

export async function listerCorbeille(pool: Pool, org: OrganisationCible): Promise<DocumentCorbeille[]> {
  return avecOrganisation(pool, org, async (client) => {
    const r = await client.query<{ id: string; type: TypeDocument; titre: string; reference: string; version: number; supprime_le: Date; supprime_par_nom: string }>(
      "SELECT id, type, titre, reference, version, supprime_le, supprime_par_nom FROM documents WHERE supprime_le IS NOT NULL ORDER BY supprime_le DESC, id",
    );
    return r.rows.map((l) => ({ id: l.id, type: l.type, titre: l.titre, reference: l.reference, version: l.version, supprimeLe: l.supprime_le, supprimeParNom: l.supprime_par_nom }));
  });
}

/** Sort un document de la corbeille : il retrouve sa place, avec toutes ses versions. */
export async function retablirDocument(pool: Pool, org: OrganisationCible, id: string, acteur: Acteur): Promise<void> {
  if (!estIdentifiant(id)) throw new ErreurMetier("erreur.introuvable");
  await enTransaction(pool, async (client) => {
    const r = await dansOrganisation(client, org, async () => {
      const maj = await client.query<{ type: TypeDocument; titre: string; reference: string; version: number }>(
        `UPDATE documents SET supprime_le = NULL, supprime_par = NULL, supprime_par_nom = ''
          WHERE id = $1 AND supprime_le IS NOT NULL RETURNING type, titre, reference, version`,
        [id],
      );
      const d = maj.rows[0];
      if (!d) throw new ErreurMetier("erreur.introuvable");
      const entree: EntreeJournal = { action: "DOCUMENT_RETABLI", ...traceActeur(acteur), cibleType: "document", cibleId: id, details: d };
      await journaliserOrganisation(client, entree);
      return { entree, type: d.type };
    });
    await journaliserPlateforme(client, versPlateforme(org, r.entree, { type: r.type }));
  });
}
