// Envoi des courriels (src/server/notifications/courriel.ts) contre un faux serveur SMTP local, avec les réglages
// réels du module : STARTTLS exigé (port ≠ 465), certificat vérifié, authentification, délais. Le certificat du faux
// serveur est créé pour la séance (openssl) et ajouté aux autorités de confiance du processus de test seulement.
// Vérifié : verify(), sendMail(), sujet et texte UTF-8 restitués à l'identique, refus de tout accès fichier ou URL.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import tls from "node:tls";
import nodemailer from "nodemailer";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inject } from "vitest";
import { courrielConfigure, envoyerCourriel, envoyerInvitationCourriel, verifierCourrielSmtp } from "../../src/server/notifications/courriel";

interface Recu { chiffre: boolean; auth: string | null; de: string | null; pour: string[]; donnees: string }

/** Faux serveur SMTP minimal : EHLO, STARTTLS, AUTH PLAIN, MAIL, RCPT, DATA, RSET, NOOP, QUIT. */
function fauxServeurSmtp(cle: Buffer, certificat: Buffer) {
  const recus: Recu[] = [];
  const serveur = net.createServer((socket) => {
    const etat: Recu = { chiffre: false, auth: null, de: null, pour: [], donnees: "" };
    const brancher = (s: net.Socket | tls.TLSSocket) => {
      let tampon = "";
      let enDonnees = false;
      const ecrire = (l: string) => s.write(l + "\r\n");
      s.on("error", () => {});
      s.on("data", (d: Buffer) => {
        tampon += d.toString("latin1");
        let i;
        while ((i = tampon.indexOf("\r\n")) >= 0) {
          const ligne = tampon.slice(0, i);
          tampon = tampon.slice(i + 2);
          if (enDonnees) {
            if (ligne === ".") {
              enDonnees = false;
              recus.push({ ...etat, donnees: Buffer.from(etat.donnees, "latin1").toString("utf8") });
              etat.donnees = "";
              etat.pour = [];
              ecrire("250 2.0.0 recu");
            } else etat.donnees += (ligne.startsWith("..") ? ligne.slice(1) : ligne) + "\n";
            continue;
          }
          const commande = ligne.slice(0, 4).toUpperCase();
          if (commande === "EHLO") ecrire(etat.chiffre ? "250-faux\r\n250 AUTH PLAIN" : "250-faux\r\n250 STARTTLS");
          else if (commande === "STAR") {
            ecrire("220 2.0.0 go");
            s.removeAllListeners("data");
            etat.chiffre = true;
            brancher(new tls.TLSSocket(s as net.Socket, { isServer: true, key: cle, cert: certificat }));
            return;
          } else if (commande === "AUTH") {
            etat.auth = Buffer.from(ligne.split(" ")[2] ?? "", "base64").toString("utf8");
            ecrire("235 2.7.0 ok");
          } else if (commande === "MAIL") { etat.de = ligne; ecrire("250 ok"); }
          else if (commande === "RCPT") { etat.pour.push(ligne); ecrire("250 ok"); }
          else if (commande === "DATA") { enDonnees = true; ecrire("354 go"); }
          else if (commande === "QUIT") { ecrire("221 bye"); s.end(); }
          else ecrire("250 ok");
        }
      });
      if (!etat.chiffre) ecrire("220 faux ESMTP");
    };
    brancher(socket);
  });
  return { serveur, recus };
}

/** Décode un en-tête MIME (mots encodés RFC 2047, Q ou B, éventuellement replié sur plusieurs lignes). */
function decoderEntete(brut: string): string {
  const deplie = brut.replace(/\n[ \t]+/g, " ");
  return deplie
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?UTF-8\?([QB])\?([^?]*)\?=/gi, (_m, codage: string, texte: string) =>
      codage.toUpperCase() === "B"
        ? Buffer.from(texte, "base64").toString("utf8")
        : Buffer.from(texte.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8"));
}

/** En-tête et corps (quoted-printable ou brut) d'un message reçu. */
function lire(message: string) {
  const fin = message.indexOf("\n\n");
  const entetes = message.slice(0, fin);
  const sujet = /^Subject: (.*(?:\n[ \t].*)*)/m.exec(entetes)?.[1] ?? "";
  let corps = message.slice(fin + 2);
  if (/^Content-Transfer-Encoding: quoted-printable/im.test(entetes)) {
    corps = Buffer.from(corps.replace(/=\n/g, "").replace(/=([0-9A-F]{2})/gi, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8");
  }
  return { entetes, sujetBrut: sujet, sujet: decoderEntete(sujet), corps: corps.replace(/\n$/, "") };
}

const SUJET = "Réunion qualité : « revue de procédure » — à valider";
const TEXTE = "Bonjour Élodie,\n\nLa procédure PR-QUA-01 attend votre décision (vérification).\n\n— Jalonia ✔";

describe("courriel SMTP (faux serveur local, STARTTLS)", () => {
  let dossier: string;
  let faux: ReturnType<typeof fauxServeurSmtp>;
  let port: number;
  const envAvant = { ...process.env };
  const autoritesAvant = tls.getCACertificates("default");

  beforeAll(async () => {
    dossier = mkdtempSync(path.join(tmpdir(), "jalonia-smtp-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-keyout", path.join(dossier, "cle.pem"), "-out", path.join(dossier, "cert.pem")], { stdio: "ignore" });
    const cle = readFileSync(path.join(dossier, "cle.pem"));
    const certificat = readFileSync(path.join(dossier, "cert.pem"));
    tls.setDefaultCACertificates([...autoritesAvant, certificat.toString()]);
    faux = fauxServeurSmtp(cle, certificat);
    await new Promise<void>((ok) => faux.serveur.listen(0, "127.0.0.1", ok));
    port = (faux.serveur.address() as net.AddressInfo).port;
    // config() lit l'environnement au premier usage (un processus par fichier de test).
    Object.assign(process.env, {
      DATABASE_URL: inject("urlApplication"),
      AUTH_URL: "https://jalonia.test",
      SMTP_HOTE: "127.0.0.1",
      SMTP_PORT: String(port),
      SMTP_UTILISATEUR: "expediteur@jalonia.test",
      SMTP_MOT_DE_PASSE: "mot-de-passe-smtp",
      SMTP_EXPEDITEUR: "notifications@jalonia.test",
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((ok) => faux.serveur.close(() => ok()));
    tls.setDefaultCACertificates(autoritesAvant);
    process.env = envAvant;
    rmSync(dossier, { recursive: true, force: true });
  });

  it("verify() : connexion, STARTTLS sur certificat vérifié, authentification", async () => {
    expect(courrielConfigure()).toBe(true);
    await expect(verifierCourrielSmtp()).resolves.toBeUndefined();
  });

  it("sendMail() : message remis chiffré, authentifié, expéditeur et destinataire attendus", async () => {
    const avant = faux.recus.length;
    await expect(envoyerCourriel({ a: "destinataire@exemple.test", sujet: SUJET, texte: TEXTE })).resolves.toBe(true);
    expect(faux.recus.length).toBe(avant + 1);
    const recu = faux.recus.at(-1)!;
    expect(recu.chiffre).toBe(true);
    expect(recu.auth).toBe("\0expediteur@jalonia.test\0mot-de-passe-smtp");
    expect(recu.de).toBe("MAIL FROM:<notifications@jalonia.test>");
    expect(recu.pour).toEqual(["RCPT TO:<destinataire@exemple.test>"]);
    expect(lire(recu.donnees).entetes).toMatch(/^From: Jalonia <notifications@jalonia.test>$/m);
  });

  it("sujet et texte UTF-8 : encodés pour le transport, restitués à l'identique", async () => {
    await envoyerCourriel({ a: "destinataire@exemple.test", sujet: SUJET, texte: TEXTE });
    const m = lire(faux.recus.at(-1)!.donnees);
    expect(m.sujetBrut).toMatch(/^=\?UTF-8\?[QB]\?/i); // jamais d'octets bruts hors ASCII dans l'en-tête
    expect(/[^\x20-\x7e\n\t]/.test(m.sujetBrut)).toBe(false);
    expect(m.sujet).toBe(SUJET);
    expect(m.entetes).toMatch(/^Content-Type: text\/plain; charset=utf-8$/im);
    expect(m.corps.replace(/\r/g, "")).toBe(TEXTE);
  });

  it("invitation : lien absolu construit sur AUTH_URL", async () => {
    await envoyerInvitationCourriel({ a: "invite@exemple.test", nom: "Élodie", organisation: "Entreprise Exemple", lien: "/invitation/abc", heures: 72 });
    const m = lire(faux.recus.at(-1)!.donnees);
    expect(m.sujet).toBe("Votre invitation à rejoindre Jalonia");
    expect(m.corps).toContain("Ouvrir l’invitation : https://jalonia.test/invitation/abc");
    expect(m.corps).toContain("expire dans 72 heures");
  });

  it("aucun accès fichier ni URL : options posées, et refus effectif de nodemailer", async () => {
    const espion = vi.spyOn(nodemailer, "createTransport");
    await envoyerCourriel({ a: "destinataire@exemple.test", sujet: "Options", texte: "Options" });
    expect(espion).toHaveBeenCalledTimes(1);
    const options = espion.mock.calls[0]![0] as Record<string, unknown>;
    expect(options).toMatchObject({ disableFileAccess: true, disableUrlAccess: true, requireTLS: true, secure: false });
    espion.mockRestore();
    // Avec ces mêmes options, une pièce jointe lue sur le disque ou à une adresse est refusée avant tout envoi.
    const avant = faux.recus.length;
    const transport = nodemailer.createTransport(options as Parameters<typeof nodemailer.createTransport>[0]);
    try {
      const base = { from: "notifications@jalonia.test", to: "destinataire@exemple.test", subject: "Pièce jointe", text: "x" };
      await expect(transport.sendMail({ ...base, attachments: [{ path: path.join(dossier, "cle.pem") }] })).rejects.toThrow();
      await expect(transport.sendMail({ ...base, attachments: [{ path: "https://pirate.example/x" }] })).rejects.toThrow();
      await expect(transport.sendMail({ ...base, html: { path: "/etc/hostname" } })).rejects.toThrow();
    } finally {
      transport.close();
    }
    expect(faux.recus.length).toBe(avant);
  });
});
