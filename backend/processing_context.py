from dataclasses import dataclass, field, replace
from types import MappingProxyType
from typing import Mapping
from checklist import CHECKLIST


@dataclass(frozen=True)
class ProcessingContext:
    """Настройки одного запуска, без адресов сервисов и секретов.

    База знаний задаётся путём; StreamStore сохраняет и проверяет материалы стрима.
    """

    kb_path: str
    whisper_model: str
    llm_model: str
    speech_lang: str
    whisper_prompt: str
    role_prompt: str
    analysis_system_prompt: str
    analysis_user_prompt: str
    long_pause_sec: float
    interruption_gap_sec: float
    whisper_fixes: Mapping[str, str] = field(default_factory=dict)
    text_correction_enabled: bool = True
    unwanted_expressions_enabled: bool = True
    speech_rate_enabled: bool = True
    zero_total_on_critical: bool = True
    unwanted_expressions: tuple[str, ...] = ()
    enabled_criteria: tuple[str, ...] = field(default_factory=lambda: tuple(c['id'] for c in CHECKLIST))

    def __post_init__(self):
        object.__setattr__(self, "whisper_fixes", MappingProxyType(dict(self.whisper_fixes)))
        object.__setattr__(self, "unwanted_expressions", tuple(self.unwanted_expressions))
        selected = tuple(self.enabled_criteria)
        if not selected or len(set(selected)) != len(selected) or set(selected) - {c['id'] for c in CHECKLIST}:
            raise ValueError('Select at least one known criterion without duplicates')
        object.__setattr__(self, 'enabled_criteria', tuple(c['id'] for c in CHECKLIST if c['id'] in selected))

    @classmethod
    def from_defaults(cls, kb_path: str = "", **overrides) -> "ProcessingContext":
        """Снимок текущей CLI-конфигурации; явный контекст дальше её не читает."""
        from config import settings
        from transcriber import _ROLE_PROMPT
        from analyzer import SYSTEM, USER_TMPL

        context = cls(
            kb_path=kb_path,
            whisper_model=settings.WHISPER_MODEL,
            llm_model=settings.GPL_MODEL,
            speech_lang=settings.SPEECH_LANG,
            whisper_prompt=settings.WHISPER_PROMPT,
            role_prompt=_ROLE_PROMPT,
            analysis_system_prompt=SYSTEM,
            analysis_user_prompt=USER_TMPL,
            long_pause_sec=settings.LONG_PAUSE_SEC,
            interruption_gap_sec=settings.INTERRUPTION_GAP_SEC,
            whisper_fixes=settings.WHISPER_FIXES,
        )
        return replace(context, **overrides) if overrides else context
