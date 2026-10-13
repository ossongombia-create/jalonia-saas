// Primitives du second facteur, sans dépendance externe (node:crypto) :
//   - HOTP (RFC 4226) et TOTP (RFC 6238), vérifiés contre les vecteurs de test des RFC (tests/unit/totp.test.ts) ;
//   - base32 (RFC 4648) pour le secret saisi ou scanné dans l'application d'authentification ;
//   - chiffrement AES-256-GCM du secret en base, lié au compte (données associées = identifiant du compte) ;
//   - codes de secours et leur empreinte HMAC-SHA-256 (la même clé : une base volée ne permet pas de les retrouver).
// Paramètres utilisés par Jalonia : SHA-1, 6 chiffres, pas de 30 s (ce que toutes les applications acceptent).
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const PAS_SECONDES = 30;
export const CHIFFRES = 6;
/** Pas acceptés autour de l'heure du serveur : −1, 0, +1 (décalage d'horloge du téléphone jusqu'à ±30 s). */
export const TOLERANCE_PAS = 1;

const ALPHABET_BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function versBase32(octets: Buffer): string {
  let bits = 0;
  let valeur = 0;
  let sortie = "";
  for (const octet of octets) {
    valeur = ((valeur << 8) | octet) & 0xffff; // seuls les bits non encore lus comptent (au plus 12)
    bits += 8;
    while (bits >= 5) {
      sortie += ALPHABET_BASE32[(valeur >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) sortie += ALPHABET_BASE32[(valeur << (5 - bits)) & 31];
  return sortie;
}

export function depuisBase32(texte: string): Buffer {
  const propre = texte.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let valeur = 0;
  const octets: number[] = [];
  for (const c of propre) {
    const i = ALPHABET_BASE32.indexOf(c);
    if (i < 0) throw new Error("base32 invalide");
    valeur = ((valeur << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      octets.push((valeur >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(octets);
}

export type Algorithme = "sha1" | "sha256" | "sha512";

/** HOTP (RFC 4226, § 5.3) : troncature dynamique du HMAC du compteur. */
export function hotp(secret: Buffer, compteur: bigint, chiffres = CHIFFRES, algorithme: Algorithme = "sha1"): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(compteur);
  const h = createHmac(algorithme, secret).update(message).digest();
  const decalage = h[h.length - 1]! & 0x0f;
  const binaire = ((h[decalage]! & 0x7f) << 24) | (h[decalage + 1]! << 16) | (h[decalage + 2]! << 8) | h[decalage + 3]!;
  return String(binaire % 10 ** chiffres).padStart(chiffres, "0");
}

/** Numéro du pas de temps (RFC 6238 : T = floor(temps Unix / 30)). */
export function pasDe(tempsMs: number): number {
  return Math.floor(tempsMs / 1000 / PAS_SECONDES);
}

export function totp(secret: Buffer, tempsMs: number, chiffres = CHIFFRES, algorithme: Algorithme = "sha1"): string {
  return hotp(secret, BigInt(pasDe(tempsMs)), chiffres, algorithme);
}

/**
 * Vérifie un code : renvoie le pas accepté, ou null. Un pas déjà utilisé (ou antérieur) est refusé : un code
 * intercepté ne peut pas être rejoué. Comparaison en temps constant.
 */
export function verifierTotp(secret: Buffer, code: string, dernierPas: number | null, maintenantMs: number): number | null {
  if (!new RegExp(`^\\d{${CHIFFRES}}$`).test(code)) return null;
  const courant = pasDe(maintenantMs);
  let accepte: number | null = null;
  for (let ecart = -TOLERANCE_PAS; ecart <= TOLERANCE_PAS; ecart++) {
    const pas = courant + ecart;
    const attendu = hotp(secret, BigInt(pas));
    // On parcourt TOUS les pas (pas de sortie anticipée) : même durée quel que soit le résultat.
    if (timingSafeEqual(Buffer.from(attendu), Buffer.from(code)) && (dernierPas === null || pas > dernierPas)) accepte = pas;
  }
  return accepte;
}

/** Nouveau secret : 20 octets (160 bits, taille recommandée par la RFC 4226 pour SHA-1). */
export function nouveauSecret(): Buffer {
  return randomBytes(20);
}

/** Adresse « otpauth:// » lue par les applications d'authentification (code QR). */
export function adresseOtpauth(secret: Buffer, compte: string, emetteur = "Jalonia"): string {
  const libelle = `${encodeURIComponent(emetteur)}:${encodeURIComponent(compte)}`;
  const parametres = new URLSearchParams({ secret: versBase32(secret), issuer: emetteur, algorithm: "SHA1", digits: String(CHIFFRES), period: String(PAS_SECONDES) });
  return `otpauth://totp/${libelle}?${parametres.toString()}`;
}

// ---------- Chiffrement du secret en base ----------

/** Clé de 32 octets, donnée en base64 dans la variable d'environnement CLE_SECOND_FACTEUR. */
export function lireCle(base64: string): Buffer {
  const cle = Buffer.from(base64.trim(), "base64");
  if (cle.length !== 32) throw new Error("CLE_SECOND_FACTEUR doit faire 32 octets (générer avec : openssl rand -base64 32).");
  return cle;
}

/** « v1.<iv>.<étiquette>.<chiffré> » (base64url). Les données associées lient le chiffré au compte. */
export function chiffrer(clair: Buffer, cle: Buffer, associe: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cle, iv);
  c.setAAD(Buffer.from(associe, "utf8"));
  const chiffre = Buffer.concat([c.update(clair), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), chiffre.toString("base64url")].join(".");
}

export function dechiffrer(texte: string, cle: Buffer, associe: string): Buffer {
  const [version, iv, etiquette, chiffre] = texte.split(".");
  if (version !== "v1" || !iv || !etiquette || !chiffre) throw new Error("format de secret chiffré inconnu");
  const d = createDecipheriv("aes-256-gcm", cle, Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(associe, "utf8"));
  d.setAuthTag(Buffer.from(etiquette, "base64url"));
  return Buffer.concat([d.update(Buffer.from(chiffre, "base64url")), d.final()]);
}

// ---------- Codes de secours ----------

/** Alphabet sans caractères ambigus (ni 0/O, ni 1/l/I). */
const ALPHABET_SECOURS = "abcdefghjkmnpqrstuvwxyz23456789";
export const NOMBRE_CODES_SECOURS = 10;
export const MOTIF_CODE_SECOURS = /^[a-z2-9]{5}-[a-z2-9]{5}$/;

/** Codes « xxxxx-xxxxx » : 10 caractères tirés parmi 31, soit ~49 bits chacun. */
export function nouveauxCodesSecours(n = NOMBRE_CODES_SECOURS): string[] {
  const code = () => Array.from({ length: 10 }, () => ALPHABET_SECOURS[randomInt(ALPHABET_SECOURS.length)]).join("");
  return Array.from({ length: n }, () => {
    const c = code();
    return `${c.slice(0, 5)}-${c.slice(5)}`;
  });
}

/** Normalise une saisie (majuscules, espaces) ; null si ce n'est pas un code de secours. */
export function normaliserCodeSecours(saisie: string): string | null {
  const c = saisie.trim().toLowerCase().replace(/\s+/g, "");
  const avecTiret = /^[a-z2-9]{10}$/.test(c) ? `${c.slice(0, 5)}-${c.slice(5)}` : c;
  return MOTIF_CODE_SECOURS.test(avecTiret) ? avecTiret : null;
}

export function empreinteCodeSecours(code: string, cle: Buffer): string {
  return createHmac("sha256", cle).update(`code-secours:${code}`).digest("hex");
}
