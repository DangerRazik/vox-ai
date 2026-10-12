from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class BackendSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VOX_", env_file=".env", extra="ignore")

    database_path: Path = Field(default=Path("data/vox.sqlite3"))
    materials_root: Path = Field(default=Path("data/streams"))
    inputs_root: Path = Field(default=Path("data/inputs"))
    worker_lock: Path = Field(default=Path("data/worker.lock"))
    ffprobe_path: str = "ffprobe"
    admin_api_key: SecretStr = Field(min_length=24)