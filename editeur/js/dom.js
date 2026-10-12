// dom.js — petit assistant pour créer des éléments HTML sans jamais passer par innerHTML.

// Petit assistant : h("div", { class: "x" }, enfant1, enfant2) crée <div class="x">…</div>.
export function h(balise, attributs = {}, ...enfants) {
  const el = document.createElement(balise);
  Object.entries(attributs).forEach(([nom, valeur]) => {
    if (valeur === undefined || valeur === false) return;
    if (nom === "class") el.className = valeur;
    else if (nom === "value") el.value = valeur;
    else if (nom === "checked") el.checked = valeur;
    else if (nom.startsWith("on")) el.addEventListener(nom.slice(2), valeur);
    else el.setAttribute(nom, valeur === true ? "" : valeur);
  });
  // null / undefined / false : rien à afficher (sinon append() écrirait le mot « null »).
  enfants.flat().forEach((e) => { if (e !== null && e !== undefined && e !== false) el.append(e); });
  return el;
}
