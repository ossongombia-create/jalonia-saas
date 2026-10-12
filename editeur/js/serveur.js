// serveur.js — les appels au serveur de l'application web (mode en ligne seulement) : requêtes JSON vers /api/…
// Toujours sur le même site (cookie de session), jamais mis en cache. Ne lève jamais d'erreur : renvoie { statut, corps }
// (statut 0 = pas de réponse : réseau coupé, serveur arrêté…). Le corps est sérialisé AVANT toute attente (voir synchro.js).

export async function appeler(methode, chemin, corps) {
  const options = { method: methode, credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } };
  if (corps !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(corps);
  }
  let reponse;
  try {
    reponse = await fetch(chemin, options);
  } catch (e) {
    return { statut: 0, corps: null };
  }
  let donnees = null;
  try {
    donnees = await reponse.json();
  } catch (e) {
    // pas du JSON (page d'erreur du serveur intermédiaire pendant une mise à jour…) : le statut suffit
  }
  // Une réponse « 200 » qui n'est pas du JSON n'est pas une réponse de l'application (redirection inattendue…) : on réessaiera.
  if (reponse.ok && donnees === null) return { statut: 0, corps: null };
  return { statut: reponse.status, corps: donnees };
}
