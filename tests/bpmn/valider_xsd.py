#!/usr/bin/env python3
"""Valide des fichiers BPMN 2.0 contre le schéma XSD officiel de l'OMG (BPMN 2.0, espace de noms 20100524).

Le schéma (BPMN20.xsd, Semantic.xsd, BPMNDI.xsd, DI.xsd, DC.xsd) n'est pas recopié dans le dépôt : il est pris dans le
paquet SpiffWorkflow 3.2.0 (PyPI), qui le distribue tel quel, téléchargé avec vérification de son empreinte SHA-256.
Contre-épreuve : un fichier volontairement invalide doit être REFUSÉ (sinon le validateur ne prouverait rien).

Usage : python3 tests/bpmn/valider_xsd.py FICHIER_OU_DOSSIER...   (dépendance : lxml)
"""
import pathlib
import subprocess
import sys
import tempfile
import zipfile

from lxml import etree

ICI = pathlib.Path(__file__).resolve().parent
CACHE = ICI / ".xsd"
PAQUET = "spiffworkflow==3.2.0"
EMPREINTE = "fd2c4d3c2674e9e6b15c4db262b1a09f0ca11ce6638f8cceef0997f42aa5cb96"
SCHEMAS = ["BPMN20.xsd", "Semantic.xsd", "BPMNDI.xsd", "DI.xsd", "DC.xsd"]


def obtenir_schema() -> pathlib.Path:
    if all((CACHE / nom).exists() for nom in SCHEMAS):
        return CACHE / "BPMN20.xsd"
    with tempfile.TemporaryDirectory() as tmp:
        exigences = pathlib.Path(tmp) / "exigences.txt"
        exigences.write_text(f"{PAQUET} --hash=sha256:{EMPREINTE}\n", encoding="utf-8")
        subprocess.run(
            [sys.executable, "-m", "pip", "download", "--quiet", "--no-deps", "--require-hashes", "-r", str(exigences), "-d", tmp],
            check=True,
        )
        roue = next(pathlib.Path(tmp).glob("spiffworkflow-3.2.0-*.whl"))
        CACHE.mkdir(exist_ok=True)
        with zipfile.ZipFile(roue) as z:
            for nom in SCHEMAS:
                (CACHE / nom).write_bytes(z.read(f"SpiffWorkflow/bpmn/parser/schema/{nom}"))
    return CACHE / "BPMN20.xsd"


INVALIDE = b"""<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="x">
  <bpmn:process id="p"><bpmn:taache id="t"/><bpmn:task id="t2" inconnu="1"/></bpmn:process>
</bpmn:definitions>"""


def main(chemins: list[str]) -> int:
    schema = etree.XMLSchema(etree.parse(str(obtenir_schema())))
    if schema.validate(etree.fromstring(INVALIDE)):
        print("✘ contre-épreuve : le fichier invalide a été accepté — le validateur ne prouve rien")
        return 1
    fichiers = []
    for c in chemins:
        p = pathlib.Path(c)
        fichiers += sorted(p.glob("*.bpmn")) if p.is_dir() else [p]
    if not fichiers:
        print("✘ aucun fichier à valider")
        return 1
    echecs = 0
    for f in fichiers:
        doc = etree.parse(str(f), etree.XMLParser(resolve_entities=False, no_network=True))
        if schema.validate(doc):
            print(f"✔ {f}")
        else:
            echecs += 1
            print(f"✘ {f}")
            for e in schema.error_log:
                print(f"    ligne {e.line} : {e.message}")
    print(f"{len(fichiers) - echecs}/{len(fichiers)} fichier(s) conformes au schéma BPMN 2.0 (contre-épreuve : fichier invalide refusé)")
    return 1 if echecs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
