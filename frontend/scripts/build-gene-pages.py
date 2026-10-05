#!/usr/bin/env python3
"""Rebuild src/lib/gene-pages.json: the genes that have their own page on
Orphanet and on MedlinePlus Genetics.

Both sites answer a gene they do not know with an error page (Orphanet with a
500), so a link is offered only for a gene on these lists.

    python3 frontend/scripts/build-gene-pages.py
"""

import json
import pathlib
import urllib.request
import xml.etree.ElementTree as ET

ORPHANET = "https://www.orphadata.com/data/xml/en_product6.xml"
MEDLINEPLUS = "https://medlineplus.gov/download/ghr-summaries.xml"
OUT = pathlib.Path(__file__).resolve().parent.parent / "src" / "lib" / "gene-pages.json"


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "diagnostic.ar"})
    with urllib.request.urlopen(request, timeout=300) as response:
        return response.read()


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def orphanet_symbols(xml: bytes) -> tuple[set[str], str]:
    root = ET.fromstring(xml)
    symbols = {
        el.findtext("Symbol").strip().upper()
        for el in root.iter("Gene")
        if (el.findtext("Symbol") or "").strip()
    }
    return symbols, root.get("date", "")


def medlineplus_symbols(xml: bytes) -> set[str]:
    symbols = set()
    for el in ET.fromstring(xml).iter():
        if local(el.tag) != "gene-summary":
            continue
        for child in el:
            if local(child.tag) == "gene-symbol" and (child.text or "").strip():
                symbols.add(child.text.strip().upper())
    return symbols


def main() -> None:
    orphanet, orphanet_date = orphanet_symbols(fetch(ORPHANET))
    medlineplus = medlineplus_symbols(fetch(MEDLINEPLUS))
    OUT.write_text(
        json.dumps(
            {
                "sources": {
                    "orphanet": f"{ORPHANET} ({orphanet_date}, CC BY 4.0)",
                    "medlineplus": MEDLINEPLUS,
                },
                "orphanet": sorted(orphanet),
                "medlineplus": sorted(medlineplus),
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        + "\n"
    )
    print(f"{OUT}: orphanet {len(orphanet)}, medlineplus {len(medlineplus)}")


if __name__ == "__main__":
    main()
