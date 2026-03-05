#!/usr/bin/env python3
"""Build browser-friendly survey JS data from an XLSX export.

No third-party dependency is required.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
XML_NS = {"a": MAIN_NS}


def col_to_idx(col_ref: str) -> int:
    value = 0
    for ch in col_ref:
        if "A" <= ch <= "Z":
            value = value * 26 + (ord(ch) - 64)
    return value


def parse_rank(value: str) -> int | None:
    if not value:
        return None
    match = re.search(r"([1-3])\s*순위", value)
    if not match:
        return None
    return int(match.group(1))


def parse_float(value: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_checkbox(value: str) -> bool:
    if value is None:
        return False
    text = str(value).strip()
    return text in {"1", "1.0", "TRUE", "true", "True"}


def parse_multi_text(value: str) -> list[str]:
    if not value:
        return []
    tokens = [part.strip() for part in str(value).split(",")]
    return [token for token in tokens if token]


def excel_serial_to_iso(value: str) -> str:
    numeric = parse_float(value)
    if numeric is None:
        return ""
    base = datetime(1899, 12, 30)
    dt = base + timedelta(days=numeric)
    return dt.strftime("%Y-%m-%d %H:%M")


def load_rows(xlsx_path: Path) -> tuple[list[str], list[list[str]]]:
    with ZipFile(xlsx_path) as archive:
        sst: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            sst_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for si in sst_root.findall("a:si", XML_NS):
                simple_t = si.find("a:t", XML_NS)
                if simple_t is not None:
                    sst.append(simple_t.text or "")
                else:
                    rich_text = "".join((node.text or "") for node in si.findall(".//a:t", XML_NS))
                    sst.append(rich_text)

        wb_root = ET.fromstring(archive.read("xl/workbook.xml"))
        rels_root = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        rel_map = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels_root}

        first_sheet = wb_root.find(".//a:sheets/a:sheet", XML_NS)
        if first_sheet is None:
            raise RuntimeError("No worksheet found in workbook")
        rel_id = first_sheet.attrib[f"{{{REL_NS}}}id"]
        sheet_target = rel_map[rel_id]
        if not sheet_target.startswith("worksheets/"):
            sheet_target = f"worksheets/{Path(sheet_target).name}"
        sheet_path = f"xl/{sheet_target}"

        sheet_root = ET.fromstring(archive.read(sheet_path))
        row_nodes = sheet_root.findall(".//a:sheetData/a:row", XML_NS)

        matrix: list[list[str]] = []
        max_col = 0

        for row in row_nodes:
            values: dict[int, str] = {}
            for cell in row.findall("a:c", XML_NS):
                ref = cell.attrib.get("r", "")
                match = re.match(r"([A-Z]+)", ref)
                if not match:
                    continue

                col_idx = col_to_idx(match.group(1))
                max_col = max(max_col, col_idx)

                cell_type = cell.attrib.get("t")
                value_node = cell.find("a:v", XML_NS)
                inline_node = cell.find("a:is/a:t", XML_NS)

                value = ""
                if cell_type == "s" and value_node is not None and value_node.text is not None:
                    shared_idx = int(value_node.text)
                    value = sst[shared_idx] if 0 <= shared_idx < len(sst) else ""
                elif cell_type == "inlineStr" and inline_node is not None:
                    value = inline_node.text or ""
                elif value_node is not None and value_node.text is not None:
                    value = value_node.text

                values[col_idx] = value.strip() if isinstance(value, str) else str(value)

            row_data = [values.get(i, "") for i in range(1, max_col + 1)]
            matrix.append(row_data)

    if not matrix:
        return [], []

    header = matrix[0]
    rows = matrix[1:]
    return header, rows


def derive_program(major: str, studio: str) -> str:
    source = major or studio
    if source.startswith("예술사"):
        return "예술사"
    if source.startswith("전문사"):
        return "전문사"
    return "기타"


def build_payload(header: list[str], rows: list[list[str]], source_name: str) -> dict:
    def get(row: list[str], idx: int) -> str:
        return row[idx] if idx < len(row) else ""

    mode_indices = {
        "offline": 6,
        "online": 7,
        "hybrid": 8,
        "no_exhibition": 9,
    }
    mode_labels = {
        "offline": "오프라인 전시",
        "online": "온라인 전시",
        "hybrid": "온·오프라인 병행",
        "no_exhibition": "전시 없음(졸업심사)",
    }

    venue_option_indices = {
        "학생 전액 분담": 11,
        "학교 일부 지원": 12,
        "학교 전액 지원": 13,
        "외부 대관 불가": 14,
    }

    personal_budget_indices = {
        "부담할 수 없다": 17,
        "-5만 원": 18,
        "5-10만 원": 19,
        "10-20만 원": 20,
        "20-30만 원": 21,
        "40만 원-": 22,
    }

    total_budget_indices = {
        "-10만 원": 24,
        "10-30만 원": 25,
        "30-50만 원": 26,
        "100만 원 이상": 27,
    }

    expectation_indices = {
        "공식적 마무리 의식": 37,
        "프로젝트 실물 활용": 38,
        "전시 운영 실무 경험": 39,
        "포트폴리오/진로 활용": 40,
        "외부 관람객 연결": 41,
        "가족·지인 공유": 42,
        "동기들과 협업 경험": 43,
        "큰 기대 없음": 44,
    }

    concern_indices = {
        "전시 공동 예산 부족": 46,
        "개인 프로젝트 예산 부족": 47,
        "협소한 공간/접근성": 48,
        "졸업 프로젝트 일정 변화": 49,
        "부적절한 전시 기간": 50,
        "의견 조율 어려움": 51,
        "기획/운영 참여 저조": 52,
        "졸준위 임원 방임": 53,
        "큰 우려 없음": 54,
    }

    respondents = []
    for i, row in enumerate(rows, start=1):
        major = get(row, 4)
        studio = get(row, 5)

        mode_ranking = {key: parse_rank(get(row, idx)) for key, idx in mode_indices.items()}
        top_mode_key = next((key for key, rank in mode_ranking.items() if rank == 1), None)

        venue_scores = {label: parse_float(get(row, idx)) for label, idx in venue_option_indices.items()}

        selected_personal = [
            label for label, idx in personal_budget_indices.items() if parse_checkbox(get(row, idx))
        ]
        if not selected_personal:
            selected_personal = parse_multi_text(get(row, 16))

        selected_total = [
            label for label, idx in total_budget_indices.items() if parse_checkbox(get(row, idx))
        ]
        if not selected_total:
            selected_total = parse_multi_text(get(row, 23))

        expectation_ranking = {
            label: parse_rank(get(row, idx)) for label, idx in expectation_indices.items()
        }
        concern_ranking = {label: parse_rank(get(row, idx)) for label, idx in concern_indices.items()}

        respondents.append(
            {
                "index": i,
                "submission_id": get(row, 0),
                "respondent_id": get(row, 1),
                "submitted_at": excel_serial_to_iso(get(row, 2)),
                "name": get(row, 3),
                "major": major,
                "studio": studio,
                "program": derive_program(major, studio),
                "mode_ranking": mode_ranking,
                "top_mode": top_mode_key,
                "offline_stance": parse_float(get(row, 10)),
                "venue_scores": venue_scores,
                "venue_comment": get(row, 15),
                "personal_budget": {
                    "raw": get(row, 16),
                    "selected": selected_personal,
                },
                "total_budget": {
                    "raw": get(row, 23),
                    "selected": selected_total,
                },
                "budget_comment": get(row, 28),
                "ops": {
                    "student_participation": parse_float(get(row, 29)),
                    "external_staff": parse_float(get(row, 30)),
                    "compensation": parse_float(get(row, 31)),
                    "comment": get(row, 32),
                    "reduce_participants": parse_float(get(row, 33)),
                    "reduce_project_scale": parse_float(get(row, 34)),
                    "shorten_period": parse_float(get(row, 35)),
                    "reality_comment": get(row, 36),
                },
                "expectation_ranking": expectation_ranking,
                "expectation_comment": get(row, 45),
                "concern_ranking": concern_ranking,
                "concern_comment": get(row, 55),
                "post_grad_plan": get(row, 56),
                "desired_field": get(row, 57),
                "questionnaire_version": {
                    "columns": len(header),
                    "has_header": bool(header),
                },
            }
        )

    majors = sorted({r["major"] for r in respondents if r["major"]})
    studios = sorted({r["studio"] for r in respondents if r["studio"]})
    programs = sorted({r["program"] for r in respondents if r["program"]})

    payload = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "source_file": source_name,
        "response_count": len(respondents),
        "dimensions": {
            "programs": programs,
            "majors": majors,
            "studios": studios,
        },
        "labels": {
            "modes": mode_labels,
            "expectations": list(expectation_indices.keys()),
            "concerns": list(concern_indices.keys()),
        },
        "respondents": respondents,
    }
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Build survey-data.js from survey xlsx")
    parser.add_argument("--input", default="survey.xlsx", help="Path to source xlsx")
    parser.add_argument("--output", default="survey-data.js", help="Output JS path")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    header, rows = load_rows(input_path)
    payload = build_payload(header, rows, input_path.name)

    js_text = "window.SURVEY_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n"
    output_path.write_text(js_text, encoding="utf-8")

    print(f"Wrote {output_path} with {payload['response_count']} responses")


if __name__ == "__main__":
    main()
