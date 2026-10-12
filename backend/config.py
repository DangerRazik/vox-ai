from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Whisper (OpenAI-совместимый endpoint)
    WHISPER_API_KEY: str
    WHISPER_BASE_URL: str
    WHISPER_MODEL: str = "whisper-1"  # ← новая строка
    WHISPER_PROMPT: str = (
        "Колл-центр билетного оператора «Интикетс». "
        "Сайт: intickets.ru. "
        "Термины: возврат билета, электронный билет, Пушкинская карта, "
        "промокод, организатор мероприятия, заявка на возврат, сервисный сбор, возврату."
    )

    # LLM (GigaChat-совместимый, OpenAI-совместимый шлюз)
    GPL_BASE_URL: str
    GPL_MODEL: str
    GPL_API_KEY: str = ""  # опционально

    # параметры анализа
    LONG_PAUSE_SEC: float = 3.0       # пауза, считающаяся «длительной»
    INTERRUPTION_GAP_SEC: float = 0.2 # склейка реплик для детекта перебивания
    SPEECH_LANG: str = "ru"

    WHISPER_FIXES: dict = {
        # Название компании
        "Энтикетс": "Интикетс",
        "энтикетс": "Интикетс",
        "Энтикет": "Интикетс",
        "энтикет": "Интикетс",
        "Интикет": "Интикетс",
        "интикет": "Интикетс",
        "Inticket": "Intickets",
        "Ин Тикетс": "Интикетс",
        "Ин-Тикетс": "Интикетс",
        "Антикетс": "Интикетс",
        "антикетс": "Интикетс",
        "тикетс": "Интикетс",
        "Тикетс": "Интикетс",
        "атикетс": "Интикетс",
        "Тикет": "Интикетс",

        # Домен сайта
        "intiqus.ru": "intickets.ru",
        "intiqu.ru": "intickets.ru",
        "intiques.ru": "intickets.ru",
        "intikets.ru": "intickets.ru",
        "intikets": "intickets.ru",
        "интикетс.ру": "intickets.ru",
        "интикетс ру": "intickets.ru",

        # Смежные термины
        "Пушкина карта": "Пушкинская карта",
        "пушкина карта": "Пушкинская карта",
        "pushkin card": "Пушкинская карта",
    }


settings = Settings()