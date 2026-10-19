// « Mon second facteur » : activer (application d'authentification + codes de secours), obtenir de nouveaux codes
// de secours, désactiver (sauf pour un superadmin : il lui est obligatoire).
import type { Metadata } from "next";
import { actionContinuer } from "@/actions/compte";
import { actionActiverSecondFacteur, actionDesactiverSecondFacteur, actionRegenererCodesSecours } from "@/actions/second-facteur";
import { FormulaireAction } from "@/components/FormulaireAction";
import { Logo } from "@/components/Logo";
import { traducteur } from "@/lib/i18n";
import { cleSecondFacteur } from "@/server/config";
import { poolApplication } from "@/server/db/pools";
import { lireEtatSecondFacteur, preparerEnrolement } from "@/server/auth/second-facteur";
import { qrSvgDataUri } from "@/server/auth/qr";
import { exigerContexte, lireLangue } from "@/server/web/contexte";

export async function generateMetadata(): Promise<Metadata> {
  return { title: traducteur(await lireLangue())("mfa.compte_titre") };
}

function enGroupes(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

export default async function PageMonSecondFacteur() {
  const ctx = await exigerContexte();
  const { t } = ctx;
  const etat = await lireEtatSecondFacteur(poolApplication(), ctx.utilisateur.id);
  const cle = cleSecondFacteur();
  const libellesCodes = { titre: t("mfa.codes_titre"), aide: t("mfa.codes_aide"), copier: t("commun.copier"), copie: t("commun.copie"), continuer: t("mfa.continuer"), suite: "/compte/second-facteur" };
  const champCode = (
    <label className="champ">
      <span>{t("mfa.code_ou_secours")}</span>
      <input type="text" name="code" required maxLength={20} autoComplete="one-time-code" spellCheck={false} />
    </label>
  );

  let contenu;
  if (etat.actif) {
    contenu = (
      <>
        <p className="message message-ok">{t("mfa.etat_actif", { n: etat.codesRestants })}</p>
        <h2>{t("mfa.regenerer_titre")}</h2>
        <p className="discret">{t("mfa.regenerer_aide")}</p>
        <FormulaireAction action={actionRegenererCodesSecours} libelle={t("mfa.regenerer")} libelleEnCours={t("commun.en_cours")} libellesCodes={libellesCodes}>
          {champCode}
        </FormulaireAction>
        {etat.obligatoire ? (
          <p className="discret">{t(ctx.utilisateur.estSuperadmin ? "mfa.obligatoire_superadmin" : "mfa.obligatoire_approbateur")}</p>
        ) : (
          <>
            <h2>{t("mfa.desactiver_titre")}</h2>
            <p className="discret">{t("mfa.desactiver_aide")}</p>
            <FormulaireAction action={actionDesactiverSecondFacteur} libelle={t("mfa.desactiver")} libelleEnCours={t("commun.en_cours")} variante="danger">
              {champCode}
            </FormulaireAction>
          </>
        )}
      </>
    );
  } else if (!cle) {
    contenu = <p className="message message-erreur">{t("mfa.indisponible")}</p>;
  } else {
    const enrolement = await preparerEnrolement(poolApplication(), cle, ctx.utilisateur);
    contenu = (
      <>
        <p>{t("mfa.presentation")}</p>
        <ol className="etapes-mfa">
          <li>{t("mfa.etape_application")}</li>
          <li>
            {t("mfa.etape_scanner")}
            {/* eslint-disable-next-line @next/next/no-img-element -- image SVG calculée sur le serveur (adresse data:) */}
            <img className="qr-totp" src={qrSvgDataUri(enrolement.adresse)} alt={t("mfa.qr_alt")} width={200} height={200} />
            <span className="discret petit">{t("mfa.secret_manuel")}</span>
            <br />
            <code className="secret-totp" data-secret={enrolement.secret}>
              {enGroupes(enrolement.secret)}
            </code>
          </li>
          <li>{t("mfa.etape_code")}</li>
        </ol>
        <FormulaireAction action={actionActiverSecondFacteur} libelle={t("mfa.activer")} libelleEnCours={t("commun.en_cours")} libellesCodes={libellesCodes}>
          <label className="champ">
            <span>{t("mfa.code")}</span>
            <input type="text" name="code" required maxLength={6} pattern="[0-9]{6}" autoComplete="one-time-code" inputMode="numeric" spellCheck={false} />
          </label>
        </FormulaireAction>
      </>
    );
  }

  return (
    <div className="page-simple">
      <section className="carte">
        <Logo variante="couleur" largeur={300} className="logo-carte" prioritaire />
        <h1>{t("mfa.compte_titre")}</h1>
        {contenu}
        <form action={actionContinuer} className="pied-carte">
          <button type="submit" className="bouton bouton-second">
            {t("mdp.continuer")} →
          </button>
        </form>
      </section>
    </div>
  );
}
