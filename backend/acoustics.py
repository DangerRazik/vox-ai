import re
from typing import List, Dict

from processing_context import ProcessingContext


def _word_count(text: str) -> int:
    return len(re.findall(r"\w+", text, flags=re.UNICODE))


def compute_metrics(segments: List[Dict], context: ProcessingContext | None = None) -> Dict:
    """Возвращает объективные акустико-лингвистические метрики."""
    context = context if context is not None else ProcessingContext.from_defaults()
    if not segments:
        return {}

    # 1) Длительные паузы между сегментами
    pauses = []
    for prev, cur in zip(segments, segments[1:]):
        gap = cur["start"] - prev["end"]
        if gap >= context.long_pause_sec:
            pauses.append({
                "after": prev["text"][:80],
                "before": cur["text"][:80],
                "sec": round(gap, 2),
                "at": round(prev["end"], 2),
            })

    # 2) Перебивания: если сегменты идут встык (< 0.2 c) и меняется роль —
    #    это признак наложения реплик (Whisper не даёт overlap, но по стыку видно).
    interruptions = []
    for prev, cur in zip(segments, segments[1:]):
        gap = cur["start"] - prev["end"]
        if gap <= context.interruption_gap_sec and prev.get("role") != cur.get("role"):
            interruptions.append({
                "at": round(cur["start"], 2),
                "by": cur.get("role"),
                "phrase": cur["text"][:80],
            })

    # 3) Темп речи (слов/сек) по каждому спикеру
    rate = {"OPERATOR": [], "CLIENT": []}
    for s in segments:
        dur = max(s["end"] - s["start"], 0.1)
        rate.setdefault(s.get("role", "?"), []).append(_word_count(s["text"]) / dur)

    def avg(xs): return round(sum(xs) / len(xs), 2) if xs else 0.0

    # 4) Маркеры неуверенности/грубости — простые лексические триггеры
    op_text = " ".join(s["text"] for s in segments if s.get("role") == "OPERATOR").lower()
    uncertainty = sum(op_text.count(w) for w in
                      ("наверное", "возможно", "не знаю", "не уверен", "как бы", "ну"))
    rudeness = sum(op_text.count(w) for w in
                   ("алло", "мужчина", "женщина", "девушка", "молодой человек",
                    "вы меня не понимаете", "я же знаю"))

    result = {
        "long_pauses": pauses,
        "long_pauses_count": len(pauses),
        "interruptions": interruptions,
        "interruptions_count": len(interruptions),
        "speech_rate_operator": avg(rate.get("OPERATOR", [])),
        "speech_rate_client": avg(rate.get("CLIENT", [])),
        "uncertainty_markers": uncertainty,
        "rudeness_markers": rudeness,
        "total_duration_sec": round(segments[-1]["end"] - segments[0]["start"], 2),
    }
    if not context.speech_rate_enabled:
        result.pop("speech_rate_operator")
        result.pop("speech_rate_client")
    if context.unwanted_expressions_enabled:
        result["unwanted_expressions"] = [
            {"expression": expression, "count": op_text.count(expression.lower())}
            for expression in context.unwanted_expressions if expression.lower() in op_text
        ]
    return result