"""Provider-reported token counts; no prompt or response content is retained."""
from contextlib import contextmanager
from contextvars import ContextVar

_current = ContextVar("vox_usage", default=None)


def _count(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _tokens(usage):
    if hasattr(usage, "model_dump"):
        usage = usage.model_dump()
    if not isinstance(usage, dict):
        return None
    total = _count(usage.get("total_tokens"))
    if total is not None:
        return total
    incoming = _count(usage.get("input_tokens", usage.get("prompt_tokens")))
    outgoing = _count(usage.get("output_tokens", usage.get("completion_tokens")))
    return incoming + outgoing if incoming is not None and outgoing is not None else None


class UsageTotals:
    def __init__(self):
        self.calls = []

    @contextmanager
    def collect(self):
        token = _current.set(self)
        try:
            yield self
        finally:
            _current.reset(token)

    def summary(self, *stages):
        counts = [tokens for stage, tokens in self.calls if stage in stages]
        missing = sum(value is None for value in counts)
        reported = sum(value for value in counts if value is not None)
        return {"requests": len(counts), "total_tokens": None if missing else reported,
                "reported_tokens": reported, "unreported_requests": missing}


class UsageRequest:
    def __init__(self):
        self.tokens = None

    def capture(self, usage):
        try:
            self.tokens = _tokens(usage)
        except Exception:
            # Invalid accounting metadata must not turn a valid model response into a failed call.
            self.tokens = None


@contextmanager
def usage_request(stage):
    collector = _current.get()
    request = UsageRequest()
    try:
        yield request
    finally:
        if collector is not None:
            collector.calls.append((stage, request.tokens))
