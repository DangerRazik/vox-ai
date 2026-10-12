import unittest
import os
import tempfile
from pathlib import Path
from dataclasses import FrozenInstanceError, replace

from processing_context import ProcessingContext
from acoustics import compute_metrics
from pipeline import process_call


class ProcessingContextTests(unittest.TestCase):
    def test_context_owns_immutable_copy_of_correction_dictionary(self):
        fixes = {"ошибка": "исправление"}
        context = ProcessingContext.from_defaults("kb.doc", whisper_fixes=fixes)
        fixes["ошибка"] = "другое"
        self.assertEqual(context.whisper_fixes["ошибка"], "исправление")
        with self.assertRaises(TypeError):
            context.whisper_fixes["ошибка"] = "другое"
        with self.assertRaises(FrozenInstanceError):
            context.speech_lang = "en"

    def test_metrics_use_selected_context_in_a_b_a_sequence(self):
        segments = [
            {"start": 0, "end": 1, "text": "Здравствуйте", "role": "OPERATOR"},
            {"start": 3, "end": 4, "text": "Спасибо", "role": "CLIENT"},
        ]
        a = ProcessingContext.from_defaults(long_pause_sec=1, interruption_gap_sec=0.2)
        b = replace(a, long_pause_sec=3, interruption_gap_sec=2)
        results = [compute_metrics(segments, context) for context in (a, b, a)]
        self.assertEqual([r["long_pauses_count"] for r in results], [1, 0, 1])
        self.assertEqual([r["interruptions_count"] for r in results], [0, 1, 0])
        self.assertEqual(results[0], results[2])

    def test_pipeline_rejects_ambiguous_context_before_opening_audio(self):
        with self.assertRaises(ValueError):
            process_call("missing.mp3", "other.doc", context=ProcessingContext.from_defaults())
        with self.assertRaises(ValueError):
            process_call("missing.mp3")


@unittest.skipUnless(os.environ.get("RUN_LIVE_CONTEXT_TEST") == "1",
                     "Opt-in: real Whisper/LLM calls, potentially paid")
class LiveProcessingContextTests(unittest.TestCase):
    def test_real_processing_uses_context_a_b_a_without_global_changes(self):
        from config import settings
        from kb import load_knowledge_base

        root = Path(__file__).resolve().parent
        audio = root / "call_002.mp3"
        original = settings.model_dump()
        with tempfile.TemporaryDirectory(prefix="vox-context-") as temp:
            kb_a = Path(temp) / "a.txt"
            kb_b = Path(temp) / "b.txt"
            kb_a.write_text("Возврат билета: клиент подаёт заявку организатору.", encoding="utf-8")
            kb_b.write_text("Проверка второго стрима: сведения о возврате отсутствуют.", encoding="utf-8")
            self.assertNotEqual(load_knowledge_base(str(kb_a)), load_knowledge_base(str(kb_b)))
            a = ProcessingContext.from_defaults(
                str(kb_a), whisper_fixes={"Здравствуйте": "ПриветствиеА", "здравствуйте": "ПриветствиеА"},
                long_pause_sec=0, interruption_gap_sec=-1000,
            )
            b = replace(a, kb_path=str(kb_b), whisper_fixes={
                "Здравствуйте": "ПриветствиеБ", "здравствуйте": "ПриветствиеБ"},
                long_pause_sec=10000, whisper_prompt=a.whisper_prompt + " Диалог службы поддержки.",
                analysis_system_prompt=a.analysis_system_prompt + " Проверяй только переданную базу знаний.")
            for label, context, marker, forbidden in (
                ("A", a, "ПриветствиеА", "ПриветствиеБ"),
                ("B", b, "ПриветствиеБ", "ПриветствиеА"),
                ("A-repeat", a, "ПриветствиеА", "ПриветствиеБ"),
            ):
                with self.subTest(context=label):
                    print(f"Live context: {label}", flush=True)
                    result = process_call(str(audio), context=context)
                    self.assertTrue(result["_segments"])
                    self.assertIn("scores", result)
                    self.assertIn("total", result)
                    text = " ".join(s["text"] for s in result["_segments"])
                    self.assertIn(marker, text)
                    self.assertNotIn(forbidden, text)
                    self.assertEqual(result["_metrics"], compute_metrics(result["_segments"], context))
                    if label == "B":
                        self.assertEqual(result["_metrics"]["long_pauses_count"], 0)
                    self.assertEqual(settings.model_dump(), original)


if __name__ == "__main__":
    unittest.main()