<p align="center"><img src="img/logo-jalonia.svg" alt="Jalonia — Smart Process Design. Ordo &amp; Performance" width="420"></p>

# Jalonia

Application web de rédaction graphique de procédures selon le langage Qualigramme
(spécifications : projet claude.ai « Application Qualigramme »).

## Lancer l'application
1. Ouvre ce dossier dans VS Code.
2. Clic droit sur `index.html` → **Open with Live Server**.
   (Les fichiers `.js` sont des « modules » : ils ne fonctionnent pas en double-cliquant sur `index.html`, il faut Live Server.)

## Organisation du code
| Fichier | Rôle | Question à laquelle il répond |
|---|---|---|
| `index.html` | Le squelette de la page : colonne sarcelle (étapes), en-tête et menu Fichier, zone de travail, barre Continuer, bande de diagnostic, fenêtre d'aperçu | Quelles boîtes sur l'écran ? |
| `img/` | Le logo de Jalonia (complet, icône seule, version claire pour fond sombre) et l'icône de l'onglet, en SVG ; les lettres sont des tracés (aucune police nécessaire) | Où est le logo ? |
| `css/style.css` + `css/fonts/` | L'habillage Jalonia (lavande, sarcelle, violet ; couleurs en variables `--nom`) et la police Outfit fournie avec l'application | À quoi ça ressemble ? |
| `js/model.js` | Le modèle de données (procédure, rôles, étapes, contrôles, alternatives) + un exemple | Comment une procédure est-elle représentée ? |
| `js/store.js` | L'état : la procédure en cours, ses modifications, sauvegarde `.json` sécurisée | Comment modifier la procédure sans rien casser ? |
| `js/parcours.js` | La logique des 4 étapes (quand une étape est-elle remplie ?) | Peut-on passer à l'étape suivante ? |
| `js/parcours-ui.js` | Les 4 étapes dans la colonne sarcelle, la carte de la procédure en cours, le titre de la page, la barre Précédent / Continuer | Comment afficher le parcours ? |
| `js/formulaire.js` | Les champs de saisie partagés, l'étape 1 (identification, validation, historique) et le contenu du document (11 sections) | Comment l'utilisateur saisit-il ? |
| `js/deroule.js` | L'étape 2 : liste des instructions à gauche, une instruction à droite (échanges, R.A.C.I., outils, pastilles de particularités et leurs fiches), fiches Rôles / Début / Fin | Comment saisir le déroulé, une instruction à la fois ? |
| `js/cartes.js` + `js/icones.js` | Les cartes (panneaux blancs à titre et icône), les couleurs des rôles et les icônes de l'interface | Comment présenter chaque idée dans son panneau ? |
| `js/apercus.js` | La fenêtre d'aperçu à la demande (logigramme à l'étape 2, document à l'étape 3), mise à jour en direct | Comment voir le résultat sans encombrer la saisie ? |
| `js/synthese.js` | L'étape 3 : synthèse à relire et à valider | Qu'est-ce qui sera dans le document ? |
| `js/generation.js` | L'étape 4 : boutons Word, PDF (et PNG pour une instruction de travail) | Comment obtenir le document ? |
| `js/document.js` | Le contenu du document au modèle standard (en-tête, validation, historique, 11 sections, tableaux générés, largeurs de colonnes) et l'estimation de pages (5 au plus) | Que contient le document ? |
| `js/apercu.js` | L'aperçu du document (et la feuille imprimée en PDF) | À quoi ressemble le document ? |
| `js/exportDocx.js` + `js/zip.js` | Fabrication du fichier Word (.docx) — procédure ou instruction de travail (une page A4) — et de son conteneur ZIP | Comment écrire un Word sans bibliothèque ? |
| `js/sorties.js` | Ce qui demande le navigateur : image du logigramme, téléchargement, impression | Comment sortir le document ? |
| `js/embarque.js` | La procédure cachée dans le Word généré (aller-retour sans perte) | Comment rouvrir un Word sans rien perdre ? |
| `js/importWord.js` | Lecture d'un Word : procédure embarquée, sinon tableaux du modèle (11 ou 13 sections) | Comment reprendre une procédure existante ? |
| `js/bpmn.js` | Échange BPMN 2.0 d'une procédure : sous-ensemble défini en éléments standard (couloirs, tâches, décisions…), le reste en extensions ; import avec rapport de ce qui n'est pas repris | Comment passer une procédure à un outil BPMN, et inversement ? |
| `js/rules.js` | Le moteur de règles Qualigramme | Cette procédure respecte-t-elle le langage ? |
| `js/rules-it.js` | Le moteur de règles du **niveau 3** (chapitre 7 du livre) : un rôle, 5 à 10 opérations, libellés, contrôles = questions, correctives, opération à risque = contrôle | Cette instruction de travail respecte-t-elle le livre ? |
| `js/deroule-it.js` | L'étape 2 d'une **instruction de travail** : tableau à trois colonnes (opérations / plan d'auto-contrôle / actions correctrices), un seul rôle en haut | Comment saisir une instruction de travail ? |
| `js/synthese-it.js` | L'étape 3 d'une instruction de travail : tableau récapitulatif et conformité | Qu'est-ce qui sera dans l'instruction ? |
| `js/render3.js` + `js/apercu-it.js` | Le dessin d'une instruction de travail sur une page A4 portrait (en-tête, rôle, trois colonnes, légende, comme la fig. 7.7 du livre) et sa feuille d'aperçu / d'impression | Comment la dessiner ? |
| `js/cartographie.js` | La **cartographie des processus de l'organisation** (chaque organisation apporte la sienne) : processus, blocs, échanges, registre des codes, nomenclature réglable, nettoyage, prochain code libre, échanges d'un processus | Quels sont les processus de l'organisation, et comment code-t-elle ses documents ? |
| `js/cartographie-store.js` | L'état de la cartographie (navigateur + fichier `.json`) | Comment la garder et la modifier ? |
| `js/cartographie-pdf.js` + `vendor/pdfjs/` | La lecture d'un **PDF de cartographie** (textes, cadres, flèches) avec la bibliothèque pdf.js, chargée seulement à l'import, en local | Comment reprendre une cartographie existante ? |
| `js/cartographie-ui.js` | La fenêtre « Cartographie des processus » (import, saisie, nomenclature, registre) | Comment voir et corriger la cartographie ? |
| `js/rules-codes.js` | Les règles de codification d'après la cartographie (alertes) | Ce code de document est-il cohérent avec la cartographie ? |
| `js/exemple-carto.js` | Un **exemple** de cartographie (celle d'une organisation fictive, « Entreprise Exemple »), à charger pour essayer | À quoi ressemble une cartographie complète ? |
| `js/diagnostic.js` | Les constats affichés dans la bande de diagnostic, pour une procédure comme pour une instruction | Qu'est-ce qui ne va pas, et où ? |
| `js/questionnement.js` | Le **questionnement en 11 points** (Qui ? Quoi ? Information en entrée ? D'où ? De qui ? Comment ? Avec quoi ? Information en sortie ? Vers quoi ? Vers qui ? Sous quelles contraintes ?) utilisé comme pistes de contrôle pour chaque instruction d'une procédure ou chaque opération d'une instruction de travail : erreur pour les points essentiels, alerte pour Comment, Avec quoi et Contraintes ; jamais affiché sous forme de tableau | Chaque instruction répond-elle aux 11 questions ? |
| `js/exemple-procedure.js` | L'exemple de procédure « Traiter une commande client » (menu Fichier › Exemple), organisation fictive | À quoi ressemble une procédure complète ? |
| `js/exemple-it.js` | L'exemple d'instruction « Enregistrer une commande » (menu Fichier), organisation fictive | À quoi ressemble une instruction complète ? |
| `js/render.js` | Le dessin SVG du logigramme (niveau 2) au style du modèle : bandeau sarcelle, couloirs de rôles, paniers d'information, carrefours ou / et, retours en pointillé rouge, triangle de contrôle, cercle « + » de contrainte, fanion d'indicateur, symbole « contrat » d'interface sur le panier d'une flèche, sous-procédure, macro-instructions, actions amont et aval, action corrective ; choix de la mise en page qui donne le texte le plus grand sur A4 | Comment la dessiner, et à quelle taille ? |
| `js/logo.js` + `js/logoImage.js` | Le logo de l'organisation : préparation dans le navigateur (PNG/JPEG réduit) et lecture des octets et des dimensions pour le Word | Comment mettre le logo dans l'en-tête ? |
| `js/conseils.js` | Les conseils de lisibilité (quel texte raccourcir, combien de points on gagne) | Comment rendre le logigramme plus lisible ? |
| `js/i18n.js` + `js/locales/` | Les textes FR/EN par clés | Quels textes afficher, dans quelle langue ? |
| `js/version.js` | Le numéro de version affiché dans la colonne de gauche | Quelle version un testeur utilise-t-il ? |
| `js/config.js` | Les réglages de la version d'essai : **le nom de l'outil** (le seul endroit où il s'écrit), le titulaire des droits et son année (« © 2026 Brice Ossongombia — tous droits réservés — version d'essai »), l'adresse du formulaire de retours et l'adresse e-mail | Comment s'appelle l'outil, et où vont les retours des testeurs ? |
| `js/vue.js` | Quelle vue est affichée à droite de la colonne sarcelle : l'accueil ou le parcours (et le réglage « ne plus afficher l'accueil ») | Où est-on : accueil ou parcours ? |
| `js/accueil.js` | La logique de l'accueil « Mon espace » : document en cours, avancement, compteurs, cartographie par blocs, date de modification (sans page, testée) | Que montrer à l'ouverture ? |
| `js/accueil-ui.js` | L'écran d'accueil : document en cours, autres façons de commencer, cartographie, aide et version d'essai | Comment reprendre ou commencer un document ? |
| `js/mentions.js` | La fenêtre « Mentions et licences » : version d'essai non commerciale, aide à la rédaction sans garantie, données, composants de tiers | Sous quelles conditions l'outil est-il proposé ? |
| `LICENCES-TIERS.md` | Les composants de tiers embarqués (PDF.js, core-js, Outfit) et leurs licences | Qu'est-ce qui n'est pas de nous, et sous quelle licence ? |
| `js/retour.js` | La fenêtre « Envoyer un retour » : informations techniques à copier (jamais le texte du document), formulaire, e-mail | Comment un testeur nous fait-il un retour ? |
| `guide-fr.html`, `guide-en.html` + `css/guide.css` | Le guide de démarrage d'une page (FR / EN), lié depuis la colonne de gauche | Comment un nouvel utilisateur démarre-t-il ? |
| `js/main.js` | Relie tout | Que faire au chargement et au clic ? |
| `tests/*.test.mjs` | Tests automatiques (règles, store, corps du document, import, parcours, risques et Word, contrôles et boucles, lisibilité, modèle standard et orientation, éléments facultatifs et logo, R.A.C.I. et page de saisie, symbolique de la légende du modèle, nouvelle interface, accueil et mentions, instruction de travail, actions amont / aval, Début / Fin du livre, Word de l'instruction, cartographie des processus, section 8 alimentée et contrat d'interface, domaine et exemples neutres, version d'essai et retours) | L'application se comporte-t-elle comme prévu ? |
| `exercices/` | Tes exercices de formation | — |

## Lancer les tests (quand Node.js sera installé, Module 9)
`node --test "tests/*.test.mjs"`

## Principes
- Aucun texte visible en dur dans le code : des clés + un fichier par langue.
- Le moteur de règles (`rules.js`) ne dessine rien ; le dessin (`render.js`) ne vérifie rien.
- L'application sert **toute organisation** : rien de propre à une entreprise n'est écrit dans le code (les trois exemples — procédure, instruction, cartographie — sont ceux d'une organisation fictive, « Entreprise Exemple »).
- Un libellé saisi n'est jamais inséré tel quel dans la page (échappement, `textContent`).
