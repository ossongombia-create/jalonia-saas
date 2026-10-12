// exemple-it.js — L'EXEMPLE d'instruction de travail montré à l'utilisateur : « Enregistrer une commande » (IT-VEN-01), dans une
// organisation FICTIVE (« Entreprise Exemple »). Un rôle (Chargé de clientèle), 7 opérations, des contrôles Oui/Non et des actions
// correctives (fig. 7.7 du livre : une même corrective peut répondre à plusieurs contrôles de la même opération). Les libellés
// respectent les règles du chapitre 7 : opération de 5 mots au plus, à l'infinitif, sans « et » ; contrôle sous forme de question ;
// corrective à l'infinitif. Rien n'y est propre à une entreprise réelle : l'exemple ne sert qu'à essayer (v0.26 : sujet neutre).

import { nouvelleProcedure, nouvelleOperation, nouveauControle, nouvelleCorrective } from "./model.js";

export function exempleInstruction() {
  const p = nouvelleProcedure();
  p.meta = {
    ...p.meta,
    organisation: "Entreprise Exemple",
    direction: "Ventes et logistique",
    processus: "VEN Vendre et contractualiser",
    pilote: "Responsable commercial",
    typeDocument: "instruction",
    titre: "Enregistrer une commande", reference: "IT-VEN-01", version: "V0", niveau: 3,
    domaine: "realisation", dateApplication: "2026-10-01",
    declencheur: "À chaque commande validée par la Direction",
    fin: "Commande enregistrée et transmise à la logistique, accusé de réception envoyé",
    amont: { texte: "Valider la commande", role: "Direction", information: "Commande validée" },
    aval: { texte: "Expédier la commande", role: "Responsable logistique", information: "Commande enregistrée" },
  };
  p.meta.signataires.redige.nom = "Responsable commercial";
  p.it.role = { nom: "Chargé de clientèle" };
  const doc = (id, nom) => ({ id, type: "document", nom });
  const mat = (id, nom) => ({ id, type: "materiel", nom });
  const o = (champs) => nouvelleOperation(champs);
  const c = (champs) => nouveauControle(champs);
  const m = (champs) => nouvelleCorrective(champs);
  p.it.operations = [
    o({
      id: "p1", libelle: "Vérifier la commande reçue", entree: "Commande validée", sortie: "Commande complète",
      outils: [doc("o1", "Bon de commande")],
      correctives: [m({ id: "m1", libelle: "Contacter le client" })],
      controles: [c({ id: "c1", question: "Références et quantités complètes ?", nature: "Q", correctives: ["m1"] })],
    }),
    o({
      id: "p2", libelle: "Identifier le client", sortie: "Client identifié", vigilance: true, outils: [mat("o2", "Logiciel de gestion")],
      correctives: [m({ id: "m2", libelle: "Créer la fiche client" })],
      controles: [c({ id: "c2", question: "Client déjà enregistré ?", nature: "Q", correctives: ["m2"] })],
    }),
    o({
      id: "p3", libelle: "Saisir les lignes de commande", sortie: "Commande saisie", outils: [mat("o5", "Logiciel de gestion")],
      correctives: [m({ id: "m3", libelle: "Corriger la saisie" })],
      controles: [c({ id: "c3", question: "Prix conformes à l'offre validée ?", nature: "Q", correctives: ["m3"] })],
    }),
    o({
      id: "p4", libelle: "Contrôler les conditions de paiement", sortie: "Conditions confirmées", vigilance: true, outils: [doc("o6", "Offre validée")],
      correctives: [m({ id: "m4", libelle: "Alerter la Direction" })],
      controles: [c({ id: "c4", question: "Conditions de paiement conformes à l'offre ?", nature: "Q", correctives: ["m4"] })],
    }),
    o({
      id: "p5", libelle: "Vérifier les données réglementaires", sortie: "Données du client conformes", vigilance: true,
      outils: [doc("o3", "Conditions générales de vente")],
      correctives: [m({ id: "m5", libelle: "Demander le justificatif au client" })],
      controles: [
        c({ id: "c5", question: "Identité du client confirmée ?", nature: "R", correctives: ["m5"] }),
        c({ id: "c6", question: "Conditions générales de vente acceptées ?", nature: "R", correctives: ["m5"] }),
      ],
    }),
    o({
      id: "p6", libelle: "Confirmer la commande au client", sortie: "Accusé de réception envoyé", enregistrement: true,
      contrainte: { actif: true, nature: "delai", texte: "24 h au plus" }, outils: [doc("o4", "Modèle d'accusé FO-VEN-02")],
    }),
    o({ id: "p7", libelle: "Transmettre la commande", sortie: "Commande transmise à la logistique", outils: [mat("o7", "Messagerie")], contrainte: { actif: true, nature: "delai", texte: "Le jour même" } }),
  ];
  return p;
}
