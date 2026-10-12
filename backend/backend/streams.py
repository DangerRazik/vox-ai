import hashlib
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from string import Formatter
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.database import Database
from checklist import CHECKLIST
from kb import load_knowledge_base
from processing_context import ProcessingContext


class StreamInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)

    name: str = Field(min_length=1, max_length=200)
    whisper_model: str = Field(min_length=1, max_length=200)
    llm_model: str = Field(min_length=1, max_length=200)
    speech_lang: str = Field(min_length=1, max_length=30)
    whisper_prompt: str = Field(default="", max_length=100000)
    role_prompt: str = Field(min_length=1, max_length=100000)
    analysis_system_prompt: str = Field(min_length=1, max_length=100000)
    analysis_user_prompt: str = Field(min_length=1, max_length=100000)
    long_pause_sec: float = Field(default=2.0, ge=0)
    interruption_gap_sec: float = Field(default=0.2, ge=0)
    text_correction_enabled: bool = False
    unwanted_expressions_enabled: bool = False
    speech_rate_enabled: bool = True
    zero_total_on_critical: bool = True
    enabled_criteria: list[str] = Field(default_factory=lambda: [c['id'] for c in CHECKLIST], min_length=1, max_length=11)

    @model_validator(mode="after")
    def valid_criteria(self):
        selected = self.enabled_criteria
        if len(set(selected)) != len(selected) or set(selected) - {c['id'] for c in CHECKLIST}:
            raise ValueError('Unsupported or duplicate criterion')
        self.enabled_criteria = [c['id'] for c in CHECKLIST if c['id'] in selected]
        if '5.2' not in selected:
            self.zero_total_on_critical = False
        return self

    @model_validator(mode="before")
    @classmethod
    def source_defaults(cls, value):
        # Full configurations from existing API clients remain supported. The UI
        # sends only editable settings; missing technical values come from Python.
        fields = ("whisper_model", "llm_model", "speech_lang", "role_prompt",
                  "analysis_system_prompt", "analysis_user_prompt", "whisper_prompt")
        if isinstance(value, dict) and any(field not in value for field in fields):
            defaults = ProcessingContext.from_defaults()
            return {**{field: getattr(defaults, field) for field in fields}, **value}
        return value

    @model_validator(mode="after")
    def valid_templates(self):
        for template, required in ((self.role_prompt, {"fragments"}),
                                   (self.analysis_user_prompt, {"checklist", "kb", "metrics", "dialog"})):
            fields = set()
            for _, field, spec, conversion in Formatter().parse(template):
                if field is not None:
                    if field not in required or spec or conversion:
                        raise ValueError("Unsupported prompt placeholder")
                    fields.add(field)
            if fields != required:
                raise ValueError("Missing prompt placeholder")
        return self


def parse_dictionary(raw: bytes, corrections: bool):
    def unique_pairs(pairs):
        result = {}
        for key, item in pairs:
            if key in result:
                raise ValueError("Duplicate dictionary key")
            result[key] = item
        return result

    value = json.loads(raw.decode("utf-8-sig"), object_pairs_hook=unique_pairs)
    if corrections:
        if not isinstance(value, dict) or not value or any(
            not isinstance(k, str) or not k.strip() or not isinstance(v, str) or not v.strip()
            for k, v in value.items()
        ):
            raise ValueError("Corrections must be a nonempty string mapping")
    elif not isinstance(value, list) or not value or any(not isinstance(v, str) or not v.strip() for v in value):
        raise ValueError("Expressions must be a nonempty string list")
    return value


class StreamStore:
    """Write-once snapshots. Files are durable before the stream becomes visible in SQLite."""

    def __init__(self, database: Database, root: Path):
        self.database = database
        self.root = root.resolve()

    def create(self, customer_id: str, config: StreamInput, materials: dict[str, bytes]):
        if not self.database.customers(customer_id):
            raise LookupError("Customer not found")
        if "knowledge_base" not in materials or set(materials) - {
            "knowledge_base", "text_corrections", "unwanted_expressions",
        }:
            raise ValueError("Unsupported or missing stream material")
        corrections = materials.get("text_corrections")
        expressions = materials.get("unwanted_expressions")
        if config.text_correction_enabled and corrections is None:
            raise ValueError("Corrections required")
        if config.unwanted_expressions_enabled and expressions is None:
            raise ValueError("Expressions required")
        if corrections is not None:
            parse_dictionary(corrections, True)
        if expressions is not None:
            parse_dictionary(expressions, False)
        # The existing reader supports textual UTF-8/HTML, not binary Word documents.
        raw = materials["knowledge_base"]
        text = raw.decode("utf-8-sig")
        if not text.strip() or "\x00" in text:
            raise ValueError("Knowledge base must be textual UTF-8")
        stream_id = str(uuid4())
        directory = self.root / stream_id
        directory.mkdir(parents=True, exist_ok=False)
        try:
            metadata = {}
            for kind, content in materials.items():
                path = directory / kind
                with path.open("xb") as file:
                    file.write(content)
                    file.flush()
                    os.fsync(file.fileno())
                metadata[kind] = {"sha256": hashlib.sha256(content).hexdigest(), "size_bytes": len(content)}
            if not load_knowledge_base(str(directory / "knowledge_base")):
                raise ValueError("Empty knowledge base after cleanup")
            snapshot = {"config": config.model_dump(), "materials": metadata,
                        "criteria": [{"id": c["id"], "title": c["title"]} for c in CHECKLIST
                                     if c['id'] in config.enabled_criteria]}
            created_at = datetime.now(timezone.utc).isoformat()
            with self.database.connection() as connection:
                connection.execute("INSERT INTO streams VALUES (?, ?, ?, ?, ?)",
                                   (stream_id, customer_id, config.name, created_at, json.dumps(snapshot, ensure_ascii=False)))
        except Exception:
            shutil.rmtree(directory)
            raise
        return self.get(stream_id, customer_id)

    def get(self, stream_id: str, customer_id: str | None = None):
        query = "SELECT * FROM streams WHERE id = ?"
        parameters = [stream_id]
        if customer_id is not None:
            query += " AND customer_id = ?"
            parameters.append(customer_id)
        with self.database.connection() as connection:
            row = connection.execute(query, parameters).fetchone()
        if row is None:
            raise LookupError("Stream not found")
        return {"stream_id": row["id"], "customer_id": row["customer_id"], "name": row["name"],
                "created_at": row["created_at"], **json.loads(row["snapshot"])}

    @staticmethod
    def public(stream):
        config = stream["config"]
        return {key: stream[key] for key in ("stream_id", "customer_id", "name", "created_at", "criteria")} | {
            "whisper_model": config["whisper_model"], "llm_model": config["llm_model"],
            "speech_lang": config["speech_lang"],
            "options": {key: config[key] for key in ("text_correction_enabled", "unwanted_expressions_enabled",
                                                    "speech_rate_enabled", "zero_total_on_critical")},
        }

    def list(self, customer_id=None):
        with self.database.connection() as connection:
            rows = connection.execute(
                "SELECT id FROM streams" + (" WHERE customer_id = ?" if customer_id is not None else "") +
                " ORDER BY created_at, id", (customer_id,) if customer_id is not None else (),
            ).fetchall()
        return [self.public(self.get(row["id"], customer_id)) for row in rows]

    def load_context(self, stream_id: str, customer_id: str) -> ProcessingContext:
        stream = self.get(stream_id, customer_id)
        config = dict(stream["config"])
        config.pop("name")
        directory = self.root / stream["stream_id"]
        content = {}
        for kind, metadata in stream["materials"].items():
            raw = (directory / kind).read_bytes()
            if hashlib.sha256(raw).hexdigest() != metadata["sha256"]:
                raise ValueError("Stream material integrity check failed")
            content[kind] = raw
        return ProcessingContext(
            kb_path=str(directory / "knowledge_base"), **config,
            whisper_fixes=parse_dictionary(content["text_corrections"], True) if config["text_correction_enabled"] else {},
            unwanted_expressions=tuple(parse_dictionary(content["unwanted_expressions"], False))
            if config["unwanted_expressions_enabled"] else (),
        )
