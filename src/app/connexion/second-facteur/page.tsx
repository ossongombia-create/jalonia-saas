// Deuxième étape de la connexion : le code de l'application d'authentification (ou un code de secours). Un
// superadmin ou un approbateur (décision n° 4 du 19/10/2026) qui n'a pas encore de second facteur l'enrôle ici : il lui
// est obligatoire.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { actionAbandonnerConnexion, actionActiverSecondFacteurConnexion, actionCodeSecondFacteur } from "@/actions/second-facteur";
import { FormulaireAction } from "@/components/FormulaireAction";
import { Logo } from "@/components/Logo";
import { traducteur } from "@/lib/i18n";
import { parametreSuite, suiteValide } from "@/lib/suite";
import { cleSecondFacteur } from "@/server/config";
import { poolApplication } from "@/server/db/pools";
import { preparerEnrolement } from "@/server/auth/second-facteur";
import { qrSvgDataUri } from "@/server/auth/qr";
import { accueilDe, lireConnexionEnAttente, lireContexte, lireLangue } from "@/server/web/contexte";

export async function generateMetadata(): Promise<Metadata> {
  return { title: traducteur(await lireLangue())("mfa.titre"), robots: { index: false, follow: false } };
}

/** Secret base32 lisible : groupes de 4 caractères. */
function enGroupes(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

export default async function PageSecondFacteur({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const suite = suiteValide((await searchParams).suite);
  const ctx = await lireContexte();
  if (ctx) redirect(suite || accueilDe(ctx));
  const attente = await lireConnexionEnAttente();
  if (!attente) redirect(`/connexion${parametreSuite(suite)}`);
  const t = traducteur(attente.utilisateur.langue);
  const cle = cleSecondFacteur();

  let contenu;
  if (attente.mfaActif) {
    contenu = (
      <>
        <h1>{t("mfa.titre")}</h1>
        <p className="discret">{t("mfa.code_texte")}</p>
        <FormulaireAction action={actionCodeSecondFacteur} libelle={t("mfa.valider")} libelleEnCours={t("commun.en_cours")}>
          {suite ? <input type="hidden" name="suite" value={suite} /> : null}
          <label className="champ">
            <span>{t("mfa.code")}</span>
            <input type="text" name="code" required maxLength={20} autoComplete="one-time-code" inputMode="text" autoFocus spellCheck={false} />
            <small>{t("mfa.code_aide")}</small>
          </label>
        </FormulaireAction>
      </>
    );
  } else if (!cle) {
    contenu = (
      <>
        <h1>{t("mfa.titre")}</h1>
        <p className="message message-erreur">{t("mfa.indisponible_superadmin")}</p>
      </>
    );
  } else {
    const enrolement = await preparerEnrolement(poolApplication(), cle, attente.utilisateur);
    contenu = (
      <>
        <h1>{t("mfa.enrolement_titre")}</h1>
        <p>{t("mfa.enrolement_obligatoire")}</p>
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
        <FormulaireAction
          action={actionActiverSecondFacteurConnexion}
          libelle={t("mfa.activer")}
          libelleEnCours={t("commun.en_cours")}
          libellesCodes={{ titre: t("mfa.codes_titre"), aide: t("mfa.codes_aide"), copier: t("commun.copier"), copie: t("commun.copie"), continuer: t("mfa.continuer"), suite: suite || "/" }}
        >
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
        {contenu}
        <form action={actionAbandonnerConnexion} className="pied-carte abandon-connexion">
          <button type="submit" className="bouton bouton-discret">
            {t("mfa.abandonner")}
          </button>
        </form>
      </section>
    </div>
  );
}
