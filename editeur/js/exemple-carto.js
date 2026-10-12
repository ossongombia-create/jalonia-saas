// exemple-carto.js — UN EXEMPLE de cartographie des processus, celle d'une organisation FICTIVE (« Entreprise Exemple ») : 10 processus
// répartis en quatre blocs (management, réalisation, support, vérification), les échanges dessinés par les flèches, et les documents cités
// dans la procédure d'exemple PR-VEN-01. L'application est faite pour toute organisation : chacune charge la sienne (PDF, fichier .json ou saisie).
// Cet exemple ne sert qu'à essayer (v0.26 : contenu neutre ; v0.27 : bloc « Vérification » ajouté).

export function exempleCartographie() {
  const processus = [
    ["PIL", "Piloter l'organisation", "management"],
    ["AME", "Améliorer la performance", "management"],
    ["VEN", "Vendre et contractualiser", "realisation"],
    ["REA", "Réaliser le produit ou le service", "realisation"],
    ["LIV", "Livrer et facturer", "realisation"],
    ["RHU", "Gérer les ressources humaines", "support"],
    ["ACH", "Acheter et gérer les stocks", "support"],
    ["FIN", "Gérer les finances", "support"],
    ["SIN", "Gérer les systèmes d'information", "support"],
    ["SUR", "Surveiller, mesurer et auditer", "verification"],
  ].map(([code, nom, categorie]) => ({ id: "q-" + code.toLowerCase(), code, nom, categorie }));
  const flux = [
    ["contexte", "management", "Enjeux, risques et opportunités ⇄ orientations stratégiques", true],
    ["management", "realisation", "Orientations, objectifs, exigences", false],
    ["realisation", "management", "Données de performance, écarts, incidents", false],
    ["q-ven", "q-rea", "Commandes et exigences du client", false],
    ["q-rea", "q-liv", "Produits ou services réalisés", false],
    ["q-liv", "satisfaction", "Produits livrés et facturés", false],
    ["q-ven", "satisfaction", "Réponses aux demandes et aux réclamations", false],
    ["realisation", "verification", "Données, produits et services à contrôler", false],
    ["verification", "management", "Résultats des contrôles, mesures et audits", false],
    ["support", "realisation", "Personnel, équipements, achats, outils SI", false],
    ["realisation", "support", "Besoins en ressources", false],
  ].map(([de, vers, information, double], i) => ({ id: "f" + (i + 1), de, vers, information, double }));
  // Documents cités dans la procédure d'exemple PR-VEN-01 (registre EN-VEN-01 : la personne responsable des codes les attribue).
  const documents = [
    ["PR-VEN-01", "Traiter une commande client"],
    ["IT-VEN-01", "Enregistrer une commande"],
    ["FO-VEN-01", "Modèle d'offre commerciale"],
    ["FO-VEN-02", "Modèle d'accusé de réception"],
    ["EN-VEN-01", "Registre des commandes"],
    ["EN-VEN-02", "Bons de livraison signés"],
  ].map(([code, titre], i) => ({ id: "d" + (i + 1), code, titre }));
  return {
    organisation: "Entreprise Exemple",
    titre: "Cartographie des processus",
    contexte: "Enjeux internes et externes · parties intéressées et leurs exigences · réglementation · changements climatiques",
    exigences: "besoins et attentes des clients et des parties intéressées",
    satisfaction: "des exigences des clients et des parties intéressées",
    processus, flux, documents,
    nomenclature: { controle: true, procedure: "PR", instruction: "IT" }, // cette organisation code ses documents TYPE-PROCESSUS-NN (ex. PR-VEN-01) : c'est un réglage propre à elle
  };
}
