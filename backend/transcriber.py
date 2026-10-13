from usage_metrics import usage_request
import json
import re
from pathlib import Path
from typing import Dict, List

import httpx
from openai import OpenAI

from config import settings
from processing_context import ProcessingContext


# ============================================================
# 1. Парсер ответа Whisper
# ============================================================

# Формат сервера: [HH:MM:SS.ffffff -> HH:MM:SS.ffffff] SPEAKER_XX:текст
_SEG_RE = re.compile(
    r"\[(\d+):(\d+):(\d+(?:\.\d+)?)\s*->\s*(\d+):(\d+):(\d+(?:\.\d+)?)\]\s*"
    r"(SPEAKER_\d+)\s*:\s*(.*?)(?=\n\[|\Z)",
    re.DOTALL,
)


def _to_sec(h: str, m: str, s: str) -> float:
    return int(h) * 3600 + int(m) * 60 + float(s)


def _parse_transcription_string(text: str) -> List[Dict]:
    """Парсит '[0:00:00.05 -> 0:00:04.13] SPEAKER_01: ...' в список сегментов."""
    segments: List[Dict] = []
    for m in _SEG_RE.finditer(text):
        h1, m1, s1, h2, m2, s2, speaker, chunk = m.groups()
        segments.append({
            "start":   _to_sec(h1, m1, s1),
            "end":     _to_sec(h2, m2, s2),
            "speaker": speaker,
            "text":    chunk.strip(),
        })
    return segments


# ============================================================
# 2. Словарная нормализация текста
# ============================================================

def _normalize_text(text: str, context: ProcessingContext | None = None) -> str:
    """Заменяет известные ошибки Whisper на канонические варианты.

    - Ключи сортируются по длине убыв., чтобы 'Энтикетс' заменялось раньше,
      чем 'Энтикет'.
    - Используются границы слов (кириллица + латиница), чтобы не портить
      короткие совпадения внутри других слов.
    """
    if not text:
        return text

    context = context if context is not None else ProcessingContext.from_defaults()
    if not context.text_correction_enabled:
        return text
    fixes = context.whisper_fixes

    for wrong in sorted(fixes, key=len, reverse=True):
        right = fixes[wrong]
        pattern = re.compile(
            rf"(?<![А-Яа-яЁёA-Za-z]){re.escape(wrong)}(?![А-Яа-яЁёA-Za-z])"
        )
        text = pattern.sub(right, text)

    return text


def _apply_fixes_to_segments(segments: List[Dict], context: ProcessingContext | None = None) -> List[Dict]:
    """Прогоняет все сегменты через словарь нормализации."""
    for s in segments:
        s["text"] = _normalize_text(s.get("text", ""), context)
    return segments


# ============================================================
# 3. Транскрибация через Whisper
# ============================================================

def transcribe(audio_path: str, context: ProcessingContext | None = None) -> List[Dict]:
    """Транскрибация + диаризация + нормализация текста."""
    context = context if context is not None else ProcessingContext.from_defaults()
    url = settings.WHISPER_BASE_URL.rstrip("/") + "/audio/transcriptions"
    headers = {"Authorization": f"Bearer {settings.WHISPER_API_KEY}"}

    with open(audio_path, "rb") as f:
        files = {"file": (Path(audio_path).name, f, "application/octet-stream")}
        data = {
            "model": context.whisper_model,
            "response_format": "json",
            "language": context.speech_lang,
            # prompt-подсказка: улучшает распознавание имён собственных.
            # Если прокси её не поддерживает — удали эту строку.
            "prompt": context.whisper_prompt,
            "temperature": "0",
        }
        with usage_request("whisper") as usage:
            with httpx.Client(trust_env=False, timeout=900) as client:
                r = client.post(url, headers=headers, files=files, data=data)
                r.raise_for_status()
            payload = r.json()
            usage.capture(payload.get("usage"))

    # --- Разбор ответа ---
    if "transcription" in payload:
        segments = _parse_transcription_string(payload["transcription"])
    elif "segments" in payload:
        segments = [
            {"start": float(s["start"]), "end": float(s["end"]),
             "speaker": s.get("speaker", "SPEAKER_00"),
             "text": s["text"].strip()}
            for s in payload["segments"]
        ]
    elif "text" in payload:
        segments = [{"start": 0.0, "end": 0.0,
                     "speaker": "SPEAKER_00", "text": payload["text"].strip()}]
    else:
        raise ValueError(f"Неизвестный формат ответа Whisper: {list(payload.keys())}")

    # --- Нормализация текста ---
    segments = _apply_fixes_to_segments(segments, context)

    return segments


# ============================================================
# 4. Разметка ролей (кто оператор, кто клиент)
# ============================================================

_ROLE_PROMPT = """Ты размечаешь диалог колл-центра.
Определи, какой из спикеров (SPEAKER_00 / SPEAKER_01 / ...) — ОПЕРАТОР (сотрудник),
а какой — КЛИЕНТ.

Подсказки:
- Оператор обычно приветствует первым, представляется, называет компанию,
  задаёт уточняющие вопросы, ссылается на регламент, помогает с решением.
- Клиент рассказывает свою ситуацию, задаёт вопросы, иногда жалуется.
- Компания-оператор: «Интикетс», сайт intickets.ru.

Диалог (первые фрагменты):
{fragments}

Верни СТРОГО JSON: {{"operator": "SPEAKER_XX", "client": "SPEAKER_YY"}}
"""


def assign_roles(segments: List[Dict], context: ProcessingContext | None = None) -> List[Dict]:
    """Определяет, какой SPEAKER_XX — оператор, проставляет role у сегментов."""
    context = context if context is not None else ProcessingContext.from_defaults()
    if not segments:
        return segments

    speakers = sorted({s.get("speaker") for s in segments if s.get("speaker")})
    if len(speakers) < 2:
        for s in segments:
            s["role"] = "OPERATOR"
        return segments

    # Нормализуем фрагменты перед отправкой (на случай имён собственных)
    head_parts = []
    for s in segments[:15]:
        txt = _normalize_text(s["text"], context)
        head_parts.append(f"{s['speaker']}: {txt}")
    head = "\n".join(head_parts)

    client = OpenAI(
        base_url=settings.GPL_BASE_URL,
        api_key=settings.GPL_API_KEY or "dummy",
        http_client=httpx.Client(trust_env=False, timeout=120),
    )

    try:
        with usage_request("llm_roles") as usage:
            resp = client.chat.completions.create(
                model=context.llm_model,
                temperature=0,
                response_format={"type": "json_object"},
                messages=[{"role": "user",
                           "content": context.role_prompt.format(fragments=head)}],
            )
            usage.capture(getattr(resp, "usage", None))
        mapping = json.loads(resp.choices[0].message.content)
        op = mapping.get("operator")
        if op not in speakers:
            raise ValueError(f"LLM вернула неизвестного оператора: {op}")
    except Exception as e:
        print(f"[assign_roles] LLM-разметка не сработала ({e}); "
              f"эвристика: первый спикер = OPERATOR")
        op = speakers[0]
    finally:
        client.close()

    for s in segments:
        s["role"] = "OPERATOR" if s.get("speaker") == op else "CLIENT"
    return segments


# ============================================================
# 5. Сборка диалога в текст
# ============================================================

def to_dialog_text(segments: List[Dict]) -> str:
    """Сборка диалога в читаемый текст с таймкодами."""
    lines = []
    for s in segments:
        mm, ss = divmod(int(s["start"]), 60)
        lines.append(f"[{mm:02d}:{ss:02d}] {s.get('role', '?')}: {s['text']}")
    return "\n".join(lines)