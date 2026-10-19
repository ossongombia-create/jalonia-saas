"use server";
// QSE (audit Q1) : plan d'actions, objectifs et mesures des indicateurs, dans l'organisation OUVERTE.
// L'identifiant d'organisation envoyé par le formulaire doit être celui de l'organisation actuellement ouverte, et la
// personne doit y avoir le droit demandé ; le superadmin n'a aucun droit implicite ici.
import { redirect } from "next/navigation";
import { jourLocal } from "@/lib/dates";
import { aLeDroit, type Droit } from "@/lib/rbac";
import { identifiant } from "@/lib/validation";
import type { EtatAction } from "@/lib/etat-action";
import { poolApplication } from "@/server/db/pools";
import { creerAction, modifierAction } from "@/server/qse/actions";
import { definirObjectif, enregistrerMesure, supprimerMesure } from "@/server/qse/indicateurs";
import type { OrganisationCible } from "@/server/membres/service";
import { ErreurMetier } from "@/server/erreurs";
import { exigerContexte, type Contexte } from "@/server/web/contexte";
import { champ, executer, valider } from "@/server/web/actions";

function autoriser(ctx: Contexte, formulaire: FormData, droit: Droit): OrganisationCible {
  const organisationId = valider(identifiant, champ(formulaire, "organisationId"));
  const ouverte = ctx.organisation;
  if (!ouverte || ouverte.id !== organisationId || !aLeDroit(ouverte.roles, droit)) throw new ErreurMetier("erreur.interdit");
  return { id: ouverte.id, schemaName: ouverte.schemaName, roleName: ouverte.roleName };
}

/** Champ facultatif : chaîne vide → null. */
const facultatif = (v: string): string | null => (v.trim() === "" ? null : v.trim());

function saisieAction(f: FormData) {
  return {
    titre: champ(f, "titre"),
    description: champ(f, "description"),
    origine: champ(f, "origine"),
    responsableId: facultatif(champ(f, "responsableId")),
    echeance: facultatif(champ(f, "echeance")),
  };
}

/** Crée une action, puis ouvre sa page. */
export async function actionCreerAction(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    const org = autoriser(ctx, formulaire, "actions.gerer");
    const cree = await creerAction(poolApplication(), org, {
      ...saisieAction(formulaire),
      documentId: facultatif(champ(formulaire, "documentId")),
      elementId: facultatif(champ(formulaire, "elementId")),
    }, ctx.acteur);
    redirect(`/app/actions/${cree.id}?cree=${cree.numero}`);
  });
}

/**
 * Faire avancer une action (décision n° 5 du 19/10/2026) : le droit actions.gerer, OU être le responsable de
 * l'action (vérifié par le service, qui lit l'action) ; le responsable ne la clôt ni ne l'abandonne jamais.
 */
export async function actionModifierAction(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    const org = autoriser(ctx, formulaire, "documents.lire");
    const id = valider(identifiant, champ(formulaire, "actionId"));
    const version = champ(formulaire, "version");
    if (!/^\d{1,9}$/.test(version)) throw new ErreurMetier("erreur.saisie_invalide");
    const efficace = champ(formulaire, "efficace");
    // Formulaire réduit du responsable (« avancement ») : intitulé, description, origine, responsable et échéance ne
    // sont pas envoyés et restent inchangés. Sinon, tous sont lus (un champ vide efface l'échéance ou le responsable).
    const avancementSeul = champ(formulaire, "avancement") === "1";
    await modifierAction(poolApplication(), org, id, {
      ...(avancementSeul ? {} : saisieAction(formulaire)),
      version: Number(version),
      statut: champ(formulaire, "statut"),
      resultat: champ(formulaire, "resultat"),
      efficace: efficace === "oui" ? true : efficace === "non" ? false : null,
    }, ctx.acteur, ctx.organisation?.roles ?? []);
    return { cle: "actions.enregistree" };
  });
}

function indicateurVise(formulaire: FormData): { documentId: string; elementId: string } {
  const documentId = valider(identifiant, champ(formulaire, "documentId"));
  const elementId = champ(formulaire, "elementId");
  if (elementId.length < 1 || elementId.length > 100) throw new ErreurMetier("indicateurs.introuvable");
  return { documentId, elementId };
}

export async function actionDefinirObjectif(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    const org = autoriser(ctx, formulaire, "indicateurs.objectifs");
    const { documentId, elementId } = indicateurVise(formulaire);
    await definirObjectif(poolApplication(), org, documentId, elementId, { sens: champ(formulaire, "sens"), seuil: champ(formulaire, "seuil"), unite: champ(formulaire, "unite") }, ctx.acteur);
    return { cle: "indicateurs.objectif_fait" };
  });
}

export async function actionRetirerObjectif(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    const org = autoriser(ctx, formulaire, "indicateurs.objectifs");
    const { documentId, elementId } = indicateurVise(formulaire);
    await definirObjectif(poolApplication(), org, documentId, elementId, null, ctx.acteur);
    return { cle: "indicateurs.objectif_retire" };
  });
}

export async function actionEnregistrerMesure(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    const org = autoriser(ctx, formulaire, "indicateurs.mesurer");
    const { documentId, elementId } = indicateurVise(formulaire);
    const r = await enregistrerMesure(poolApplication(), org, documentId, elementId, {
      date: champ(formulaire, "date"), valeur: champ(formulaire, "valeur"), commentaire: champ(formulaire, "commentaire"),
    }, jourLocal(new Date(), ctx.fuseau), ctx.acteur);
    return { cle: r.corrigee ? "indicateurs.mesure_corrigee" : "indicateurs.mesure_faite" };
  });
}

export async function actionSupprimerMesure(_etat: EtatAction, formulaire: FormData): Promise<EtatAction> {
  const ctx = await exigerContexte();
  return executer(ctx.langue, async () => {
    const org = autoriser(ctx, formulaire, "indicateurs.mesurer");
    await supprimerMesure(poolApplication(), org, champ(formulaire, "mesureId"), ctx.acteur);
    return { cle: "indicateurs.mesure_supprimee" };
  });
}
