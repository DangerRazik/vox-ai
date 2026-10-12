import quopri
import re
from pathlib import Path
from bs4 import BeautifulSoup


def load_knowledge_base(path: str) -> str:
    """Возвращает очищенный текст Q&A для передачи в LLM."""
    raw = Path(path).read_bytes()

    # Если есть QP-кодирование — декодируем
    try:
        decoded = quopri.decodestring(raw).decode("utf-8", errors="ignore")
    except Exception:
        decoded = raw.decode("utf-8", errors="ignore")

    # Если это HTML — чистим
    if "<html" in decoded.lower() or "<table" in decoded.lower():
        soup = BeautifulSoup(decoded, "html.parser")
        # Берём только заголовки (<h2>) и таблицы — там сидит Q&A
        text_parts = []
        for tag in soup.find_all(["h1", "h2", "h3", "td"]):
            t = tag.get_text(" ", strip=True)
            if t:
                text_parts.append(t)
        text = "\n".join(text_parts)
    else:
        text = decoded

    # Убираем мусор и сжимаем пустые строки
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()