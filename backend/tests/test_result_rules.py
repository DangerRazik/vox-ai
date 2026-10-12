import unittest

from analyzer import normalize_result
from checklist import CHECKLIST
from processing_context import ProcessingContext


class ResultRulesTests(unittest.TestCase):
    def test_only_selected_criteria_are_requested_and_counted(self):
        from analyzer import analyze_call
        from unittest.mock import patch
        import json
        context = ProcessingContext.from_defaults(enabled_criteria=('1.1', '4.1'))
        raw = {'scores': {'1.1': {'score': 0.5, 'reason': 'Частично'},
                          '4.1': {'score': 0, 'applicable': False, 'reason': 'Удержания не было'},
                          '5.2': {'score': 0, 'reason': 'Ответ модели не должен учитываться'}},
               'critical_violation': True, 'critical_violation_details': 'Не учитывать'}
        with patch('analyzer._call_llm', return_value=json.dumps(raw)) as model:
            result = analyze_call('Диалог', 'База', {}, context)
        prompt = model.call_args.args[0]
        self.assertIn('[1.1]', prompt)
        self.assertNotIn('[1.2]', prompt)
        self.assertNotIn('[5.2]', prompt)
        self.assertEqual(set(result['scores']), {'1.1', '4.1'})
        self.assertEqual(result['total'], 1.5)
        self.assertEqual(result['max_total'], 2)
        self.assertFalse(result['critical_violation'])
        self.assertEqual(result['critical_violation_details'], '')

    def test_selected_critical_criterion_still_zeros_variable_total(self):
        context = ProcessingContext.from_defaults(enabled_criteria=('1.1', '5.2'))
        result = normalize_result({'scores': {'1.1': {'score': 1, 'reason': 'Да'},
            '5.2': {'score': 0, 'reason': 'Нарушение'}}}, context)
        self.assertEqual(result['total'], 0)
        self.assertEqual(result['original_total'], 1)
        self.assertEqual(result['max_total'], 2)

    def test_model_flag_cannot_invent_a_critical_violation(self):
        raw = {'scores': {c['id']: {'score': 1, 'reason': 'OK'} for c in CHECKLIST},
               'critical_violation': True}
        result = normalize_result(raw, ProcessingContext.from_defaults())
        self.assertFalse(result['critical_violation'])
        self.assertEqual(result['total'], 11)

    def test_missing_scores_and_explanations_are_rejected(self):
        for item in (None, {'score': 1}, {'score': 1, 'reason': '  '}):
            raw = {'scores': {c['id']: {'score': 1, 'reason': 'OK'} for c in CHECKLIST}}
            raw['scores']['1.1'] = item
            with self.subTest(item=item), self.assertRaises(ValueError):
                normalize_result(raw, ProcessingContext.from_defaults())

    def test_stream_options_control_dictionary_and_rate_metrics(self):
        from acoustics import compute_metrics

        segments = [{'start': 0, 'end': 2, 'text': 'Грубость грубость', 'role': 'OPERATOR'}]
        enabled = ProcessingContext.from_defaults(unwanted_expressions=('грубость',))
        metrics = compute_metrics(segments, enabled)
        self.assertEqual(metrics['unwanted_expressions'], [{'expression': 'грубость', 'count': 2}])
        disabled = ProcessingContext.from_defaults(unwanted_expressions=('грубость',),
                                                  unwanted_expressions_enabled=False, speech_rate_enabled=False)
        metrics = compute_metrics(segments, disabled)
        self.assertNotIn('unwanted_expressions', metrics)
        self.assertNotIn('speech_rate_operator', metrics)
        self.assertNotIn('speech_rate_client', metrics)

    def test_critical_only_changes_total_not_criterion_scores(self):
        context = ProcessingContext.from_defaults()
        raw = {"scores": {c["id"]: {"score": 1, "reason": "Выполнено"} for c in CHECKLIST},
               "critical_violation": False}
        raw["scores"]["5.2"] = {"score": 0, "reason": "Неверная консультация"}
        result = normalize_result(raw, context)
        self.assertTrue(result["critical_violation"])
        self.assertEqual(result["total"], 0)
        self.assertEqual(result["scores"]["1.1"]["score"], 1)
        self.assertEqual(result["original_total"], 10)
        self.assertEqual(result["max_total"], 11)

    def test_disabled_rate_and_inapplicability_receive_full_score(self):
        context = ProcessingContext.from_defaults(speech_rate_enabled=False, zero_total_on_critical=False)
        raw = {"scores": {c["id"]: {"score": 1, "reason": "Выполнено"} for c in CHECKLIST}}
        raw["scores"]["2.2"] = {"score": 0, "reason": "Темп"}
        raw["scores"]["4.1"] = {"score": 0, "applicable": False, "reason": "Удержания не было"}
        raw["scores"]["5.2"]["score"] = 0
        raw["scores"]["extra"] = {"score": 1}
        result = normalize_result(raw, context)
        self.assertEqual(result["total"], 10)
        self.assertEqual(result["scores"]["2.2"]["score"], 1)
        self.assertEqual(result["scores"]["4.1"]["score"], 1)
        self.assertEqual(len(result["scores"]), 11)
        self.assertEqual(raw["scores"]["4.1"]["score"], 0)

    def test_invalid_or_missing_scores_are_not_published(self):
        for score in (0.25, True, "1", None):
            raw = {"scores": {c["id"]: {"score": 1, "reason": "OK"} for c in CHECKLIST}}
            raw["scores"]["1.1"]["score"] = score
            with self.subTest(score=score), self.assertRaises(ValueError):
                normalize_result(raw, ProcessingContext.from_defaults())
        raw["scores"]["1.1"]["score"] = 1
        raw["scores"]["5.2"]["score"] = 0.5
        with self.assertRaises(ValueError):
            normalize_result(raw, ProcessingContext.from_defaults())
