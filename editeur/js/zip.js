// zip.js — écrit une archive ZIP (le conteneur d'un fichier .docx), sans bibliothèque.
// Méthode « stockée » : les fichiers sont copiés tels quels, sans compression. C'est valide pour Word
// (le XML est petit, l'image PNG est déjà compressée) et cela reste simple à vérifier.
// Structure d'un ZIP : [en-tête local + contenu] pour chaque fichier, puis le répertoire central
// (la liste des fichiers), puis une fin de répertoire.

const TABLE_CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

// Somme de contrôle CRC-32 d'une suite d'octets (exigée par le format ZIP).
export function crc32(octets) {
  let c = 0xffffffff;
  for (let i = 0; i < octets.length; i += 1) c = TABLE_CRC[(c ^ octets[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const encodeur = new TextEncoder();

// fichiers : [{ nom: "word/document.xml", donnees: Uint8Array | string }] -> Uint8Array (l'archive).
export function creerZip(fichiers, date = new Date()) {
  const annee = Math.min(2107, Math.max(1980, date.getFullYear()));
  const dosDate = ((annee - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosHeure = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);

  const prepares = fichiers.map((f) => {
    const nom = encodeur.encode(f.nom);
    const donnees = typeof f.donnees === "string" ? encodeur.encode(f.donnees) : f.donnees;
    return { nom, donnees, crc: crc32(donnees) };
  });

  const total = prepares.reduce((s, f) => s + 30 + f.nom.length + f.donnees.length + 46 + f.nom.length, 22);
  const sortie = new Uint8Array(total);
  const vue = new DataView(sortie.buffer);
  let pos = 0;
  const decalages = [];

  prepares.forEach((f) => {
    decalages.push(pos);
    vue.setUint32(pos, 0x04034b50, true); // signature « en-tête local »
    vue.setUint16(pos + 4, 20, true); // version nécessaire
    vue.setUint16(pos + 6, 0x0800, true); // noms de fichiers en UTF-8
    vue.setUint16(pos + 8, 0, true); // méthode 0 = stocké
    vue.setUint16(pos + 10, dosHeure, true);
    vue.setUint16(pos + 12, dosDate, true);
    vue.setUint32(pos + 14, f.crc, true);
    vue.setUint32(pos + 18, f.donnees.length, true);
    vue.setUint32(pos + 22, f.donnees.length, true);
    vue.setUint16(pos + 26, f.nom.length, true);
    vue.setUint16(pos + 28, 0, true);
    sortie.set(f.nom, pos + 30);
    sortie.set(f.donnees, pos + 30 + f.nom.length);
    pos += 30 + f.nom.length + f.donnees.length;
  });

  const debutRepertoire = pos;
  prepares.forEach((f, k) => {
    vue.setUint32(pos, 0x02014b50, true); // signature « répertoire central »
    vue.setUint16(pos + 4, 20, true); // créé par
    vue.setUint16(pos + 6, 20, true); // version nécessaire
    vue.setUint16(pos + 8, 0x0800, true);
    vue.setUint16(pos + 10, 0, true);
    vue.setUint16(pos + 12, dosHeure, true);
    vue.setUint16(pos + 14, dosDate, true);
    vue.setUint32(pos + 16, f.crc, true);
    vue.setUint32(pos + 20, f.donnees.length, true);
    vue.setUint32(pos + 24, f.donnees.length, true);
    vue.setUint16(pos + 28, f.nom.length, true);
    // extra, commentaire, disque, attributs : 0
    vue.setUint32(pos + 42, decalages[k], true);
    sortie.set(f.nom, pos + 46);
    pos += 46 + f.nom.length;
  });

  vue.setUint32(pos, 0x06054b50, true); // fin de répertoire
  vue.setUint16(pos + 8, prepares.length, true);
  vue.setUint16(pos + 10, prepares.length, true);
  vue.setUint32(pos + 12, pos - debutRepertoire, true);
  vue.setUint32(pos + 16, debutRepertoire, true);
  return sortie;
}
