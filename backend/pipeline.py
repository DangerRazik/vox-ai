from typing import Dict
from processing_context import ProcessingContext

from transcriber import transcribe, assign_roles, to_dialog_text
from acoustics import compute_metrics
from kb import load_knowledge_base
from analyzer import analyze_call


def process_call(audio_path: str, kb_path: str | None = None, *,
                 context: ProcessingContext | None = None) -> Dict:
    """CLI передаёт kb_path; выбранный стрим передаёт полный context.

    Два источника базы знаний одновременно запрещены, чтобы не смешать стримы.
    """
    if context is not None and kb_path is not None:
        raise ValueError("Передайте либо kb_path, либо context, не оба")
    if context is None:
        if kb_path is None:
            raise ValueError("Требуется kb_path или context")
        context = ProcessingContext.from_defaults(kb_path)
    # 1) Транскрибация
    segments = transcribe(audio_path, context)
    # 2) Роли
    segments = assign_roles(segments, context)
    # 3) Текст диалога и акустические метрики
    dialog = to_dialog_text(segments)
    metrics = compute_metrics(segments, context)
    # 4) KB
    kb_text = load_knowledge_base(context.kb_path)
    # 5) Оценка
    result = analyze_call(dialog, kb_text, metrics, context)

    # Добавляем сырые данные — полезно для разбора QA и аудита
    result["_segments"] = segments
    result["_metrics"] = metrics
    return result