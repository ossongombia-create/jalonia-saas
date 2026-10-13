// Historique d'un document (audit D1) : versions conservées, comparaison de deux versions champ par champ, restauration
// d'une version (qui crée une NOUVELLE version : rien n'est effacé). Lecture : tous les rôles de l'organisation.
// Restauration : droit de rédaction.
import Link from "next/link";
import { notFound } from "next/navigation";
import { actionRestaurerVersion } from "@/actions/documents";
import { FormulaireAction } from "@/components/FormulaireAction";
import { comparer, type Difference, type Pas } from "@/lib/comparaison";
import { formaterDate } from "@/lib/format";
import { estCle, type Traducteur } from "@/lib/i18n";
import { aLeDroit } from "@/lib/rbac";
import { identifiant } from "@/lib/validation";
import { poolApplication } from "@/server/db/pools";
import { lireDocument } from "@/server/documents/service";
import { PERIODE_COPIES_MINUTES } from "@/server/documents/copies";
import { lireVersion, listerVersions } from "@/server/documents/versions";
import { exigerOrganisation } from "@/server/web/contexte";
import { titrePage } from "@/server/web/metadonnees";

export const generateMetadata = titrePage("versions.titre");

const MAX_TEXTE = 240;

function libelleChamp(t: Traducteur, cle: string): string {
  const k = `versions.champ.${cle}`;
  return estCle(k) ? t(k) : cle;
}

/** Nom lisible d'un élément de liste (instruction, rôle, alternative, risque…). */
function nomElement(e: Record<string, unknown>): string {
  for (const k of ["libelle", "nom", "condition", "risque", "opportunite", "question", "texte", "version"]) {
    const v = e[k];
    if (typeof v === "string" && v.trim()) return v.trim().length > 60 ? `${v.trim().slice(0, 60)}…` : v.trim();
  }
  return "";
}

function libelleChemin(t: Traducteur, chemin: Pas[]): string {
  return chemin.map((pas, i) => {
    if ("cle" in pas) return libelleChamp(t, pas.cle);
    const parent = chemin[i - 1];
    const rang = t(parent && "cle" in parent && parent.cle === "etapes" ? "versions.instruction" : "versions.element", { n: pas.position + 1 });
    const nom = "element" in pas ? nomElement(pas.element) : "";
    return nom ? `${rang} « ${nom} »` : rang;
  }).join(" › ") || "—";
}

function valeur(t: Traducteur, v: unknown): string {
  if (v === undefined || v === null || v === "") return t("versions.vide");
  if (typeof v === "boolean") return t(v ? "versions.oui" : "versions.non");
  if (typeof v === "string") {
    if (v.startsWith("data:image/")) return t("versions.image");
    return v.length > MAX_TEXTE ? `${v.slice(0, MAX_TEXTE)}…` : v;
  }
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && !Array.isArray(v)) {
    const nom = nomElement(v as Record<string, unknown>);
    if (nom) return nom;
  }
  const json = JSON.stringify(v);
  return json.length > MAX_TEXTE ? `${json.slice(0, MAX_TEXTE)}…` : json;
}

function lireEntier(v: string | string[] | undefined): number | null {
  return typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : null;
}

export default async function PageHistorique({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await exigerOrganisation("documents.lire");
  const { t, organisation, langue, fuseau } = ctx;
  const lu = identifiant.safeParse((await params).id);
  if (!lu.success) notFound();
  const pool = poolApplication();
  const historique = await listerVersions(pool, organisation, lu.data);
  if (!historique) notFound();
  const { document, versions } = historique;
  // Restaurer : un brouillon seulement (une version soumise ou publiée est figée : circuit.ts).
  const peutRestaurer = aLeDroit(organisation.roles, "documents.rediger") && !document.supprimeLe && document.etat === "brouillon";
  const actuelleCopiee = versions.some((v) => v.version === document.version);

  // Comparaison demandée (?a=…&b=…). La version actuelle se lit dans le document même si elle n'est pas encore copiée.
  const q = await searchParams;
  const a = lireEntier(q.a);
  const b = lireEntier(q.b);
  const contenuDe = async (v: number) => {
    if (versions.some((x) => x.version === v)) return (await lireVersion(pool, organisation, document.id, v))?.contenu;
    if (v === document.version && !document.supprimeLe) return (await lireDocument(pool, organisation, document.id))?.contenu;
    return undefined;
  };
  let comparaison: { differences: Difference[]; tronque: boolean } | null = null;
  if (a !== null && b !== null) {
    const [ca, cb] = await Promise.all([contenuDe(a), contenuDe(b)]);
    if (ca && cb) comparaison = comparer(ca, cb);
  }
  const options = [
    ...(actuelleCopiee || document.supprimeLe ? [] : [{ v: document.version, libelle: t("versions.option_actuelle", { v: document.version }) }]),
    ...versions.map((v) => ({
      v: v.version,
      libelle: v.version === document.version ? t("versions.option_actuelle", { v: v.version }) : t("versions.option", { v: v.version, date: formaterDate(langue, v.enregistreLe, fuseau), auteur: v.auteurNom || "—" }),
    })),
  ];
  const nom = document.reference && document.titre ? `${document.reference} — ${document.titre}` : document.reference || document.titre || t("docs.sans_titre");

  return (
    <>
      <header className="entete">
        <div>
          <p><Link href="/app/documents">{t("versions.retour")}</Link></p>
          <h1>{t("versions.titre")}</h1>
          <p>{t("versions.texte", { titre: nom, minutes: PERIODE_COPIES_MINUTES })}</p>
        </div>
      </header>

      {document.supprimeLe ? <p className="bandeau bandeau-alerte">{t("versions.supprime")}</p> : null}

      <section className="carte">
        <h2>{nom}</h2>
        {!actuelleCopiee && !document.supprimeLe ? <p className="discret">{t("versions.actuelle_non_copiee", { v: document.version })}</p> : null}
        {versions.length === 0 ? (
          <p className="vide">{t("versions.aucune")}</p>
        ) : (
          <div className="tableau-defilant">
            <table className="tableau" id="versions">
              <thead>
                <tr>
                  <th>{t("versions.version")}</th>
                  <th>{t("versions.date")}</th>
                  <th>{t("versions.auteur")}</th>
                  <th>{t("versions.motif")}</th>
                  <th>{t("commun.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.version} data-version={v.version}>
                    <td className="nowrap">
                      v{v.version}
                      {v.version === document.version ? <> <span className="etiquette etiquette-ok">{t("versions.actuelle")}</span></> : null}
                      {v.version === document.versionPubliee ? <> <span className="etiquette etiquette-etat-publie">{t("versions.publiee")}</span></> : null}
                    </td>
                    <td className="nowrap">{formaterDate(langue, v.enregistreLe, fuseau)}</td>
                    <td>{v.auteurNom || "—"}</td>
                    <td>{t(`versions.motif.${v.motif}`)}</td>
                    <td>
                      <div className="actions-ligne">
                        {v.version !== document.version && !document.supprimeLe ? (
                          <Link className="bouton bouton-second" href={`?a=${v.version}&b=${document.version}#comparaison`}>
                            {t("versions.comparer_actuelle")}
                          </Link>
                        ) : null}
                        {peutRestaurer && v.version < document.version ? (
                          <FormulaireAction
                            action={actionRestaurerVersion}
                            libelle={t("versions.restaurer")}
                            libelleEnCours={t("commun.en_cours")}
                            variante="ligne"
                            vider={false}
                            confirmation={t("versions.confirmer_restauration", { v: v.version })}
                          >
                            <input type="hidden" name="organisationId" value={organisation.id} />
                            <input type="hidden" name="documentId" value={document.id} />
                            <input type="hidden" name="version" value={v.version} />
                            <input type="hidden" name="versionActuelle" value={document.version} />
                          </FormulaireAction>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {options.length > 1 ? (
        <section className="carte" id="comparaison">
          <h2>{t("versions.comparer")}</h2>
          <form method="get" className="formulaire-comparaison" action="#comparaison">
            <label className="champ">
              {t("versions.choisir_a")}
              <select name="a" defaultValue={a ?? options[1]?.v}>
                {options.map((o) => <option key={o.v} value={o.v}>{o.libelle}</option>)}
              </select>
            </label>
            <label className="champ">
              {t("versions.choisir_b")}
              <select name="b" defaultValue={b ?? options[0]?.v}>
                {options.map((o) => <option key={o.v} value={o.v}>{o.libelle}</option>)}
              </select>
            </label>
            <button type="submit" className="bouton bouton-second">{t("versions.comparer")}</button>
          </form>
          {comparaison && a !== null && b !== null ? (
            <>
              <h3>{t("versions.comparaison", { a, b })}</h3>
              {comparaison.differences.length === 0 ? (
                <p className="vide">{t("versions.aucune_difference")}</p>
              ) : (
                <div className="tableau-defilant">
                  {comparaison.tronque ? <p className="bandeau bandeau-info">{t("versions.tronque", { n: comparaison.differences.length })}</p> : null}
                  <table className="tableau" id="differences">
                    <thead>
                      <tr>
                        <th>{t("versions.champ")}</th>
                        <th>{t("versions.changement")}</th>
                        <th>{t("versions.avant")}</th>
                        <th>{t("versions.apres")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparaison.differences.map((d, i) => (
                        <tr key={i}>
                          <td>{libelleChemin(t, d.chemin)}</td>
                          <td className="nowrap">{t(`versions.nature.${d.nature}`)}</td>
                          <td className="texte-long">{d.nature === "ordre" ? "" : valeur(t, d.avant)}</td>
                          <td className="texte-long">{d.nature === "ordre" ? "" : valeur(t, d.apres)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
