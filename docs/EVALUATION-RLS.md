# Évaluation — sécurité au niveau des lignes (RLS) de PostgreSQL

13 octobre 2026. Question posée par l'audit (section 4.1) : la RLS est-elle utile, et pour quelles tables ?

**Conclusion : la RLS n'est pas adoptée pour l'instant.** Pour les données d'organisation, elle serait moins forte
que le dispositif en place. Pour les données communes, elle ne protégerait que contre un filtre oublié dans le code.
Ce risque est couvert autrement, par des preuves vérifiables à chaque envoi. Les conditions qui feraient changer cette
décision, et la façon de faire alors, sont en fin de document.

## 1. Ce qui protège aujourd'hui

| Données | Rangement | Ce qui empêche une organisation de lire celles d'une autre |
|---|---|---|
| Documents, cartographie, journal d'une organisation | Un schéma et un rôle PostgreSQL par organisation | **PostgreSQL.** Chaque transaction bascule sur le rôle de l'organisation ouverte (`SET LOCAL ROLE`). Ce rôle n'a aucun droit sur les autres schémas, et l'application n'hérite d'aucun rôle d'organisation. Une requête sans filtre ne voit que l'organisation ouverte : les autres tables ne lui sont pas accessibles. |
| Comptes, adhésions, invitations, sessions, codes de secours, journal de la plateforme (`platform.*`) | Tables communes | **Le code de l'application.** Chaque requête filtre sur l'organisation tirée du contexte vérifié. Le rôle `jalonia_app` lit toutes les lignes ; ses droits d'écriture sont accordés colonne par colonne, et il ne peut supprimer que dans trois tables (adhésions, codes de secours, tentatives de connexion). |

Pour les données d'organisation, la RLS ferait double emploi, avec moins de force : une politique de ligne repose
sur une valeur à fournir, alors que la séparation par schéma ne dépend d'aucun filtre.

## 2. Où une organisation pourrait voir les données d'une autre : inventaire

Toutes les requêtes sur `platform.*` (13 fichiers de `src/server`) ont été passées en revue. Elles se rangent en
quatre familles.

**a) Requêtes de la portée d'une organisation, ouvertes à son administrateur.** C'est la seule famille où un filtre
oublié laisserait voir une autre organisation.

| Fonction | Filtre | Point d'entrée | Preuve |
|---|---|---|---|
| `listerMembres` | `adhesions.organisation_id = $1`. La dernière action est lue dans le journal de la **même** organisation. | page `/app/membres` (`exigerOrganisation("organisation.membres.gerer")`) | matrice des autorisations : la page « Membres » de A ne montre aucune adresse de B, et inversement (invitations en attente comprises) ; `invitations.test.ts` |
| `listerInvitations` | `organisation_id = $1` | même page | idem |
| `inviter` | organisation du contexte (formulaire comparé à l'organisation ouverte) | `actionInviterMembre` | matrice : l'administrateur de B est refusé vers A, et l'administrateur de A vers B |
| `annulerInvitation` | `id = $1 AND organisation_id = $2` | `actionAnnulerInvitation` | matrice : B annule une invitation de A **depuis sa propre organisation** → « introuvable », base inchangée. Faille M1 introduite volontairement (filtre retiré) : **détectée**. |
| `modifierRoles`, `retirerMembre` | `utilisateur_id = $1 AND organisation_id = $2` | actions du même nom | matrice : B vise un membre de A depuis sa propre organisation → « introuvable », base inchangée |

**b) Requêtes sur la personne connectée**, où l'identifiant vient de la session vérifiée en base, jamais du
formulaire : adhésions de la personne (`lireAdhesions`), sa session (`validerSession`), son second facteur, son mot
de passe, sa langue, l'acceptation d'une invitation (l'adresse de l'invitation doit être la sienne : matrice, refus
« invitation adressée à une autre personne »).

**c) Requêtes publiques par conception**, où l'accès passe par un secret : connexion (adresse et mot de passe),
limitation des tentatives, lecture d'une invitation (par l'empreinte de son jeton de 256 bits).

**d) Requêtes réservées au superadmin**, qui voit toute la plateforme par définition : consultation des sessions et
du journal, gestion des comptes et des organisations. Chaque action revérifie le rôle. Dans la matrice, les
8 actions de la plateforme répondent « introuvable » aux cinq profils d'organisation et renvoient vers la connexion
pour une session absente ou en attente. Faille M2 introduite volontairement (contrôle retiré) : **détectée**.

**Injection SQL.** Toutes les valeurs passent en paramètres (`$1`, `$2`…). Seuls des noms sont insérés dans le texte
SQL : listes de colonnes constantes, expression canonique du journal, noms de schéma validés par expression
régulière puis cités (`citer`). Aucune requête n'assemble de condition à partir d'une saisie.

## 3. Ce que la RLS apporterait sur les tables communes, et ce qu'elle n'apporterait pas

L'application se connecte avec **un seul** rôle (`jalonia_app`). Une politique de ligne devrait donc s'appuyer sur
une valeur posée par l'application à chaque transaction, par exemple
`set_config('jalonia.organisation', …, true)` :

- **Elle n'arrêterait ni une injection SQL ni une exécution de code dans le service.** Tout code capable d'envoyer
  du SQL avec le rôle de l'application peut aussi changer cette valeur : `set_config` ne peut pas être retiré à un
  rôle.
- **Elle ne couvrirait que l'oubli d'un filtre dans les fonctions de la famille a)**, soit six fonctions, toutes
  éprouvées par la matrice à chaque envoi.
- **Il lui faudrait plusieurs modes de contournement** : connexion (aucune organisation encore), validation de la
  session à chaque requête (toutes les organisations de la personne), invitation lue par son jeton (personne n'est
  connecté), superadmin (tout). Chaque mode serait lui aussi une valeur posée par l'application.
- **Coûts et risques** :
  - une politique évaluée sur chaque requête, y compris la validation de session faite à chaque page ;
  - le propriétaire des tables (migrations, fonction de création d'organisation) échappe aux politiques, sauf
    `FORCE ROW LEVEL SECURITY`, qu'il faudrait alors régler finement ;
  - un oubli dans une politique fermerait l'accès à tous, en production ;
  - des migrations plus délicates.

Le rapport entre le bénéfice (une seconde barrière contre un oubli déjà testé) et le risque ajouté (pannes, complexité
des migrations) n'est pas favorable aujourd'hui.

## 4. Décision et garde-fous

- **Pas de RLS sur les tables communes pour l'instant.** La séparation par schéma et par rôle reste la barrière des
  données d'organisation.
- **Garde-fous vérifiés à chaque envoi** (`.github/workflows/verifications.yml`) :
  - la matrice des autorisations (`tests/e2e/autorisations.cjs`) appelle **toutes** les actions serveur avec huit
    profils, y compris les cas « depuis l'autre organisation ». Une action nouvelle sans entrée dans la matrice fait
    échouer le test ;
  - les tests d'intégration contrôlent l'isolation entre schémas (`isolation.test.ts`, `documents.test.ts`), les
    invitations (`invitations.test.ts`) et les membres (`membres.test.ts`).
- **Règle de code** : une fonction de la famille a) reçoit l'organisation **du contexte vérifié**
  (`OrganisationCible`), jamais un identifiant lu seul dans le formulaire. Toute requête sur une table commune qui
  porte `organisation_id` le filtre.

## 5. À reconsidérer si…

- une **API pour des tiers**, ou un portail, multiplie les lectures de tables communes à la portée d'une
  organisation ;
- de nouvelles tables communes portent des données **métier** (et non plus seulement des comptes, des adhésions et
  des traces).

La voie à prendre alors **ne passerait pas par une valeur posée par l'application**. Les lectures de la famille a)
s'exécuteraient dans la transaction de l'organisation, déjà basculée sur son rôle (`dansOrganisation`), et ce rôle
recevrait la lecture des tables communes concernées. Les politiques seraient de la forme
`organisation_id = (SELECT id FROM platform.organisations WHERE role_name = current_user)`. Elles s'appuieraient ainsi
sur le rôle PostgreSQL qui protège déjà les données de l'organisation : un filtre oublié ne pourrait plus rien
laisser passer. Une exécution de code dans le service resterait, comme aujourd'hui, hors de portée de toute RLS.
