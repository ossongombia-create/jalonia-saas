# Composants de tiers et leurs licences

Ce fichier liste ce que l'application embarque et qui n'a pas été écrit pour elle. Chaque composant garde **sa propre licence** ; le texte
complet de chacune est fourni à côté des fichiers concernés. La fenêtre **Fichier → Mentions et licences** de l'application en donne le résumé.

À tenir à jour à chaque ajout d'un composant (bibliothèque, police, image, icône) : une ligne dans le tableau, le texte de la licence dans
le dossier du composant, et une ligne dans `js/locales/fr.js` et `en.js` (`mentions.licences.*`).

| Composant | Auteur / titulaire | Version | Licence | Où | Sert à |
|---|---|---|---|---|---|
| **PDF.js** (build « legacy », minifié, non modifié) | Mozilla Foundation (© 2024) | 6.3.289 | Apache License 2.0 | `vendor/pdfjs/pdf.min.js`, `vendor/pdfjs/pdf.worker.min.js` ; texte : `vendor/pdfjs/LICENSE` | Lire un PDF de cartographie des processus, dans le navigateur (chargé à la demande) |
| **core-js** (embarqué dans PDF.js) | Denis Pushkarev ; CoreJS Company | 3.50.0 | MIT | dans les deux fichiers PDF.js ; texte : `vendor/pdfjs/LICENSE-core-js.txt` | Compatibilité des navigateurs (fait partie du build de PDF.js) |
| **Outfit** (sous-ensemble latin, graisses 400 à 800, format WOFF2) | The Outfit Project Authors | — | SIL Open Font License 1.1 | `css/fonts/` ; texte : `css/fonts/LICENSE-Outfit.txt` | Police de caractères de l'interface ; les lettres du logo (dossier `img/`) en sont dérivées |

## Ce que ces licences demandent (en clair)
- **Apache 2.0 (PDF.js)** : conserver la licence et les mentions de copyright ; indiquer les modifications s'il y en a (ici : aucune). Pas de garantie.
- **MIT (core-js)** : conserver la mention de copyright et le texte de la licence avec le composant. Pas de garantie.
- **OFL 1.1 (police)** : la police peut être utilisée, copiée et redistribuée librement, y compris dans un produit ; elle ne doit pas être **vendue seule**, et ses
  éventuelles versions modifiées ne doivent pas reprendre le nom réservé.

## Ce que ce fichier ne couvre pas
- Le code et les textes de l'application elle-même : son statut (version d'essai non commerciale), son titulaire des droits (© 2026 Brice Ossongombia — tous droits réservés — version d'essai) et sa licence sont
  donnés par l'application (**Mentions et licences**) et par la décision prise sur le nom et les droits (voir l'analyse juridique du projet).
- La méthode Qualigramme et son livre (S. Guillard et C. Berger) : l'application s'en inspire, elle n'en reproduit aucun passage ; elle n'est ni éditée,
  ni approuvée, ni recommandée par les auteurs de la méthode ni par leurs éditeurs.

*Ce fichier résume des licences ; il n'est pas un avis juridique. Avant toute diffusion au-delà du test fermé, faire relire l'ensemble par un conseil en propriété intellectuelle.*
