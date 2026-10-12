// rules-codes.js — les règles de CODIFICATION d'après la cartographie des processus de l'organisation.
// Toujours (dès qu'une cartographie est chargée) : le processus cité existe ; un code n'est pas déjà attribué à un autre document ;
// une sous-procédure citée figure au registre. Seulement si l'organisation a coché « nomenclature TYPE-PROCESSUS-NN » : la forme du code,
// son type (PR, IT… selon ses réglages) et le processus qu'il cite.
// Ces règles ne s'appliquent que si une cartographie est chargée (sans elle, on ne sait pas quels codes de processus existent).
// Ce sont toutes des ALERTES : le code définitif est attribué par la personne responsable chez l'organisation ; l'application propose et signale.

import { analyserCode, codeTypeDuDocument, documentParCode, nomenclatureActive, processusDuTexte, processusParCode } from "./cartographie.js";

const normaliser = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();

export function verifierCodes(p, carto) {
  if (!carto || carto.processus.length === 0) return [];
  const constats = [];
  const alerte = (cle, params = {}) => constats.push({ gravite: "alerte", cle, params });
  const m = p.meta;
  const controle = nomenclatureActive(carto);
  const typeProcedure = codeTypeDuDocument(carto, "procedure");
  const typeInstruction = codeTypeDuDocument(carto, "instruction");

  // Processus de rattachement : il doit venir de la cartographie (liste de l'étape 1).
  const choisi = processusDuTexte(carto, m.processus);
  if ((m.processus || "").trim() && !choisi) alerte("regle.processus.hors_cartographie", { processus: m.processus.trim() });

  // Code du document : (nomenclature) type cohérent avec le document, processus connu et cohérent ; (toujours) numéro libre.
  const code = (m.reference || "").trim().toUpperCase();
  if (code) {
    const a = controle ? analyserCode(code) : null;
    if (controle) {
      if (!a) {
        alerte("regle.code.format", { code });
      } else {
        const attendu = codeTypeDuDocument(carto, m.typeDocument);
        if (attendu && a.type !== attendu) alerte("regle.code.type", { code, attendu });
        if (!processusParCode(carto, a.processus)) alerte("regle.code.processus_inconnu", { code, processus: a.processus });
        else if (choisi && choisi.code !== a.processus) alerte("regle.code.processus_different", { code, choisi: choisi.code });
      }
    }
    const pris = documentParCode(carto, code);
    if (pris && pris.titre && m.titre && normaliser(pris.titre) !== normaliser(m.titre)) alerte("regle.code.deja_pris", { code, titre: pris.titre });
  }

  // Renvois : sous-procédure (procédure appelée) et instruction de travail rattachée à une étape.
  (p.etapes || []).forEach((e, index) => {
    const i = index + 1;
    if (e.sousProcedure && e.sousProcedure.actif) {
      const c = (e.sousProcedure.code || "").trim().toUpperCase();
      if (c) {
        const a = controle ? analyserCode(c) : null;
        if (controle && !(a && a.type === typeProcedure)) return; // la forme du code est déjà signalée par les règles de base
        if (a && !processusParCode(carto, a.processus)) alerte("regle.sp.processus_inconnu", { i, code: c, processus: a.processus });
        else if (carto.documents.length > 0 && !documentParCode(carto, c)) alerte("regle.sp.absente_registre", { i, code: c });
      }
    }
    if (controle && e.niveau3 && e.niveau3.actif) {
      const c = (e.niveau3.code || "").trim().toUpperCase();
      if (c) {
        const a = analyserCode(c);
        if (!a || a.type !== typeInstruction) alerte("regle.n3.code_format", { i, code: c, type: typeInstruction });
        else if (!processusParCode(carto, a.processus)) alerte("regle.n3.processus_inconnu", { i, code: c, processus: a.processus });
      }
    }
  });
  return constats;
}
