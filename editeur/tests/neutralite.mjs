// Mots qui ne doivent apparaître nulle part dans l'application : noms d'entreprises réelles, de lieux et codes qui leur sont propres.
// Les mots sont écrits en morceaux collés ensemble pour que le dossier lui-même n'en contienne aucun en toutes lettres.
const m = (...morceaux) => morceaux.join("");

export const MOTS_PROPRES = [
  m("P", "S", "L"), m("Pe", "tro"), m("Nep", "tune"), m("QH", "SSE"), m("Dou", "ala"), m("Yaou", "ndé"), m("Yaou", "nde"), m("Came", "roun"),
  m("carbu", "rant"), m("station", "-service"), m("stations", "-service"),
];
// Mêmes mots, plus les codes de documents et de processus propres à ces entreprises.
export const PROPRE = new RegExp(`${MOTS_PROPRES.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}|\\b${m("Q", "SE")}\\b|-${m("Q", "SE")}-|-${m("TR", "A")}-`);
// Pour balayer des fichiers : le sigle de l'entreprise s'écrit en capitales, mot entier.
export const SIGLE = new RegExp(`\\b${m("P", "S", "L")}\\b`);
// Codes de processus de l'ancienne organisation pilote : ils ne doivent pas se retrouver dans le code de l'application.
export const CODES_PROCESSUS_PROPRES = new RegExp(`\\b(${m("TR", "A")}|${m("ST", "A")})\\b`);
