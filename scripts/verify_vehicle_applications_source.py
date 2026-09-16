"""Verify the authoritative vehicle-application workbook against the SQL payload.

The workbook SHA-256 proves which source file was read. Separately, the payload
SHA-256 protects the canonical JSON embedded in the migration. This script uses
only Python's standard library so the gate does not depend on an XLSX package.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import re
import sys
import unicodedata
import zipfile
from pathlib import Path
from xml.etree import ElementTree


EXPECTED_SOURCE_SHA256 = (
    "EADCF389E83231636A37EC7488345C1552BC4672FF7194F1E5C9A4D6A020D893"
)
EXPECTED_PAYLOAD_SHA256 = (
    "6e3463c893ce53959ad22ebf9facd309ea8c27f9ac645977e38de02922e7b1eb"
)
PENDING_CODES = {"7B", "7C", "7G", "7I", "7J", "7K", "7L", "7M", "7O"}
BRANDS = [
    ("mercedes-benz", "Mercedes-Benz", "MERCEDES-BENZ"),
    ("ford", "Ford", "FORD"),
    ("volkswagen", "Volkswagen", "VOLKSWAGEN"),
    ("scania", "Scania", "SCANIA"),
    ("volvo", "Volvo", "VOLVO"),
    ("agrale", "Agrale", "AGRALE"),
    ("metalfor", "Metalfor", "METALFOR"),
    ("gmc", "GMC", "GMC"),
]

MAIN_NAMESPACE = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
DOCUMENT_REL_NAMESPACE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
)
PACKAGE_REL_NAMESPACE = (
    "http://schemas.openxmlformats.org/package/2006/relationships"
)


def tag(namespace: str, name: str) -> str:
    return f"{{{namespace}}}{name}"


def clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def normalized_heading(value: str | None) -> str:
    if not value:
        return ""
    return (
        unicodedata.normalize("NFD", value)
        .encode("ascii", "ignore")
        .decode("ascii")
        .strip()
        .upper()
    )


def column_index(reference: str) -> int:
    letters = re.match(r"[A-Z]+", reference)
    if not letters:
        raise ValueError(f"Invalid XLSX cell reference: {reference}")
    result = 0
    for character in letters.group(0):
        result = result * 26 + ord(character) - ord("A") + 1
    return result


def read_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return [
        "".join(node.text or "" for node in item.iter(tag(MAIN_NAMESPACE, "t")))
        for item in root.findall(tag(MAIN_NAMESPACE, "si"))
    ]


def workbook_sheet_paths(archive: zipfile.ZipFile) -> dict[str, str]:
    workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
    relationships = ElementTree.fromstring(
        archive.read("xl/_rels/workbook.xml.rels")
    )
    targets = {
        relationship.attrib["Id"]: relationship.attrib["Target"]
        for relationship in relationships.findall(
            tag(PACKAGE_REL_NAMESPACE, "Relationship")
        )
    }
    paths: dict[str, str] = {}
    sheets = workbook.find(tag(MAIN_NAMESPACE, "sheets"))
    if sheets is None:
        raise RuntimeError("The XLSX workbook has no sheets collection.")
    for sheet in sheets:
        relationship_id = sheet.attrib[tag(DOCUMENT_REL_NAMESPACE, "id")]
        target = targets[relationship_id]
        paths[sheet.attrib["name"]] = (
            target.lstrip("/")
            if target.startswith("/")
            else posixpath.normpath(posixpath.join("xl", target))
        )
    return paths


def read_sheet_rows(
    archive: zipfile.ZipFile,
    path: str,
    shared_strings: list[str],
) -> dict[int, dict[int, str]]:
    root = ElementTree.fromstring(archive.read(path))
    rows: dict[int, dict[int, str]] = {}
    for row in root.iter(tag(MAIN_NAMESPACE, "row")):
        row_number = int(row.attrib["r"])
        values: dict[int, str] = {}
        for cell in row.findall(tag(MAIN_NAMESPACE, "c")):
            reference = cell.attrib["r"]
            cell_type = cell.attrib.get("t")
            if cell_type == "inlineStr":
                value = "".join(
                    node.text or ""
                    for node in cell.iter(tag(MAIN_NAMESPACE, "t"))
                )
            else:
                value_node = cell.find(tag(MAIN_NAMESPACE, "v"))
                if value_node is None or value_node.text is None:
                    continue
                value = value_node.text
                if cell_type == "s":
                    value = shared_strings[int(value)]
            values[column_index(reference)] = value
        rows[row_number] = values
    return rows


def extract_payload(migration_path: Path) -> dict[str, object]:
    migration = migration_path.read_text(encoding="utf-8")
    marker = "$vehicle_applications$"
    first = migration.find(marker)
    second = migration.find(marker, first + len(marker))
    if first < 0 or second < 0:
        raise RuntimeError("The migration payload markers were not found.")
    return json.loads(migration[first + len(marker) : second])


def reconstruct_applications(source_path: Path) -> list[dict[str, object]]:
    category_headings = {
        "APLICACOES": None,
        "CAMINHOES": "TRUCK",
        "CAMINHOES / VEICULOS": "TRUCK",
        "ONIBUS": "BUS",
        "MICRO-ONIBUS": "MICROBUS",
    }
    applications: list[dict[str, object]] = []

    with zipfile.ZipFile(source_path) as archive:
        shared_strings = read_shared_strings(archive)
        sheet_paths = workbook_sheet_paths(archive)

        for brand_slug, _brand_name, sheet_name in BRANDS:
            rows = read_sheet_rows(
                archive,
                sheet_paths[sheet_name],
                shared_strings,
            )
            category: str | None = None
            sort_order = 0
            for source_row, columns in sorted(rows.items()):
                first_column = clean(columns.get(1))
                heading = normalized_heading(first_column)
                if heading in category_headings and not clean(columns.get(3)):
                    category = category_headings[heading]
                    continue

                vehicle_model = clean(columns.get(3))
                if not vehicle_model or normalized_heading(vehicle_model) == "MODELO VEICULO":
                    continue

                is_restriction = normalized_heading(first_column) == "RESTRICAO"
                source_kit_code = None if is_restriction else first_column
                source_servo_label = clean(columns.get(2))
                observation = clean(columns.get(4))
                is_restriction = is_restriction or (
                    not source_kit_code and not source_servo_label
                )
                sort_order += 1
                applications.append(
                    {
                        "brand_slug": brand_slug,
                        "category": category,
                        "vehicle_model": vehicle_model,
                        "application_kind": (
                            "RESTRICTION" if is_restriction else "NORMAL"
                        ),
                        "source_kit_code": source_kit_code,
                        "source_servo_label": source_servo_label,
                        "catalog_resolution_status": (
                            "NOT_APPLICABLE"
                            if is_restriction
                            else (
                                "UNRESOLVED"
                                if source_kit_code in PENDING_CODES
                                else "RESOLVED"
                            )
                        ),
                        "observation": observation,
                        "source_sheet": sheet_name,
                        "source_row": source_row,
                        "sort_order": sort_order,
                    }
                )

    return applications


def canonical_payload(payload: dict[str, object]) -> str:
    return json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def first_difference(
    expected: list[dict[str, object]],
    actual: list[dict[str, object]],
) -> str:
    for index, (expected_row, actual_row) in enumerate(zip(expected, actual)):
        if expected_row != actual_row:
            return (
                f"First row mismatch at position {index + 1}:\n"
                f"XLSX: {json.dumps(expected_row, ensure_ascii=False, sort_keys=True)}\n"
                f"SQL:  {json.dumps(actual_row, ensure_ascii=False, sort_keys=True)}"
            )
    return f"Row count mismatch: XLSX={len(expected)}, SQL={len(actual)}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        type=Path,
        default=Path(
            os.environ.get(
                "VEHICLE_APPLICATIONS_SOURCE_XLSX",
                Path.home() / "Documents" / "aplicacoes_negocios_k_revisado.xlsx",
            )
        ),
    )
    parser.add_argument(
        "--migration",
        type=Path,
        default=Path(__file__).resolve().parents[1]
        / "supabase"
        / "migrations"
        / "20260916090000_create_vehicle_applications.sql",
    )
    args = parser.parse_args()

    source_bytes = args.source.read_bytes()
    source_sha256 = hashlib.sha256(source_bytes).hexdigest().upper()
    if source_sha256 != EXPECTED_SOURCE_SHA256:
        raise RuntimeError(
            f"Unexpected XLSX SHA-256: {source_sha256}; expected {EXPECTED_SOURCE_SHA256}."
        )

    payload = extract_payload(args.migration)
    if payload.get("source_sha256") != EXPECTED_SOURCE_SHA256:
        raise RuntimeError("The migration source SHA declaration is missing or incorrect.")

    reconstructed = reconstruct_applications(args.source)
    embedded = payload.get("applications")
    if not isinstance(embedded, list) or reconstructed != embedded:
        raise RuntimeError(first_difference(reconstructed, embedded or []))

    expected_brands = [
        {"slug": slug, "name": name, "display_order": index}
        for index, (slug, name, _sheet) in enumerate(BRANDS, start=1)
    ]
    if payload.get("brands") != expected_brands:
        raise RuntimeError("The embedded brand list does not match the approved order.")

    payload_sha256 = hashlib.sha256(
        canonical_payload(payload).encode("utf-8")
    ).hexdigest()
    if payload_sha256 != EXPECTED_PAYLOAD_SHA256:
        raise RuntimeError(
            f"Unexpected canonical payload SHA-256: {payload_sha256}; "
            f"expected {EXPECTED_PAYLOAD_SHA256 or '<not configured>'}."
        )

    print(f"XLSX_SHA256={source_sha256}")
    print(f"PAYLOAD_SHA256={payload_sha256}")
    print(f"APPLICATIONS_VERIFIED={len(reconstructed)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (KeyError, OSError, RuntimeError, ValueError, zipfile.BadZipFile) as error:
        print(f"vehicle application source verification failed: {error}", file=sys.stderr)
        raise SystemExit(1)
