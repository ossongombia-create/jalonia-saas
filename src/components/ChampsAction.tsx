// Champs communs d'une action (création et modification) : intitulé, description, origine, responsable, échéance.
import type { Traducteur } from "@/lib/i18n";
import { ORIGINES_ACTION } from "@/lib/qse";

export interface Responsable {
  id: string;
  nom: string;
}

interface Props {
  t: Traducteur;
  responsables: Responsable[];
  valeurs: { titre: string; description: string; origine: string; responsableId: string | null; responsableNom?: string; echeance: string | null };
}

export function ChampsAction({ t, responsables, valeurs }: Props) {
  // Responsable actuel qui n'est plus membre actif : il reste proposé (sinon le formulaire le retirerait en silence).
  const liste = valeurs.responsableId && !responsables.some((r) => r.id === valeurs.responsableId)
    ? [...responsables, { id: valeurs.responsableId, nom: valeurs.responsableNom || valeurs.responsableId }]
    : responsables;
  return (
    <>
      <label className="champ">
        <span>{t("actions.champ.titre")}</span>
        <input type="text" name="titre" defaultValue={valeurs.titre} maxLength={200} required />
      </label>
      <label className="champ">
        <span>{t("actions.champ.description")}</span>
        <textarea name="description" defaultValue={valeurs.description} rows={3} maxLength={4000} />
      </label>
      <div className="grille-champs">
        <label className="champ">
          <span>{t("actions.champ.origine")}</span>
          <select name="origine" defaultValue={valeurs.origine} required>
            {ORIGINES_ACTION.map((o) => <option key={o} value={o}>{t(`actions.origine.${o}`)}</option>)}
          </select>
        </label>
        <label className="champ">
          <span>{t("actions.champ.responsable")}</span>
          <select name="responsableId" defaultValue={valeurs.responsableId ?? ""}>
            <option value="">{t("actions.aucun_responsable")}</option>
            {liste.map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
          </select>
        </label>
        <label className="champ">
          <span>{t("actions.champ.echeance")}</span>
          <input type="date" name="echeance" defaultValue={valeurs.echeance ?? ""} />
        </label>
      </div>
    </>
  );
}
