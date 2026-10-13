// Second facteur : vecteurs de test officiels (RFC 4648, 4226, 6238), tolérance d'horloge, rejeu, chiffrement.
import { describe, expect, it } from "vitest";
import {
  adresseOtpauth, chiffrer, dechiffrer, depuisBase32, empreinteCodeSecours, hotp, lireCle, normaliserCodeSecours, nouveauSecret,
  nouveauxCodesSecours, pasDe, totp, verifierTotp, versBase32, MOTIF_CODE_SECOURS,
} from "@/server/auth/totp";

describe("base32 (RFC 4648 § 10, sans remplissage)", () => {
  const vecteurs: [string, string][] = [["", ""], ["f", "MY"], ["fo", "MZXQ"], ["foo", "MZXW6"], ["foob", "MZXW6YQ"], ["fooba", "MZXW6YTB"], ["foobar", "MZXW6YTBOI"]];
  it.each(vecteurs)("%j → %s", (clair, code) => {
    expect(versBase32(Buffer.from(clair))).toBe(code);
    expect(depuisBase32(code).toString()).toBe(clair);
  });
  it("aller-retour sur des octets aléatoires ; saisie en minuscules avec espaces acceptée ; caractère interdit refusé", () => {
    for (let i = 0; i < 200; i++) {
      const s = nouveauSecret();
      expect(depuisBase32(versBase32(s))).toEqual(s);
      expect(depuisBase32(versBase32(s).toLowerCase().replace(/(.{4})/g, "$1 "))).toEqual(s);
    }
    expect(() => depuisBase32("ABC1")).toThrow();
  });
});

describe("HOTP (RFC 4226, annexe D)", () => {
  const secret = Buffer.from("12345678901234567890");
  const attendus = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  it.each(attendus.map((c, i) => [i, c]))("compteur %i → %s", (i, code) => {
    expect(hotp(secret, BigInt(i))).toBe(code);
  });
});

describe("TOTP (RFC 6238, annexe B : 8 chiffres)", () => {
  const graines = {
    sha1: Buffer.from("12345678901234567890"),
    sha256: Buffer.from("12345678901234567890123456789012"),
    sha512: Buffer.from("1234567890123456789012345678901234567890123456789012345678901234"),
  } as const;
  const vecteurs: [number, string, string, string][] = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ];
  it.each(vecteurs)("t = %i s", (t, sha1, sha256, sha512) => {
    expect(totp(graines.sha1, t * 1000, 8, "sha1")).toBe(sha1);
    expect(totp(graines.sha256, t * 1000, 8, "sha256")).toBe(sha256);
    expect(totp(graines.sha512, t * 1000, 8, "sha512")).toBe(sha512);
  });
});

describe("vérification d'un code", () => {
  const secret = nouveauSecret();
  const t = Date.UTC(2026, 9, 13, 8, 0, 15);
  const pas = pasDe(t);
  const code = (decalage: number) => hotp(secret, BigInt(pas + decalage));

  it("tolérance d'horloge : pas précédent, courant et suivant acceptés ; au-delà refusés", () => {
    expect(verifierTotp(secret, code(0), null, t)).toBe(pas);
    expect(verifierTotp(secret, code(-1), null, t)).toBe(pas - 1);
    expect(verifierTotp(secret, code(1), null, t)).toBe(pas + 1);
    expect(verifierTotp(secret, code(-2), null, t)).toBeNull();
    expect(verifierTotp(secret, code(2), null, t)).toBeNull();
  });

  it("rejeu refusé : un pas déjà utilisé (ou antérieur) ne sert plus", () => {
    expect(verifierTotp(secret, code(0), pas, t)).toBeNull();
    expect(verifierTotp(secret, code(-1), pas - 1, t)).toBeNull();
    expect(verifierTotp(secret, code(1), pas, t)).toBe(pas + 1);
  });

  it("formats invalides refusés", () => {
    for (const saisie of ["", "12345", "1234567", "abcdef", " 123456", "12 345"]) expect(verifierTotp(secret, saisie, null, t), saisie).toBeNull();
  });

  it("adresse otpauth lisible par les applications", () => {
    const u = new URL(adresseOtpauth(secret, "brice@exemple.com"));
    expect(u.protocol).toBe("otpauth:");
    expect(u.host).toBe("totp");
    expect(decodeURIComponent(u.pathname)).toBe("/Jalonia:brice@exemple.com");
    expect(Object.fromEntries(u.searchParams)).toEqual({ secret: versBase32(secret), issuer: "Jalonia", algorithm: "SHA1", digits: "6", period: "30" });
  });
});

describe("chiffrement du secret (AES-256-GCM)", () => {
  const cle = lireCle(Buffer.alloc(32, 7).toString("base64"));
  it("aller-retour ; chiffré différent à chaque fois ; lié au compte ; altération détectée ; mauvaise clé refusée", () => {
    const secret = nouveauSecret();
    const a = chiffrer(secret, cle, "compte-a");
    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(chiffrer(secret, cle, "compte-a")).not.toBe(a);
    expect(dechiffrer(a, cle, "compte-a")).toEqual(secret);
    expect(() => dechiffrer(a, cle, "compte-b")).toThrow();
    const [v, iv, tag, c] = a.split(".");
    const altere = [v, iv, tag, Buffer.from(Buffer.from(c!, "base64url").map((o, i) => (i === 0 ? o ^ 1 : o))).toString("base64url")].join(".");
    expect(() => dechiffrer(altere, cle, "compte-a")).toThrow();
    expect(() => dechiffrer(a, lireCle(Buffer.alloc(32, 8).toString("base64")), "compte-a")).toThrow();
  });
  it("clé de mauvaise taille refusée", () => {
    expect(() => lireCle(Buffer.alloc(16).toString("base64"))).toThrow(/32 octets/);
  });
});

describe("codes de secours", () => {
  const cle = Buffer.alloc(32, 3);
  it("10 codes distincts au bon format ; saisie tolérante ; empreinte dépendante de la clé", () => {
    const codes = nouveauxCodesSecours();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(MOTIF_CODE_SECOURS);
    const c = codes[0]!;
    expect(normaliserCodeSecours(` ${c.toUpperCase()} `)).toBe(c);
    expect(normaliserCodeSecours(c.replace("-", ""))).toBe(c);
    expect(normaliserCodeSecours("123456")).toBeNull();
    expect(empreinteCodeSecours(c, cle)).toMatch(/^[0-9a-f]{64}$/);
    expect(empreinteCodeSecours(c, cle)).not.toBe(empreinteCodeSecours(c, Buffer.alloc(32, 4)));
  });
});
