# 통계 검토 문서 인덱스

작성일: 2026-03-04

이 폴더는 설문 대시보드의 그래프 표현 방식과 통계 타당성을 점검하고, 개선안을 구현 가능한 스펙으로 정의한 문서 묶음이다.

## 문서 구성

1. `01_graph-validity-audit.md`
- 현재 구현(`app.js`, `build_survey_data.py`, `survey-data.js`) 기준의 통계 감사 보고서
- 문제점, 근거 수치, 영향도, 우선순위(P0/P1/P2) 포함

2. `02_statistical-redesign-spec.md`
- 개선 설계 스펙
- 점수화 로직, 불확실성 표기, 소표본 보호 규칙, 시각화 가이드, QA 기준 포함

## 권장 읽기 순서

1. `01_graph-validity-audit.md`로 현재 위험요인을 확인한다.
2. `02_statistical-redesign-spec.md`의 Phase 1~3를 순서대로 적용한다.
