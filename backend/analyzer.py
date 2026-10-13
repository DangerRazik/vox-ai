from usage_metrics import usage_request
import json
import copy
from typing import Dict

import httpx
from openai import OpenAI

from config import settings
from processing_context import ProcessingContext
from checklist import checklist_for_prompt, CHECKLIST


SYSTEM = (
    "Ты — эксперт по контролю качества колл-центра. Анализируешь диалоги по чек-листу и "
    "базе знаний. Учитываешь смысл, а не только ключевые слова: синонимы, перефразирования, "
    "полноту ответа. Всегда возвращаешь ответ строго в формате JSON."
)

USER_TMPL = """Проведи оценку звонка оператора.

=== ЧЕК-ЛИСТ ===
{checklist}

=== БАЗА ЗНАНИЙ (эталонные ответы) ===
{kb}

=== ОБЪЕКТИВНЫЕ МЕТРИКИ (паузы/перебивания/темп) ===
{metrics}

=== ДИАЛОГ ===
{dialog}

Верни СТРОГО JSON по шаблону:
{{
  "scores": {{
    "<id>": {{"score": <0|0.5|1>, "max": <int>, "reason": "1-2 предложения, при необходимости с цитатой"}},
    ...
  }},
  "total": <float>,
  "max_total": <int>,
  "critical_violation": <bool>,
  "critical_violation_details": "<если critical_violation=true — краткое описание с цитатой из диалога, что именно нарушено и почему это критично; иначе пустая строка>",
  "sentiment": {{"operator": "positive|neutral|negative", "client": "positive|neutral|negative"}},
  "stress_level_operator": <0-10>,
  "etiquette_violations": ["грубость", "неуверенность", ...],
  "kb_check": {{
     "questions_detected": ["..."],
     "operator_answers_correct": <bool>,
     "mismatches": [{{"question": "...", "operator_said": "...", "kb_says": "..."}}]
  }},
  "recommendations": ["...", "...", "..."]
}}

Требования:
- Пройди по КАЖДОМУ пункту чек-листа. Не пропускай пункты, даже если считаешь их неприменимыми — поставь 1 и напиши «не применимо, зачтено по умолчанию».
- Проверь ответы оператора на соответствие Базе знаний; если ответа в KB нет — отметь это.
- Если в 5.2 зафиксировано критическое нарушение — обнули total (мы это всё равно сделаем в коде, но ты тоже поставь 0).
- В поле critical_violation_details укажи конкретную цитату из диалога и объяснение, почему это критично (финансовые потери, репутационные риски, обман, жалоба клиента).
- Рекомендации — конкретные, привязанные к пунктам чек-листа (3–5 штук).
"""


def _call_llm(user_prompt: str, context: ProcessingContext) -> str:
    """Вызов LLM. Возвращает сырой текст ответа."""
    client = OpenAI(
        base_url=settings.GPL_BASE_URL,
        api_key=settings.GPL_API_KEY or "dummy",
        http_client=httpx.Client(trust_env=False, timeout=120),
    )
    try:
        with usage_request("llm_analysis") as usage:
            resp = client.chat.completions.create(
                model=context.llm_model,
                temperature=0,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": context.analysis_system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            )
            usage.capture(getattr(resp, "usage", None))
        return resp.choices[0].message.content
    finally:
        client.close()


def normalize_result(raw: Dict, context: ProcessingContext) -> Dict:
    """Validate canonical scores; never let model flags override criterion 5.2."""
    if not isinstance(raw, dict) or not isinstance(raw.get("scores"), dict):
        raise ValueError("Missing criterion scores")
    result = copy.deepcopy(raw)
    scores = {}
    for criterion in CHECKLIST:
        cid = criterion["id"]
        if cid not in context.enabled_criteria:
            continue
        item = result["scores"].get(cid)
        if cid == "2.2" and not context.speech_rate_enabled:
            item = {"score": 1, "reason": "анализ темпа отключён"}
        if not isinstance(item, dict):
            raise ValueError(f"Missing criterion {cid}")
        reason = item.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError(f"Missing explanation {cid}")
        score = item.get("score")
        if item.get("applicable") is False or "не применимо" in reason.casefold() or "неприменим" in reason.casefold():
            score = 1
            reason = f"не применимо, зачтено по умолчанию. {reason}"
        allowed = (0, 1) if cid == "5.2" else (0, 0.5, 1)
        if isinstance(score, bool) or not isinstance(score, (int, float)) or score not in allowed:
            raise ValueError(f"Invalid score {cid}")
        scores[cid] = {"score": score, "max": 1, "reason": reason}
    result["scores"] = scores
    result["critical_violation"] = '5.2' in scores and scores["5.2"]["score"] == 0
    if not result['critical_violation']:
        result['critical_violation_details'] = ''
    result["original_total"] = sum(item["score"] for item in scores.values())
    result["total"] = 0 if context.zero_total_on_critical and result["critical_violation"] else result["original_total"]
    result["max_total"] = len(context.enabled_criteria)
    return result


def analyze_call(dialog_text: str, kb_text: str, metrics: Dict,
                 context: ProcessingContext | None = None) -> Dict:
    context = context if context is not None else ProcessingContext.from_defaults()
    # 1. Формируем промпт
    user = context.analysis_user_prompt.format(
        checklist=checklist_for_prompt(context.enabled_criteria),
        kb=kb_text[:20000],
        metrics=json.dumps(metrics, ensure_ascii=False, indent=2),
        dialog=dialog_text,
    )

    # 2. Запрос к LLM
    user += "\nОцени только критерии из чек-листа: " + ', '.join(context.enabled_criteria)
    user += f". Максимум итога: {len(context.enabled_criteria)}. Не проверяй остальные критерии и не давай по ним рекомендации. Неприменимые выбранные критерии: 1 с пояснением."
    if '5.2' in context.enabled_criteria:
        user += "\nКритерий 5.2 строго 0 или 1."
    else:
        user += "\nПроверка критического нарушения отключена: critical_violation=false, critical_violation_details пустая строка, итог не обнулять."
    if not context.speech_rate_enabled and '2.2' in context.enabled_criteria:
        user += "\nАнализ темпа отключён: критерий 2.2 = 1, причина: анализ темпа отключён."
    raw = _call_llm(user, context)
    return normalize_result(json.loads(raw), context)
