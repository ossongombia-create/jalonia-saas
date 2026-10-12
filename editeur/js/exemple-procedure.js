// exemple-procedure.js — L'EXEMPLE de procédure montré à l'utilisateur (menu Fichier › Exemple) : « Cuisiner et servir un repas »
// (PR-REA-01) d'une organisation FICTIVE (« Entreprise Exemple », V0). Processus inspiré d'un exemple générique de management des
// processus (restaurant) ; redessiné avec nos propres formes et nos propres mots, sans reproduire aucune figure ni aucun texte d'une
// source tierce. Rien n'y est propre à une entreprise réelle : l'application sert à toute organisation, cet exemple ne sert qu'à essayer.
// v0.28 : cet exemple illustre l'appréciation des risques (règle Impact = 4 → critique) ET des opportunités (intérêt × faisabilité).
// Les 11 sections suivent le modèle standard ; les sections 5, 6 et 9 sont recalculées (bloc « genere ») à partir des rôles, des
// instructions, des risques et des opportunités. Le texte est resserré pour tenir en 5 pages.

import { nouvelleProcedure, nouvelleEtape, nouveauRisque, nouvelleOpportunite, nouvelleAlternative, nouvelleRevision } from "./model.js";

export function exempleProcedure() {
  const p = nouvelleProcedure();
  const accueil = { id: "r-acc", nom: "Accueil", type: "individuel", service: "Salle", responsabilite: "Accueille le client, tient les réservations et la liste d'attente, le place à une table disponible." };
  const maitre = { id: "r-mh", nom: "Maître d'hôtel", type: "individuel", service: "Salle", responsabilite: "Prend la commande, recueille les allergies, encaisse, traite les réclamations sur place." };
  const salle = { id: "r-sds", nom: "Service de salle", type: "unite", service: "Salle", responsabilite: "Sert les plats, nettoie, dresse les tables et les remet en place." };
  const cuisine = { id: "r-cui", nom: "Cuisine", type: "unite", service: "Cuisine", responsabilite: "Prépare les plats dans le respect de la sécurité sanitaire, des temps et de l'ordonnancement des envois." };
  p.roles = [accueil, maitre, salle, cuisine];
  p.meta = {
    ...p.meta,
    organisation: "Entreprise Exemple",
    direction: "Restauration",
    processus: "REA Réaliser le produit ou le service",
    pilote: "Directeur du restaurant",
    typeDocument: "procedure",
    titre: "Cuisiner et servir un repas", reference: "PR-REA-01", version: "V0", niveau: 2,
    domaine: "realisation", dateApplication: "2026-10-01",
    signataires: {
      redige: { nom: "", fonction: "Maître d'hôtel", date: "2026-10-01" },
      verifie: { nom: "", fonction: "Chef de cuisine", date: "" },
      approuve: { nom: "", fonction: "Directeur du restaurant", date: "" },
    },
    revisions: [nouvelleRevision({ id: "v1", version: "V0", date: "2026-10-01", nature: "Création initiale du document", auteur: "Directeur du restaurant" })],
    declencheur: "Demande de repas du client (sur place ou sur réservation)",
    fin: "Table remise en place, prête pour de nouveaux clients",
    // Interface aval : le processus « Accueillir de nouveaux clients » prend le relais après la remise en place (remplace le symbole Fin dans le dessin).
    aval: { texte: "Accueillir de nouveaux clients", role: "Accueil", information: "Table remise en place" },
  };
  const e = (champs) => nouvelleEtape(champs);
  const r = (champs) => nouveauRisque(champs);
  const o = (champs) => nouvelleOpportunite(champs);
  p.etapes = [
    e({ roleId: accueil.id, libelle: "Accueillir le client", entree: "Demande de repas", entreeDe: "client", sortie: "Client pris en charge, à placer",
      outils: [{ id: "o1", type: "document", nom: "Outil de réservation" }],
      risques: [r({ id: "k1", risque: "Attente sans prise en charge, surréservation ou réservation perdue", causes: "Outils multiples, pic d'affluence", gravite: "3", probabilite: "3", mesure: "Outil de réservation unique ; prise en charge en moins de 2 minutes ; liste d'attente" })],
      opportunites: [o({ id: "p1", opportunite: "Réservation en ligne et plan de salle numérique", benefice: "Moins de réservations perdues, meilleure rotation", interet: "3", faisabilite: "2" })] }),
    e({ roleId: maitre.id, libelle: "Placer le client", entree: "Client à placer", entreeDe: "Accueil", sortie: "Client installé à sa table" }),
    e({ roleId: maitre.id, libelle: "Prendre la commande", entree: "Client installé", sortie: "Commande à préparer", versQui: "Cuisine",
      outils: [{ id: "o2", type: "document", nom: "Bon de commande" }, { id: "o3", type: "document", nom: "Carte des allergènes" }],
      risques: [
        r({ id: "k3", risque: "Allergie non recueillie ou non transmise à la cuisine", causes: "Allergie non demandée, bon incomplet", gravite: "4", probabilite: "2", mesure: "Question systématique sur les allergies ; mention obligatoire sur le bon ; carte des allergènes disponible" }),
        r({ id: "k4", risque: "Bon illisible, erroné ou perdu", causes: "Saisie manuscrite, perte du bon", gravite: "3", probabilite: "3", mesure: "Relecture de la commande au client ; bon normalisé (table, place, cuisson) ; saisie numérique" }),
      ],
      opportunites: [o({ id: "p2", opportunite: "Prise de commande sur tablette reliée à un écran en cuisine", benefice: "Supprime la ressaisie ; champ allergènes obligatoire", interet: "3", faisabilite: "2" })] }),
    e({ roleId: cuisine.id, libelle: "Cuisiner les plats", entree: "Commande à préparer ; aliments approvisionnés (processus « Approvisionner le restaurant »)", entreeDe: "Maître d'hôtel", sortie: "Plats cuisinés", versQui: "Service de salle",
      risques: [
        r({ id: "k5", risque: "Rupture de la chaîne du froid ou du chaud, cuisson insuffisante, contamination croisée", causes: "Équipement, organisation, non-respect de la marche en avant", gravite: "4", probabilite: "2", mesure: "Plan HACCP et programmes prérequis ; relevés de température ; marche en avant" }),
        r({ id: "k6", risque: "Temps de préparation excessif, plats d'une même table désynchronisés", causes: "Charge, absence d'ordonnancement", gravite: "3", probabilite: "3", mesure: "Temps standards par plat ; ordonnancement des envois par le chef ; limitation des couverts par service" }),
        r({ id: "k7", risque: "Brûlures, coupures, chutes sur sols glissants", causes: "Pics d'activité, sols humides", gravite: "4", probabilite: "2", mesure: "Évaluation des risques professionnels ; chaussures antidérapantes et EPI ; formation aux gestes" }),
      ] }),
    e({ roleId: salle.id, libelle: "Servir les plats", entree: "Plats cuisinés", sortie: "Repas servi au client", versQui: "Maître d'hôtel" }),
    e({ roleId: maitre.id, libelle: "Encaisser le repas", entree: "Fin du repas", sortie: "Addition réglée, facture remise", versQui: "Service de salle",
      outils: [{ id: "o4", type: "document", nom: "Caisse reliée aux commandes" }],
      risques: [
        r({ id: "k10", risque: "Réclamation non traitée, avis négatif en ligne", causes: "Réclamation non remontée sur place", gravite: "3", probabilite: "3", mesure: "Maître d'hôtel habilité à traiter la réclamation (geste commercial) ; registre ; veille des avis" }),
      ],
      opportunites: [o({ id: "p3", opportunite: "Paiement à table par terminal mobile", benefice: "Addition plus rapide, table libérée plus tôt", interet: "2", faisabilite: "3" })] }),
    e({ roleId: salle.id, libelle: "Nettoyer la table", entree: "Table à débarrasser", sortie: "Table débarrassée et nettoyée",
      outils: [{ id: "o5", type: "document", nom: "Plan de nettoyage" }] }),
    e({ roleId: salle.id, libelle: "Dresser la table", entree: "Table nettoyée", sortie: "Table remise en place", versQui: "Accueil",
      outils: [{ id: "o6", type: "document", nom: "Fiche de dressage" }] }),
  ];
  // Un contrôle (triangle Q) au service, avec retour en cuisine si le plat n'est pas conforme au passe.
  const servir = p.etapes[4];
  const cuisiner = p.etapes[3];
  servir.controle = { actif: true, nature: "Q", critere: "Plat conforme au passe : température, dressage, cuisson demandée", enregistrement: "Visa du chef au passe" };
  servir.condition = "Conforme";
  servir.alternatives = [nouvelleAlternative({ id: "a1", condition: "Non conforme", info: "Plat renvoyé", versQui: "Cuisine", vers: cuisiner.id })];
  p.corps = {
    objet: [
      {"id":"b1","type":"p","texte":"Définir comment le restaurant accueille le client, prend sa commande, cuisine, sert, encaisse et remet la table en place : un repas servi dans le délai attendu, conforme à la commande, à la sécurité sanitaire des aliments et à la sécurité au travail."},
    ],
    domaine: [
      {"id":"b2","type":"p","texte":"Tous les services du restaurant, en salle et en cuisine, pour les clients sur place. Interfaces : en amont « Approvisionner le restaurant » (aliments) ; en aval « Accueillir de nouveaux clients » (table remise en place). Exclusion : banquets et vente à emporter."},
    ],
    references: [
      {"id":"b4","type":"tableau","colonnes":["Type","Référence","Intitulé"],"lignes":[["Norme","ISO 9001, § 8.5","Production et prestation de service"],["Norme","HACCP","Sécurité sanitaire : marche en avant, relevés de température"],["Norme","SST","Évaluation des risques professionnels, EPI"],["Document interne","IT-REA-01","Prendre une commande"]]},
    ],
    definitions: [
      {"id":"b6","type":"tableau","colonnes":["Terme / Sigle","Définition"],"lignes":[["Passe","Point de remise des plats entre la cuisine et la salle."],["Bon","Commande transmise à la cuisine (table, place, cuisson, allergies)."],["Allergène","Substance à risque ; recueillie à la commande et portée sur le bon."],["HACCP","Méthode de maîtrise de la sécurité sanitaire des aliments."],["FP / PR / IT","Fiche processus / Procédure (qui fait quoi) / Instruction (comment faire)."]]},
    ],
    responsabilites: [
      {"id":"b7","type":"p","texte":"Les rôles ci-dessous correspondent aux couloirs du logigramme (section 7)."},
      {"id":"b8","type":"genere"},
      {"id":"b9","type":"p","texte":"Le Directeur du restaurant pilote la procédure : il suit les indicateurs, anime la revue de processus et engage les actions de maîtrise des risques critiques."},
    ],
    description: [
      {"id":"b11","type":"genere"},
      {"id":"b12","type":"p","texte":"6.1 Sécurité sanitaire et allergènes"},
      {"id":"b13","type":"p","texte":"La cuisine applique un plan HACCP : relevés de température, marche en avant, nettoyage planifié. Les allergies sont demandées à la commande, portées sur le bon et transmises à la cuisine ; la carte des allergènes est disponible."},
      {"id":"b16","type":"p","texte":"6.2 Service, délais et réclamations"},
      {"id":"b17","type":"p","texte":"Le chef ordonnance les envois et contrôle chaque plat au passe ; un plat non conforme repart en cuisine (contrôle de l'étape 5). Le Maître d'hôtel traite les réclamations sur place (geste commercial) et les consigne au registre."},
    ],
    logigramme: [
      {"id":"b24","type":"p","texte":"Déroulement d'un repas, de la demande du client à la remise en place de la table (niveau 2). La légende des symboles figure dans le guide de rédaction de l'organisation."},
    ],
    indicateurs: [
      {"id":"b27","type":"tableau","colonnes":["Indicateur","Mode de calcul","Cible","Fréquence"],"lignes":[["Satisfaction client","Clients satisfaits ou très satisfaits / répondants","≥ 90 %","Mensuelle"],["Délai de service du plat principal","Minutes entre la commande et le service (moyenne)","≤ 20 min","Par service"],["Conformité des relevés de température","Relevés conformes / relevés réalisés","100 %","Quotidienne"]]},
      {"id":"b27g","type":"genere"},
    ],
    risques: [
      {"id":"b28","type":"p","texte":"Criticité = Impact × Vraisemblance (1 à 4). Critique si la criticité atteint 9, ou dès que l'Impact vaut 4 (personnes, sanitaire). Opportunités : intérêt × faisabilité, plan d'amélioration dès un score ≥ 6."},
      {"id":"b28g","type":"genere"},
    ],
    enregistrements: [
      {"id":"b30","type":"tableau","colonnes":["Nom du document","Support","Conservation","Lieu"],"lignes":[["Relevés de température","Papier ou numérique","1 an","Cuisine"],["Bons de commande","Numérique (caisse)","1 an","Serveur de caisse"],["Registre des réclamations","Numérique","3 ans","Direction"]]},
    ],
    diffusion: [
      {"id":"b31","type":"p","texte":"Pour action : Accueil, Maître d'hôtel, Service de salle, Cuisine. Pour information : ensemble du personnel du restaurant. Diffusion en salle et en cuisine, avec sensibilisation aux allergènes, à l'hygiène et à la sécurité au travail."},
    ],
  };
  return p;
}
