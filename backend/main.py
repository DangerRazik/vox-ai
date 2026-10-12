import argparse
import json
from pathlib import Path

from pipeline import process_call


def main():
    p = argparse.ArgumentParser(description="Речевая аналитика звонков")
    p.add_argument("audio", help="Путь к аудиофайлу (.wav/.mp3/.ogg)")
    p.add_argument("--kb", default="Вопрос-Ответ+с+добавлениями.doc",
                   help="Файл базы знаний")
    p.add_argument("--out", default="result.json", help="Куда сохранить JSON")
    args = p.parse_args()

    result = process_call(args.audio, args.kb)
    Path(args.out).write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Краткая сводка в консоль
    print(f"Итого: {result['total']} / {result['max_total']}")
    print(f"Крит. нарушение: {result['critical_violation']}")
    print(f"Тональность: оп={result['sentiment']['operator']}, "
          f"кл={result['sentiment']['client']}, "
          f"стресс={result['stress_level_operator']}/10")
    print("\nПо пунктам:")
    for cid, s in result["scores"].items():
        print(f"  {cid}: {s['score']}/{s['max']} — {s['reason']}")
    print("\nРекомендации:")
    for r in result["recommendations"]:
        print(f"  - {r}")


if __name__ == "__main__":
    main()