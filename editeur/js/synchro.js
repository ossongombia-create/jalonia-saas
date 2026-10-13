// synchro.js — l'enregistrement AUTOMATIQUE sur le serveur (mode en ligne), pour un document ou pour la cartographie.
// Sans dépendance au navigateur : testable avec « node --test » (tests/synchro.test.mjs).
//
// Principe :
//   - chaque modification est signalée (signaler()) ; on enregistre 1,5 s après la dernière (on n'envoie pas une requête par lettre) ;
//   - une seule requête à la fois : les demandes suivantes attendent leur tour, puis vérifient s'il reste quelque chose à envoyer ;
//   - le serveur tient un numéro de VERSION : on lui dit sur quelle version on a travaillé. Si quelqu'un a enregistré entre-temps,
//     il refuse (conflit) : l'enregistrement s'arrête et la page demande à la personne ce qu'elle veut (recharger ou garder sa version) ;
//   - coupure réseau ou serveur indisponible : nouvel essai automatique, de plus en plus espacé (2 s, 4 s, 8 s… 30 s au plus) ;
//   - les autres refus (session expirée, droits retirés, document soumis au circuit de validation, supprimé, trop volumineux…) arrêtent l'enregistrement et sont
//     expliqués à la personne ; son travail reste dans la page (et peut être téléchargé en .json).
// On compare des EMPREINTES du contenu : revenir (par « annuler ») à ce qui est déjà enregistré n'envoie rien.

export const DELAI_ENREGISTREMENT = 1500;
export const ATTENTE_MAX = 30000;

// Ce que veut dire une réponse refusée, pour la page.
export function raisonDuRefus(statut, corps) {
  const erreur = corps && typeof corps === "object" ? corps.erreur : undefined;
  if (statut === 409 && erreur === "conflit") return "conflit";
  if (statut === 409 && erreur === "organisation_changee") return "organisation_changee";
  if (statut === 403 && erreur === "organisation") return "organisation_changee";
  if (statut === 401 || (statut === 403 && erreur === "mot_de_passe")) return "session";
  if (statut === 403 && erreur === "circuit") return "circuit"; // document soumis au circuit de validation entre-temps
  if (statut === 403) return "interdit";
  if (statut === 404) return "introuvable";
  if (statut === 413) return "trop_volumineux";
  if (statut === 400 || statut === 415) return "invalide";
  return null; // réseau, serveur indisponible (0, 5xx…) : on réessaiera
}

/**
 * options :
 *   contenu()                 → l'objet à enregistrer, tel qu'il est maintenant
 *   empreinte(objet)          → son empreinte (deux contenus identiques donnent la même)
 *   envoyer({ version, forcer, contenu }) → Promise<{ statut, corps }> ; doit lire `contenu` AVANT sa première attente (await)
 *   surChangement(etat)       → appelée à chaque changement d'état (pour l'affichage)
 *   delai, minuterie          → réglables pour les tests
 */
// Minuterie du navigateur. Appelées comme méthodes d'un objet, setTimeout / clearTimeout lèvent « Illegal invocation » dans un
// navigateur : on les enveloppe.
const MINUTERIE = { definir: (fn, ms) => setTimeout(fn, ms), annuler: (id) => clearTimeout(id) };

export function creerSynchro({ contenu, empreinte, envoyer, surChangement = () => {}, delai = DELAI_ENREGISTREMENT, minuterie = MINUTERIE }) {
  let actif = false;
  let version = 0;
  let reference = ""; // empreinte du dernier contenu accepté par le serveur
  let enCours = false;
  let echecs = 0;
  let minuteur = null;
  let blocage = null; // { raison, details }
  let ignorer = false; // pendant un rechargement : les modifications signalées viennent du serveur
  let file = Promise.resolve(); // les envois passent l'un après l'autre

  const empreinteActuelle = () => empreinte(contenu());

  function etat(e) {
    if (!actif) return { cle: "inactif" };
    if (blocage) return { cle: "bloque", raison: blocage.raison, details: blocage.details };
    if (enCours) return { cle: "envoi" };
    if (echecs > 0) return { cle: "erreur_reseau", echecs };
    return (e ?? empreinteActuelle()) === reference ? { cle: "enregistre" } : { cle: "modifie" };
  }
  const prevenir = (e) => surChangement(etat(e));

  function annulerMinuteur() {
    if (minuteur !== null) minuterie.annuler(minuteur);
    minuteur = null;
  }
  function planifier(ms) {
    annulerMinuteur();
    minuteur = minuterie.definir(() => {
      minuteur = null;
      envoyerMaintenant();
    }, ms);
  }

  function traiter(reponse, envoyee) {
    const { statut, corps } = reponse;
    if ((statut === 200 || statut === 201) && corps && Number.isInteger(corps.version)) {
      version = corps.version;
      reference = envoyee;
      echecs = 0;
      const e = empreinteActuelle();
      if (e !== reference) planifier(delai); // modifié pendant l'envoi : on enregistre la suite
      prevenir(e);
      return e === reference;
    }
    const raison = raisonDuRefus(statut, corps);
    if (raison) {
      blocage = { raison, details: corps && typeof corps === "object" ? corps : null };
    } else {
      echecs += 1;
      planifier(Math.min(ATTENTE_MAX, 2000 * 2 ** (echecs - 1)));
    }
    prevenir();
    return false;
  }

  async function executer(forcer) {
    annulerMinuteur();
    if (!actif) return false;
    if (blocage) {
      prevenir();
      return false;
    }
    const objet = contenu();
    const envoyee = empreinte(objet);
    if (envoyee === reference && !forcer) {
      prevenir(envoyee);
      return true;
    }
    enCours = true;
    prevenir(envoyee);
    let reponse;
    try {
      reponse = await envoyer({ version, forcer: Boolean(forcer), contenu: objet });
    } catch (e) {
      reponse = { statut: 0, corps: null };
    }
    enCours = false;
    return traiter(reponse || { statut: 0, corps: null }, envoyee);
  }

  // Envoie maintenant (après l'envoi en cours, s'il y en a un). Résout à true si tout est enregistré.
  function envoyerMaintenant(forcer = false) {
    const tache = file.then(() => executer(forcer));
    file = tache.catch(() => false);
    return tache;
  }

  return {
    // Le contenu vient d'être ouvert (version donnée par le serveur) : il est, par définition, enregistré.
    demarrer(v) {
      version = v;
      reference = empreinteActuelle();
      actif = true;
      blocage = null;
      echecs = 0;
      annulerMinuteur();
      prevenir();
    },
    // Remplace le contenu par celui du serveur (charger() le pose dans la page) sans le prendre pour une modification.
    recharger(v, charger) {
      ignorer = true;
      try {
        charger();
      } finally {
        ignorer = false;
      }
      version = v;
      reference = empreinteActuelle();
      blocage = null;
      echecs = 0;
      annulerMinuteur();
      prevenir();
    },
    // À appeler à chaque modification.
    signaler() {
      if (!actif || ignorer) return;
      if (blocage && blocage.raison === "trop_volumineux") blocage = null; // la personne a modifié : on retentera
      const e = empreinteActuelle();
      if (!blocage && !enCours) {
        if (e !== reference) planifier(delai);
        else annulerMinuteur(); // revenu à ce qui est enregistré (annuler) : rien à envoyer
      }
      prevenir(e);
    },
    envoyerMaintenant: () => envoyerMaintenant(false),
    // Après un conflit : remplacer la version du serveur par la sienne (choix explicite).
    garderMaVersion() {
      blocage = null;
      return envoyerMaintenant(true);
    },
    // Après un refus (session rétablie, organisation rouverte…) : nouvel essai.
    reessayer() {
      blocage = null;
      echecs = 0;
      return envoyerMaintenant(false);
    },
    // Reste-t-il quelque chose de non enregistré ?
    enAttente() {
      return actif && (enCours || empreinteActuelle() !== reference);
    },
    etat: () => etat(),
    version: () => version,
  };
}
