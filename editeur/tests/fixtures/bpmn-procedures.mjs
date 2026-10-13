// Procédure fictive qui utilise toutes les formes que l'échange BPMN doit traverser : décision (OU) avec retour en arrière et
// sortie vers la fin, tâches simultanées (ET), jonction ET, opérateur d'entrée qu'une seule flèche ne peut pas porter,
// alternative « à choisir » (sans destination), sous-procédure, niveau 3, contrôle, contrainte, indicateur, contrat,
// R.A.C.I., outils, risques et opportunités, instruction sans rôle, rôle sans instruction, corps du document.
import { nouvelleProcedure, nouvelleEtape, nouvelleAlternative, nouveauRisque, nouvelleOpportunite } from "../../js/model.js";

export function procedureComplete() {
  const p = nouvelleProcedure();
  p.roles = [
    { id: "r1", nom: "Acheteur", type: "individuel", service: "Achats", responsabilite: "Passe les commandes." },
    { id: "r2", nom: "Magasin", type: "unite", service: "Logistique", responsabilite: "Reçoit et range." },
    { id: "r3", nom: "Comptabilité", type: "unite", service: "Finance", responsabilite: "Paie les factures." },
  ];
  p.meta = {
    ...p.meta,
    organisation: "Organisation fictive", direction: "Achats", processus: "ACH Acheter", pilote: "Responsable achats",
    typeDocument: "procedure", titre: "Acheter et recevoir", reference: "PR-ACH-01", version: "V2", domaine: "support",
    dateApplication: "2026-10-01", declencheur: "Besoin d'un article", fin: "Article en stock et facture payée",
    amont: { texte: "Planifier les besoins", role: "Production", information: "Besoin" },
    aval: { texte: "Servir les ateliers", role: "Production", information: "Article disponible" },
  };
  p.etapes = [
    nouvelleEtape({
      id: "e1", roleId: "r1", libelle: "Exprimer le besoin", entree: "Besoin", entreeDe: "Production", sortie: "Demande d'achat", versQui: "Acheteur",
      raci: { r2: "I", r3: "C" }, informes: ["Direction"], outils: [{ id: "o1", type: "document", nom: "Formulaire DA" }],
      controle: { actif: true, nature: "Q", critere: "Demande complète", enregistrement: "DA signée" },
      risques: [nouveauRisque({ id: "k1", risque: "Besoin mal exprimé", causes: "Formulaire incomplet", gravite: "3", probabilite: "2", mesure: "Contrôle de complétude" })],
      opportunites: [nouvelleOpportunite({ id: "p1", opportunite: "Dématérialiser la DA", benefice: "Délai", interet: "3", faisabilite: "2" })],
      contrainte: { actif: true, nature: "delai", texte: "24 h" },
    }),
    nouvelleEtape({
      id: "e2", roleId: "r1", libelle: "Valider la demande", sortie: "Demande validée", condition: "Validée",
      alternatives: [
        nouvelleAlternative({ id: "a1", condition: "Refusée", info: "Motif du refus", versQui: "Demandeur", vers: "fin" }),
        nouvelleAlternative({ id: "a2", condition: "À compléter", info: "Questions", versQui: "Demandeur", vers: "e1" }),
      ],
      indicateur: { actif: true, nom: "Délai de validation", formule: "Date validation - date DA", cible: "< 2 j", frequence: "Mensuelle" },
    }),
    nouvelleEtape({ id: "e3", roleId: "r1", libelle: "Commander", sortie: "Bon de commande", sousProcedure: { actif: true, code: "PR-ACH-02" }, contrat: { actif: true, reference: "Contrat cadre fournisseur" } }),
    nouvelleEtape({
      id: "e4", roleId: "r2", libelle: "Contrôler la livraison", sortie: "Bon de réception", condition: "Stock", operateurSortie: "et",
      alternatives: [nouvelleAlternative({ id: "a3", condition: "Facture", info: "Bon de réception", versQui: "Comptabilité", vers: "e6" })],
    }),
    nouvelleEtape({ id: "e5", roleId: "r2", libelle: "Ranger en stock", sortie: "Article rangé", niveau3: { actif: true, code: "IT-ACH-01", intitule: "Ranger un article" } }),
    nouvelleEtape({ id: "e6", roleId: "", libelle: "Payer la facture", sortie: "Facture payée", operateurEntree: "et", correctrice: true }),
    nouvelleEtape({
      id: "e7", roleId: "r1", libelle: "Clore le dossier", operateurEntree: "ou", condition: "Normal",
      alternatives: [nouvelleAlternative({ id: "a4", condition: "Cas à préciser", vers: "" })],
      sansObjet: { comment: true, avec: false, contraintes: true },
    }),
  ];
  p.corps.objet = [{ id: "b1", type: "p", texte: "Décrire l'achat et la réception des articles." }];
  return p;
}
