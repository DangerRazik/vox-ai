import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from usage_metrics import UsageTotals, usage_request
from processing_context import ProcessingContext


class UsageTests(unittest.TestCase):
    def test_partial_and_duration_usage_do_not_become_zero_tokens(self):
        usage = UsageTotals()
        with usage.collect():
            with usage_request('whisper') as r: r.capture({'type':'duration','seconds':20})
            with usage_request('llm_analysis') as r: r.capture({'prompt_tokens':100,'completion_tokens':25})
            with usage_request('llm_roles'): pass
        self.assertIsNone(usage.summary('whisper')['total_tokens'])
        self.assertEqual(usage.summary('llm_roles','llm_analysis'), {'requests':2,'total_tokens':None,'reported_tokens':125,'unreported_requests':1})
        self.assertEqual(usage.summary('unused')['total_tokens'], 0)

    def test_collectors_are_isolated_between_workers_and_reset_after_exit(self):
        def collect(value):
            usage=UsageTotals()
            with usage.collect():
                with usage_request('whisper') as r: r.capture({'total_tokens':value})
            with usage_request('whisper') as r: r.capture({'total_tokens':999})
            return usage.summary('whisper')['total_tokens']
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(list(pool.map(collect,[10,20])),[10,20])

    def test_failed_request_counts_as_unreported(self):
        usage=UsageTotals()
        with usage.collect():
            with self.assertRaises(RuntimeError):
                with usage_request('llm_analysis'): raise RuntimeError('network failure')
        self.assertEqual(usage.summary('llm_analysis')['unreported_requests'],1)

    def test_actual_service_boundaries_capture_whisper_and_both_llm_calls(self):
        from transcriber import transcribe, assign_roles
        from analyzer import _call_llm
        context=ProcessingContext.from_defaults()
        usage=UsageTotals()
        payload={'segments':[{'start':0,'end':1,'speaker':'A','text':'Добрый день'},{'start':1,'end':2,'speaker':'B','text':'Здравствуйте'}],'usage':{'total_tokens':50}}
        with tempfile.TemporaryDirectory() as directory:
            audio=Path(directory)/'call.mp3'; audio.write_bytes(b'test audio')
            with usage.collect(), patch('transcriber.httpx.Client') as client:
                client.return_value.__enter__.return_value.post.return_value.json.return_value=payload
                segments=transcribe(str(audio),context)
            with usage.collect(), patch('transcriber.OpenAI') as roles:
                roles.return_value.chat.completions.create.return_value=SimpleNamespace(usage={'total_tokens':20},choices=[SimpleNamespace(message=SimpleNamespace(content='{"operator":"A","client":"B"}'))])
                assign_roles(segments,context)
            with usage.collect(), patch('analyzer.OpenAI') as llm:
                llm.return_value.chat.completions.create.return_value=SimpleNamespace(usage={'prompt_tokens':100,'completion_tokens':30},choices=[SimpleNamespace(message=SimpleNamespace(content='{}'))])
                self.assertEqual(_call_llm('prompt',context),'{}')
        self.assertEqual(usage.summary('whisper')['total_tokens'],50)
        self.assertEqual(usage.summary('llm_roles','llm_analysis')['total_tokens'],150)
