# Construit le modèle de FICHE DE COLLECTE JALONIA (FC-JAL), allégé, que Jalonia propose au téléchargement et sait importer
# (editeur/js/importFiche.js). Le code de la fiche se forme seul : « FC-JAL- » + code de la procédure saisi dans le Cadrage.
#
# Usage (python3 + openpyxl) :
#   python3 scripts/fiche-collecte/construire-fiche.py public/modeles/FC-JAL_Fiche_de_collecte.xlsx
#   python3 scripts/fiche-collecte/construire-fiche.py editeur/tests/fixtures/fiche-collecte-jalonia-exemple.xlsx --exemple
# Sans --exemple : modèle vierge. Avec : pré-rempli (procédure « Gérer les contrats », données fictives), pour les tests.
import sys
EXEMPLE = "--exemple" in sys.argv[2:]
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.formatting.rule import CellIsRule

SARCELLE = "005A70"; PALE = "E6F2F4"; SAISIE = "FFF8E1"; GRIS = "F2F2F2"
fin = Side(style="thin", color="B7C7CC")
bord = Border(left=fin, right=fin, top=fin, bottom=fin)
wb = Workbook()

def titre(ws, texte, sous, largeur):
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=largeur)
    c = ws.cell(1, 1, texte); c.font = Font(bold=True, size=14, color="FFFFFF"); c.fill = PatternFill("solid", fgColor=SARCELLE)
    c.alignment = Alignment(vertical="center"); ws.row_dimensions[1].height = 26
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=largeur)
    c = ws.cell(2, 1, sous); c.font = Font(italic=True, size=9, color="4E5A63"); c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.row_dimensions[2].height = 30

def entete(ws, ligne, titres, largeurs):
    for j, (t, w) in enumerate(zip(titres, largeurs), 1):
        c = ws.cell(ligne, j, t); c.font = Font(bold=True, color="FFFFFF", size=10); c.fill = PatternFill("solid", fgColor=SARCELLE)
        c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center"); c.border = bord
        ws.column_dimensions[c.column_letter].width = w
    ws.row_dimensions[ligne].height = 34
    ws.freeze_panes = ws.cell(ligne + 1, 1)

def lignes(ws, debut, n, ncol, donnees=()):
    for i in range(n):
        for j in range(1, ncol + 1):
            c = ws.cell(debut + i, j); c.border = bord; c.alignment = Alignment(wrap_text=True, vertical="top")
            c.fill = PatternFill("solid", fgColor=GRIS if j == 1 else SAISIE)
        ws.cell(debut + i, 1, i + 1)
    for i, l in enumerate(donnees if EXEMPLE else ()):
        for j, v in enumerate(l, 2):
            if v != "": ws.cell(debut + i, j, v)

def liste(ws, plage, nom):
    dv = DataValidation(type="list", formula1=nom, allow_blank=True, showErrorMessage=False)
    ws.add_data_validation(dv); dv.add(plage)

# ---------- Listes (masqué) ----------
L = wb.active; L.title = "Listes"
LISTES = {
  "ListeType": ["Instruction", "Contrôle", "Décision (Oui / Non)", "Attente / délai", "Tâches simultanées", "Renvoi vers une procédure"],
  "ListeIntExt": ["Interne", "Externe"],
  "ListeStatut": ["Validé", "À confirmer"],
  "ListeNature": ["Enregistrement", "Formulaire vierge", "Document de référence", "Document externe", "Fichier / application"],
  "ListeSupport": ["Papier", "Électronique", "Papier + électronique"],
  "ListeOuiNon": ["Oui", "Non"],
  "ListeCote": [1, 2, 3, 4],
  "ListeStatutPoint": ["Ouvert", "Clos"],
}
for j, (nom, vals) in enumerate(LISTES.items(), 1):
    L.cell(1, j, nom).font = Font(bold=True)
    for i, v in enumerate(vals, 2): L.cell(i, j, v)
    col = L.cell(1, j).column_letter
    wb.defined_names[nom] = DefinedName(nom, attr_text=f"Listes!${col}$2:${col}${len(vals) + 1}")
wb.defined_names["ListeRoles"] = DefinedName("ListeRoles", attr_text="Acteurs!$C$5:$C$24")
L.sheet_state = "hidden"

# ---------- Mode d'emploi ----------
G = wb.create_sheet("Mode d'emploi", 0)
titre(G, "FICHE DE COLLECTE JALONIA — mode d'emploi", "Modèle FC-JAL (allégé) : le code de la fiche est FC-JAL- suivi du code de la procédure. Une fiche = une procédure + ses instructions de travail. Importez-la dans Jalonia : menu Fichier → « Importer une fiche de collecte (Excel) ».", 3)
etapes = [
  ("1", "Cadrage", "Identification de la procédure et 7 questions guides (10 min)."),
  ("2", "Acteurs", "Les rôles par leur FONCTION (jamais le nom des personnes). Ils alimentent la liste « Acteur » du déroulé."),
  ("3", "Déroulé", "Une ligne = une opération (verbe à l'infinitif), un seul acteur qui exécute. Les décisions : question fermée + suite « Oui → 5 ; Non → 3 »."),
  ("4", "IT-modèle", "Dupliquer l'onglet pour chaque instruction de travail à détailler (renommer l'onglet avec le code IT)."),
  ("5", "Documents", "Formulaires, enregistrements et documents de référence, avec les opérations concernées."),
  ("6", "Risques_Indicateurs", "Indicateurs de la procédure et risques cotés (gravité × probabilité, 1 à 4), avec les opérations concernées."),
  ("7", "Points ouverts", "Ce qui reste à clarifier avec les acteurs. Non repris dans le document."),
]
entete(G, 4, ["N°", "Onglet", "À renseigner"], [6, 24, 110])
for i, l in enumerate(etapes, 5):
    for j, v in enumerate(l, 1):
        c = G.cell(i, j, v); c.alignment = Alignment(wrap_text=True, vertical="top"); c.border = bord
G.cell(13, 1, "Cellules jaunes : à renseigner. Listes déroulantes : Type, Acteur, Interne / Externe, Nature, Support, Statut, cotations.").font = Font(italic=True, size=9)
G.freeze_panes = None

# ---------- Cadrage ----------
C = wb.create_sheet("Cadrage")
titre(C, "CADRAGE DE LA PROCÉDURE", "Libellé en colonne B, aide en colonne C, réponse en colonne D.", 4)
entete(C, 4, ["N°", "Libellé", "Aide", "Réponse"], [5, 30, 46, 70])
cad = [
  ("Organisation / Société", "Raison sociale", "Société Exemple"),
  ("Direction / Site", "Service ou site concerné", "Direction Administrative et Juridique (DAJ)"),
  ("Processus de rattachement", "Processus de la cartographie", "JUR - Juridique"),
  ("Pilote du processus", "Fonction et nom du pilote", "Directeur Administratif et Juridique"),
  ("Intitulé de la procédure", "Verbe à l'infinitif + objet", "Gérer les contrats"),
  ("Code envisagé", "Code de la procédure, ex. PR-QUA-05 (il complète le code de la fiche : FC-JAL-PR-QUA-05)", "PR-JUR-03"),
  ("Date et lieu de l'entretien", "JJ/MM/AAAA — lieu", ""),
  ("Personnes interviewées", "Fonctions (et noms si utile)", ""),
  ("Objet (Pourquoi ?)", "À quoi sert la procédure ?", "Maîtriser le circuit d'un contrat, de la demande au renouvellement."),
  ("Domaine d'application", "Activités, sites, clients concernés", "Contrats clients et fournisseurs."),
  ("Exclusions", "Ce qui n'est pas couvert", "Contrats de travail ; baux."),
  ("Événement déclencheur (Début)", "Ce qui lance la procédure", "Sollicitation du DAJ par un service pour un contrat."),
  ("Résultat final (Fin)", "Quand la procédure est terminée", "Contrat signé, diffusé et archivé ; ou renouvellement décidé."),
  ("Exigences applicables", "Légales, réglementaires, contractuelles, normatives", ""),
  ("Définitions et abréviations", "Termes et sigles à expliquer", "Visa du DAJ ; avenant ; renouvellement."),
]
for i, (lib, aide, rep) in enumerate(cad, 5):
    for j, v in enumerate((i - 4, lib, aide, rep if EXEMPLE else None), 1):
        c = C.cell(i, j, v); c.border = bord; c.alignment = Alignment(wrap_text=True, vertical="top")
    C.cell(i, 3).font = Font(italic=True, size=9, color="4E5A63"); C.cell(i, 4).fill = PatternFill("solid", fgColor=SAISIE)

# ---------- Acteurs ----------
A = wb.create_sheet("Acteurs")
titre(A, "ACTEURS (RÔLES)", "Un rôle = une fonction. Le code court sert à remplir le déroulé plus vite.", 5)
entete(A, 4, ["N°", "Code", "Intitulé du rôle (fonction)", "Interne / Externe", "Responsabilités dans la procédure"], [5, 10, 36, 14, 60])
lignes(A, 5, 20, 5, [
  ("DEM", "Service demandeur", "Interne", "Exprime le besoin, fournit les éléments techniques et financiers."),
  ("DAJ", "Direction Administrative et Juridique (DAJ)", "Interne", "Rédige, négocie, vise, archive et suit les contrats."),
  ("DG", "Direction Générale", "Interne", "Signe le contrat après visa du DAJ."),
  ("TIERS", "Client ou fournisseur", "Externe", "Négocie et contresigne le contrat."),
])
liste(A, "D5:D24", "ListeIntExt")

# ---------- Déroulé ----------
D = wb.create_sheet("Déroulé")
titre(D, "DÉROULÉ DE LA PROCÉDURE (NIVEAU 2 : QUI FAIT QUOI ?)", "Une ligne par opération, dans l'ordre. Décision : question fermée en « Question », suite en « Suite » (ex. « Oui → 5 ; Non → 3 », « Non → Fin »).", 16)
cols = ["N°", "Opération (verbe à l'infinitif)", "Type", "Acteur", "Autres acteurs", "Reçoit (entrée)", "De qui", "Produit (sortie)", "Pour qui",
        "Documents / supports", "Outils / moyens", "Délai", "Question (si décision)", "Suite (si décision)", "Code IT (si à détailler)", "Statut"]
entete(D, 4, cols, [5, 30, 16, 26, 22, 22, 18, 24, 18, 22, 18, 12, 26, 18, 14, 12])
lignes(D, 5, 30, 16, [
  ("Recueillir le cahier des charges", "Instruction", "Direction Administrative et Juridique (DAJ)", "Service demandeur", "Demande de contrat", "Service demandeur", "Cahier des charges", "Direction Administrative et Juridique (DAJ)", "Cahier des charges", "Mail, réunion", "", "", "", "", "À confirmer"),
  ("Rédiger le contrat", "Instruction", "Direction Administrative et Juridique (DAJ)", "Service demandeur", "Cahier des charges", "Service demandeur", "Projet de contrat", "Client ou fournisseur", "Projet de contrat", "", "", "", "", "", "À confirmer"),
  ("Négocier le contrat", "Instruction", "Direction Administrative et Juridique (DAJ)", "Service demandeur", "Projet de contrat", "Client ou fournisseur", "Version finale", "Direction Administrative et Juridique (DAJ)", "Version finale", "Mail, réunion", "", "", "", "", "À confirmer"),
  ("Viser le contrat", "Contrôle", "Direction Administrative et Juridique (DAJ)", "", "Version finale", "Direction Administrative et Juridique (DAJ)", "Contrat visé", "Direction Générale", "Contrat visé", "Cachet de visa", "", "Le contrat est-il conforme et prêt à signer ?", "Oui → 5 ; Non → 3", "IT-JUR-03", "À confirmer"),
  ("Signer le contrat", "Instruction", "Direction Générale", "", "Contrat visé", "Direction Administrative et Juridique (DAJ)", "Contrat signé", "Direction Administrative et Juridique (DAJ)", "Contrat signé", "", "", "", "", "", "À confirmer"),
])
liste(D, "C5:C34", "ListeType"); liste(D, "D5:D34", "ListeRoles"); liste(D, "P5:P34", "ListeStatut")

# ---------- IT-modèle ----------
I = wb.create_sheet("IT-modèle")
titre(I, "INSTRUCTION DE TRAVAIL (NIVEAU 3 : COMMENT ?)", "Dupliquer cet onglet pour chaque instruction (clic droit → Déplacer ou copier → Créer une copie), puis le renommer avec le code IT.", 9)
cadit = [("Code IT", "IT-JUR-03"), ("Intitulé de l'instruction", "Viser un contrat avant signature"), ("N° d'opération du déroulé", "4"),
         ("Rôle exécutant (unique)", "Direction Administrative et Juridique (DAJ)"), ("Événement déclencheur", "Version finale du contrat arrêtée."),
         ("Résultat attendu", "Contrat visé, transmis à la DG."), ("Prérequis (compétences, habilitations)", "Compétence juridique."),
         ("EPI et consignes HSE", ""), ("Matériels, outils, applications", "Cachet de visa.")]
for i, (lib, v) in enumerate(cadit, 4):
    a = I.cell(i, 1, lib); a.font = Font(bold=True); a.border = bord
    I.merge_cells(start_row=i, start_column=1, end_row=i, end_column=3)
    c = I.cell(i, 4, v if EXEMPLE else None); c.fill = PatternFill("solid", fgColor=SAISIE); c.border = bord
    I.merge_cells(start_row=i, start_column=4, end_row=i, end_column=9)
liste(I, "D7", "ListeRoles")
colsit = ["N°", "Opération (verbe à l'infinitif)", "Comment ? (mode opératoire)", "Avec quoi ?", "Point clé", "Autocontrôle (que vérifier ?)", "Si anomalie : que faire ?", "Sécurité / environnement", "Enregistrement produit"]
entete(I, 14, colsit, [5, 28, 44, 20, 22, 26, 26, 22, 18])
lignes(I, 15, 15, 9, [
  ("Vérifier la conformité juridique", "Relire le contrat au regard du droit applicable", "Contrat", "Clauses conformes", "Contrat conforme ?", "Retour à la négociation", "", ""),
  ("Apposer le cachet de visa", "Cachet du DAJ sur chaque page", "Cachet de visa", "Cachet sur les pages", "Cachet apposé ?", "Compléter avant signature", "", "Contrat visé"),
])

# ---------- Documents ----------
Dc = wb.create_sheet("Documents")
titre(Dc, "DOCUMENTS ET ENREGISTREMENTS", "Formulaires, enregistrements et documents de référence utilisés ou produits par la procédure.", 9)
entete(Dc, 4, ["N°", "Code", "Intitulé", "Nature", "Support", "Op. concernée(s)", "Lieu de classement", "Durée de conservation", "Modèle collecté ?"], [5, 14, 36, 22, 16, 14, 22, 16, 12])
lignes(Dc, 5, 20, 9, [
  ("FO-JUR-04", "Cahier des charges", "Enregistrement", "Électronique", "1,2", "Dossier du contrat", "", "Oui"),
  ("", "Contrat (original signé)", "Enregistrement", "Papier", "2 à 7", "Chrono du DAJ", "", "Oui"),
])
liste(Dc, "D5:D24", "ListeNature"); liste(Dc, "E5:E24", "ListeSupport"); liste(Dc, "I5:I24", "ListeOuiNon")

# ---------- Risques_Indicateurs ----------
R = wb.create_sheet("Risques_Indicateurs")
titre(R, "INDICATEURS ET RISQUES", "Cotation 1 (faible) à 4 (très élevée) ; criticité = gravité × probabilité : 1-3 acceptable, 4-8 à surveiller, 9-16 critique.", 8)
R.cell(4, 1, "A. INDICATEURS").font = Font(bold=True, color=SARCELLE)
entete(R, 5, ["N°", "Indicateur", "Formule de calcul", "Cible", "Fréquence", "Op. concernée(s)", "", ""], [5, 32, 34, 12, 14, 14, 14, 30])
lignes(R, 6, 5, 6, [("Contrats à renouveler dans les 3 mois", "Nombre de contrats dont l'échéance tombe dans les 3 mois", "", "Mensuelle", "4")])
R.cell(12, 1, "B. RISQUES").font = Font(bold=True, color=SARCELLE)
for j, t in enumerate(["N°", "Risque", "Cause(s)", "Gravité (1-4)", "Probabilité (1-4)", "Criticité", "Op. concernée(s)", "Mesure de maîtrise"], 1):
    c = R.cell(13, j, t); c.font = Font(bold=True, color="FFFFFF", size=10); c.fill = PatternFill("solid", fgColor=SARCELLE); c.alignment = Alignment(wrap_text=True, horizontal="center", vertical="center"); c.border = bord
R.row_dimensions[13].height = 34
lignes(R, 14, 10, 8, [("Contrat signé sans visa du DAJ", "Circuit contourné", 3, 2, "", "4,5", "Règle du cachet de visa")])
for i in range(14, 24):
    R.cell(i, 6, f'=IF(AND(D{i}<>"",E{i}<>""),D{i}*E{i},"")').fill = PatternFill("solid", fgColor=GRIS)
liste(R, "D14:E23", "ListeCote")
R.conditional_formatting.add("F14:F23", CellIsRule(operator="between", formula=["9", "16"], fill=PatternFill("solid", fgColor="F8C9C4")))
R.conditional_formatting.add("F14:F23", CellIsRule(operator="between", formula=["4", "8"], fill=PatternFill("solid", fgColor="FCE7B6")))
R.freeze_panes = None

# ---------- Points ouverts ----------
P = wb.create_sheet("Points ouverts")
titre(P, "POINTS OUVERTS", "Ce qui reste à clarifier avec les acteurs. Repris dans le rapport d'import, pas dans le document.", 5)
entete(P, 4, ["N°", "Point à clarifier", "Op. concernée(s)", "Personne ressource", "Statut"], [5, 60, 14, 24, 12])
lignes(P, 5, 15, 5, [("Ordre des signatures : autre partie avant ou après la DG", "5,6", "DAJ", "Ouvert")])
liste(P, "E5:E19", "ListeStatutPoint")

# Code de la fiche : « FC-JAL- » + code de la procédure (Cadrage, ligne « Code envisagé »), sur chaque onglet.
CODE = '="Fiche "&"FC-JAL-"&IF(Cadrage!$D$10="","XX-XX-XX",Cadrage!$D$10)'
for ws in wb.worksheets:
    if ws.title == "Listes": continue
    c = ws.cell(3, 1, CODE); c.font = Font(bold=True, size=9, color=SARCELLE)

# Impression : A4 paysage (portrait pour le cadrage), ajusté à la largeur, ligne d'en-tête répétée sur chaque page.
TETES = {"Mode d'emploi": "4:4", "Cadrage": "4:4", "Acteurs": "4:4", "Déroulé": "4:4", "IT-modèle": "14:14", "Documents": "4:4", "Risques_Indicateurs": None, "Points ouverts": "4:4"}
for ws in wb.worksheets:
    if ws.title == "Listes": continue
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = "portrait" if ws.title in ("Cadrage", "Mode d'emploi") else "landscape"
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.page_margins.left = ws.page_margins.right = 0.4
    ws.page_margins.top = ws.page_margins.bottom = 0.5
    ws.oddFooter.center.text = "&A — page &P / &N"
    if TETES.get(ws.title): ws.print_title_rows = TETES[ws.title]

wb.move_sheet("Listes", offset=len(wb.sheetnames))
wb.active = 0
wb.save(sys.argv[1])
print("ok", wb.sheetnames)
