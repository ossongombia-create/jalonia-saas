// Code QR de l'adresse otpauth:// (scanné par l'application d'authentification). Calculé sur le serveur, servi
// comme image SVG (adresse « data: », permise par la CSP) : aucun script, aucune injection dans la page.
import "server-only";
import qrcode from "qrcode-generator";

export function qrSvgDataUri(texte: string): string {
  const qr = qrcode(0, "M");
  qr.addData(texte);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
