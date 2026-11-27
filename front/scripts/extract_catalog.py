"""Generate the bundled MSC 2026 catalog from the unmodified local references."""
import argparse
import hashlib
import json
import re
from pathlib import Path

from openpyxl import load_workbook
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
MSC = ROOT.parent / "references" / "msc"
FILES = {
    "I": ("2026/2026_Anexo_I_Portaria_STN_642_Regras_Gerais_MSC.pdf", "2026", "p. 5–13"),
    "II": (
        "2026/2026_Anexo_II_Portaria_STN_642_Leiaute_MSC_08072026.xlsx",
        "2026-07-08",
        "Leiaute MSC!A3:P6123; PcaspEstendido2026!H/L/M/O/P; Conjunto de IC!A4:F12; "
        "Informações Complementares!B6:F14; PO!A6:B97; FR 2026!A7:B9 e A12:B121; CO 2026!A7:A68; Observações!A3:A10",
    ),
    "V": ("2026/2026_Regras_de_Validacao_MSC_24112025.pdf", "2025-11-24", "p. 2–7"),
    "T": ("2026/2026_Template_MSC_15012026.csv", "2026-01-15", "linhas 1–2 e registros"),
    "S": (
        "shared/codigos-instituicoes/Cod_instituicoes_siconfi_28_08_2025.pdf",
        "2025-08-28",
        "todas as páginas, colunas IBGE, Código Siconfi e Instituição",
    ),
}
OUTPUT = ROOT / "src" / "catalog-2026.json"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def cell(value):
    return "" if value is None else str(value).strip()


def unique(target, key, value, location):
    require(key and key not in target, f"{location}: chave vazia ou duplicada {key!r}")
    target[key] = value


def extract_institutions(source):
    municipalities, other_executives, ineligible = {}, {}, {}
    seen, pages = {}, []
    row = re.compile(r"([0-9]+)\s{2,}([0-9]+[A-Z0-9]+)\s{2,}(.+)")
    for page_number, page in enumerate(PdfReader(source).pages, 1):
        counts = dict(municipal=0, otherExecutive=0, ineligible=0)
        for line in page.extract_text(extraction_mode="layout").splitlines():
            line = line.strip()
            if not line or (page_number == 1 and re.fullmatch(r"Código IBGE\s+Código Siconfi\s+Instituição", line)):
                continue
            match = row.fullmatch(line)
            require(match, f"S p. {page_number}: linha ambígua {line!r}")
            ibge, code, name = match.groups()
            require(re.fullmatch(re.escape(ibge) + r"[A-Z][A-Z0-9]*", code), f"S p. {page_number}: {code} sem prefixo IBGE coerente")
            unique(seen, code, page_number, f"S p. {page_number}")
            name = " ".join(name.split())
            if code.endswith("EX"):
                if len(ibge) == 7 and name.startswith("Prefeitura Municipal ") and re.search(r" - [A-Z]{2}$", name):
                    municipalities[code] = name
                    counts["municipal"] += 1
                elif len(ibge) <= 2 and name.startswith(("Governo Federal", "Governo do Estado ", "Governo do Distrito Federal")):
                    other_executives[code] = name
                    counts["otherExecutive"] += 1
                else:
                    raise ValueError(f"S p. {page_number}: Executivo ambíguo {code} {name}")
            else:
                ineligible[code] = name
                counts["ineligible"] += 1
        require(sum(counts.values()) > 0, f"S p. {page_number}: página sem registros")
        pages.append(dict(page=page_number, **counts))
    return dict(municipal=municipalities, otherExecutive=other_executives, ineligible=ineligible), pages


def extract_workbook(source):
    workbook = load_workbook(source, read_only=True, data_only=True)
    layout = workbook["Leiaute MSC"]
    header = list(next(layout.iter_rows(min_row=4, max_row=4, max_col=16, values_only=True)))
    require(len(header) == 16 and all(header), "II: guia incompleta")
    types, domains, combinations = {}, {}, {}
    for _, kind, _, digits, pattern, descriptions, *_ in workbook["Informações Complementares"].iter_rows(min_row=6, max_row=14, values_only=True):
        width = int(cell(digits).split()[0])
        require(pattern == "X" * width, f"II: largura incoerente para {kind}")
        unique(types, kind, width, "II Informações Complementares")
        if kind in ("FP", "DC"):
            domains[kind] = [re.match(r"([0-9]+)\s+[-–]", text.strip())[1] for text in descriptions.splitlines()]
    domains["PO"] = []
    for code, description in workbook["PO"].iter_rows(min_row=6, max_row=97, max_col=2, values_only=True):
        require(description and code is not None, "II: linha PO sem código ou descrição")
        domains["PO"].append(cell(code))
    funding = workbook["FR 2026"]
    prefixes = [cell(row[0]) for row in funding.iter_rows(min_row=7, max_row=9, max_col=1, values_only=True)]
    require(prefixes == ["1", "2", "9"], "II FR 2026: prefixos divergentes")
    suffixes = [
        cell(code) for code, description in funding.iter_rows(min_row=15, max_row=121, max_col=2, values_only=True)
        if description and re.fullmatch(r"[5-9][0-9]{2}", cell(code))
    ]
    require(len(suffixes) == len(set(suffixes)) == 98, "II FR 2026: domínio subnacional divergente")
    domains["FR"] = [prefix + suffix for prefix in prefixes for suffix in suffixes]
    domains["CO"] = [
        cell(code) for (code,) in workbook["CO 2026"].iter_rows(min_row=7, max_row=68, max_col=1, values_only=True)
        if re.fullmatch(r"[0-9]{4}", cell(code))
    ]
    require(len(domains["CO"]) == 52, "II CO 2026: domínio divergente")
    for kind, domain in domains.items():
        require(domain and len(domain) == len(set(domain)), f"II: domínio {kind} vazio ou duplicado")
        require(all(re.fullmatch(r"[0-9]{" + str(types[kind]) + "}", code) for code in domain), f"II: domínio {kind} com largura incorreta")
    for key, _, _, _, label, count in workbook["Conjunto de IC"].iter_rows(min_row=4, max_row=12, values_only=True):
        kinds = [kind.strip() for kind in label.split("-")]
        require(len(kinds) == len(set(kinds)) == count and set(kinds) <= types.keys(), f"II: conjunto {key} inválido")
        unique(combinations, cell(key), kinds, "II Conjunto de IC")
    all_pcasp, eligible_pcasp = {}, {}
    for row in workbook["PcaspEstendido2026"].iter_rows(min_row=5, values_only=True):
        code, status, level, combination, label = map(cell, (row[7], row[11], row[12], row[14], row[15]))
        require(re.fullmatch(r"[0-9]{9}", code), f"II PCASP: conta inválida {code}")
        unique(all_pcasp, code, True, "II PCASP")
        if status == "Ativa" and level == "Último":
            require(combination in combinations, f"II PCASP: conjunto órfão para {code}")
            require([kind.strip() for kind in label.split("-")] == combinations[combination], f"II PCASP: conjunto divergente para {code}")
            eligible_pcasp[code] = combination
    accounts = {}
    for row in layout.iter_rows(min_row=5, max_row=6123, values_only=True):
        code = cell(row[0])
        require(code in eligible_pcasp, f"II Leiaute MSC: conta inelegível {code}")
        kinds = []
        for digits, kind in zip(row[1:12:2], row[2:13:2]):
            kind = cell(kind)
            digits = cell(digits)
            if kind or digits:
                require(kind in types and digits.split(maxsplit=1)[:1] == [str(types[kind])],
                        f"II Leiaute MSC: largura divergente para {code}/{kind}")
                kinds.append(kind)
        combination = eligible_pcasp[code]
        require(kinds == combinations[combination], f"II Leiaute MSC: conjunto divergente para {code}")
        unique(accounts, code, combination, "II Leiaute MSC")
    require(len(accounts) == 6119 and accounts == eligible_pcasp, "II: contas elegíveis divergentes entre leiaute e PCASP")
    notes = workbook["Observações"]
    value_types = [re.search(r"'([^']+)'", notes[f"A{row}"].value)[1] for row in range(7, 10)]
    natures = re.findall(r"'([DC])'", notes["A10"].value)
    workbook.close()
    return dict(header=header, widths=types, domains=domains, combinations=combinations, accounts=accounts,
                valueTypes=value_types, natures=natures), len(eligible_pcasp)


def build():
    sources = {}
    for key, (path, edition, region) in FILES.items():
        sources[key] = dict(path=f"references/msc/{path}", edition=edition, region=region,
                            sha256=hashlib.sha256((MSC / path).read_bytes()).hexdigest())
    catalog, pcasp_count = extract_workbook(MSC / FILES["II"][0])
    institutions, pages = extract_institutions(MSC / FILES["S"][0])
    template = (MSC / FILES["T"][0]).read_bytes().decode("cp1252").splitlines()
    require(len(template) == 6121 and template[1].split(";") == catalog["header"]
            and all(len(line.split(";")) == 16 for line in template),
            "T: estrutura não coincide com o leiaute")
    payload = dict(year=2026, rulesVersion="ARQ-MVP-001-ACEITE+E02+C09+C10", sources=sources, **catalog, institutions=institutions,
                   extraction=dict(institutionPages=pages, eligiblePcasp=pcasp_count, institutionAmbiguities=[]))
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return dict(version=f"2026-{hashlib.sha256(encoded).hexdigest()}", **payload)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="compare the generated bytes with the bundled catalog")
    args = parser.parse_args()
    catalog = build()
    result = json.dumps(catalog, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
    if args.check:
        require(OUTPUT.read_bytes() == result, "Catálogo distribuído difere da extração")
    else:
        OUTPUT.write_bytes(result)
    print(catalog["version"], len(catalog["accounts"]), catalog["extraction"]["eligiblePcasp"],
          {group: len(entries) for group, entries in catalog["institutions"].items()},
          len(catalog["extraction"]["institutionPages"]), len(catalog["domains"]["PO"]))
