// Envoi SMTP partagé : configuration absente = notifications internes seulement.
import nodemailer from "nodemailer";
import { config } from "../config";

export function courrielConfigure(): boolean {
  return !!config().SMTP_HOTE;
}

export async function verifierCourrielSmtp(): Promise<void> {
  const c = config();
  if (!c.SMTP_HOTE || !c.SMTP_UTILISATEUR || !c.SMTP_MOT_DE_PASSE || !c.SMTP_EXPEDITEUR) {
    throw new Error("Configuration SMTP incomplète.");
  }
  const transport = nodemailer.createTransport({
    host: c.SMTP_HOTE,
    port: c.SMTP_PORT,
    secure: c.SMTP_PORT === 465,
    requireTLS: c.SMTP_PORT !== 465,
    auth: { user: c.SMTP_UTILISATEUR, pass: c.SMTP_MOT_DE_PASSE },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

export async function envoyerCourriel(message: { a: string; sujet: string; texte: string }): Promise<boolean> {
  const c = config();
  if (!c.SMTP_HOTE || !c.SMTP_UTILISATEUR || !c.SMTP_MOT_DE_PASSE || !c.SMTP_EXPEDITEUR) return false;
  const transport = nodemailer.createTransport({
    host: c.SMTP_HOTE,
    port: c.SMTP_PORT,
    secure: c.SMTP_PORT === 465,
    requireTLS: c.SMTP_PORT !== 465,
    auth: { user: c.SMTP_UTILISATEUR, pass: c.SMTP_MOT_DE_PASSE },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    await transport.sendMail({
      from: { name: "Jalonia", address: c.SMTP_EXPEDITEUR },
      to: message.a,
      subject: message.sujet,
      text: message.texte,
    });
  } finally {
    transport.close();
  }
  return true;
}

export async function envoyerInvitationCourriel(entree: { a: string; nom: string; organisation: string; lien: string; heures: number }): Promise<void> {
  if (!courrielConfigure()) return;
  const origine = process.env.AUTH_URL;
  if (!origine) throw new Error("AUTH_URL absente");
  const lien = new URL(entree.lien, origine).toString();
  await envoyerCourriel({
    a: entree.a,
    sujet: "Votre invitation à rejoindre Jalonia",
    texte: `Bonjour ${entree.nom},\n\nVous êtes invité(e) à rejoindre « ${entree.organisation} » sur Jalonia.\n\nOuvrir l’invitation : ${lien}\n\nCe lien est personnel, à usage unique et expire dans ${entree.heures} heures. Si vous ne vous attendiez pas à cette invitation, ignorez ce message.`,
  });
}

