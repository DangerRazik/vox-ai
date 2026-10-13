import secrets
import subprocess
from contextlib import asynccontextmanager
from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Form, File, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.config import BackendSettings
from backend.database import Database
from backend.streams import StreamInput, StreamStore
from backend.batches import AudioProbeUnavailable, BatchStore, BatchConflict, UploadRejected
from backend.archives import ArchiveRejected, ArchiveStore


class CustomerInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=200)


class BatchInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stream_id: UUID
    upload_id: UUID


class ComparisonInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    batch_ids: list[UUID]

    @field_validator('batch_ids')
    @classmethod
    def distinct_batches(cls, value):
        ids = list(dict.fromkeys(value))
        if len(ids) < 2:
            raise ValueError('Select at least two distinct batches')
        return ids


@dataclass(frozen=True)
class Principal:
    customer_id: str | None = None
    is_admin: bool = False


def create_app(settings: BackendSettings | None = None) -> FastAPI:
    settings = settings or BackendSettings()
    database = Database(settings.database_path)
    streams = StreamStore(database, settings.materials_root)
    batches = BatchStore(database, streams, settings.inputs_root, settings.ffprobe_path)
    archives = ArchiveStore(batches)

    @asynccontextmanager
    async def lifespan(app):
        database.initialize()
        yield

    app = FastAPI(title="Vox AI", lifespan=lifespan)
    bearer = HTTPBearer(auto_error=False)

    @app.exception_handler(BatchConflict)
    async def batch_conflict(request, exc):
        return JSONResponse(status_code=409, content={"error": {
            "code": str(exc), "message": "Batch operation rejected", "details": {}}})

    @app.exception_handler(UploadRejected)
    async def rejected_file(request, exc):
        return JSONResponse(status_code=422, content={'error': {
            'code': exc.code, 'message': str(exc), 'details': {}}})

    @app.exception_handler(ArchiveRejected)
    async def rejected_archive(request, exc):
        return JSONResponse(status_code=422, content={'error': {
            'code': exc.code, 'message': str(exc), 'details': {'batch': exc.batch}}})

    @app.exception_handler(LookupError)
    async def missing_resource(request, exc):
        return JSONResponse(status_code=404, content={"error": {
            "code": "not_found", "message": "Resource not found", "details": {}}})

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request, exc):
        codes = {401: "unauthorized", 403: "forbidden", 404: "not_found", 503: "audio_probe_unavailable"}
        messages = {401: "API key is required or invalid", 403: "Administrative access required",
                    404: "Resource not found", 503: "Audio validation service unavailable"}
        return JSONResponse(status_code=exc.status_code, headers=exc.headers, content={
            "error": {"code": codes.get(exc.status_code, "request_error"),
                      "message": messages.get(exc.status_code, "Request rejected"), "details": {}},
        })

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Do not echo input bodies, headers or validation context (may contain secrets).
        return JSONResponse(status_code=422, content={
            "error": {"code": "invalid_request", "message": "Invalid request", "details": {}},
        })

    def authenticate(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        if credentials is None:
            raise HTTPException(401, headers={"WWW-Authenticate": "Bearer"})
        key = credentials.credentials
        if secrets.compare_digest(key.encode(), settings.admin_api_key.get_secret_value().encode()):
            return Principal(is_admin=True)
        customer_id = database.customer_for_key(key)
        if customer_id is None:
            raise HTTPException(401, headers={"WWW-Authenticate": "Bearer"})
        return Principal(customer_id=customer_id)

    def administrator(principal: Principal = Depends(authenticate)):
        if not principal.is_admin:
            raise HTTPException(403)
        return principal

    @app.get('/v1/access-context')
    def access_context(principal: Principal = Depends(authenticate)):
        customer = None
        if not principal.is_admin:
            owner = database.customers(principal.customer_id)[0]
            customer = {'customer_id': owner['customer_id'], 'name': owner['name']}
        return JSONResponse(content={
            'role': 'admin' if principal.is_admin else 'customer', 'customer': customer,
        }, headers={'Cache-Control': 'no-store'})

    @app.post("/v1/admin/customers", status_code=201)
    def create_customer(body: CustomerInput, principal: Principal = Depends(administrator)):
        return JSONResponse(status_code=201, content=database.create_customer(body.name),
                            headers={"Cache-Control": "no-store"})

    @app.get("/v1/admin/customers")
    def list_customers(principal: Principal = Depends(administrator)):
        return {"items": database.customers()}

    @app.get("/v1/customers/{customer_id}")
    def get_customer(customer_id: UUID, principal: Principal = Depends(authenticate)):
        customer_id = str(customer_id)
        if not principal.is_admin and customer_id != principal.customer_id:
            raise HTTPException(404)
        customers = database.customers(customer_id)
        if not customers:
            raise HTTPException(404)
        return customers[0]

    @app.get("/v1/batches")
    def list_batches(customer_id: UUID | None = None, stream_id: UUID | None = None,
                     status: str | None = None, principal: Principal = Depends(authenticate)):
        if not principal.is_admin and customer_id is not None and str(customer_id) != principal.customer_id:
            raise HTTPException(404)
        owner = str(customer_id) if principal.is_admin and customer_id else principal.customer_id
        return {"items": batches.list(owner, str(stream_id) if stream_id else None, status)}

    @app.post("/v1/batches", status_code=201)
    def create_batch(body: BatchInput, principal: Principal = Depends(authenticate)):
        if principal.is_admin:
            raise HTTPException(403)
        batch, created = batches.create(principal.customer_id, str(body.stream_id), str(body.upload_id))
        return JSONResponse(status_code=201 if created else 200, content=batch)

    @app.get("/v1/batches/{batch_id}")
    def get_batch(batch_id: UUID, principal: Principal = Depends(authenticate)):
        return batches.get(str(batch_id), principal.customer_id)

    @app.post('/v1/batch-archives')
    def upload_archive(stream_id: UUID = Form(...), upload_id: UUID = Form(...),
                       archive: UploadFile = File(...), metadata_file: UploadFile | None = File(None),
                       principal: Principal = Depends(authenticate)):
        if principal.is_admin:
            raise HTTPException(403)
        try:
            batch, created = archives.import_zip(principal.customer_id, str(stream_id), str(upload_id),
                archive.file, archive.filename or 'archive.zip', metadata_file.file if metadata_file else None)
            return JSONResponse(status_code=201 if created else 200, content=batch)
        except AudioProbeUnavailable:
            raise HTTPException(503)

    @app.post("/v1/batches/{batch_id}/files")
    def upload_call(batch_id: UUID, file: UploadFile = File(...),
                    external_employee_id: str | None = Form(None), called_at: str | None = Form(None),
                    principal: Principal = Depends(authenticate)):
        try:
            call, created = batches.add(str(batch_id), principal.customer_id, file.file,
                                        file.filename or "audio", external_employee_id, called_at)
            return JSONResponse(status_code=201 if created else 200, content=call)
        except AudioProbeUnavailable:
            raise HTTPException(503)
        except UploadRejected:
            raise
        except (ValueError, OSError, subprocess.SubprocessError) as exc:
            if isinstance(exc, BatchConflict):
                raise
            raise HTTPException(422)

    @app.post("/v1/batches/{batch_id}/complete")
    def complete_batch(batch_id: UUID, principal: Principal = Depends(authenticate)):
        return batches.complete(str(batch_id), principal.customer_id)

    @app.get('/v1/batches/{batch_id}/files')
    def list_files(batch_id: UUID, principal: Principal = Depends(authenticate)):
        return {'items': batches.files(str(batch_id), principal.customer_id)}

    @app.post("/v1/admin/batches/{batch_id}/start", status_code=202)
    def start_batch(batch_id: UUID, principal: Principal = Depends(administrator)):
        batch, started = batches.start(str(batch_id))
        return JSONResponse(status_code=202 if started else 200, content=batch)

    @app.post("/v1/admin/batches/{batch_id}/pause")
    def pause_batch(batch_id: UUID, principal: Principal = Depends(administrator)):
        return batches.pause(str(batch_id))

    @app.post("/v1/admin/batches/{batch_id}/resume")
    def resume_batch(batch_id: UUID, principal: Principal = Depends(administrator)):
        return batches.pause(str(batch_id), requested=False)

    @app.get("/v1/batches/{batch_id}/calls")
    def list_calls(batch_id: UUID, principal: Principal = Depends(authenticate)):
        return {"items": batches.calls(str(batch_id), principal.customer_id)}

    @app.get("/v1/batches/{batch_id}/report")
    def batch_report(batch_id: UUID, principal: Principal = Depends(authenticate)):
        return batches.report(str(batch_id), principal.customer_id)

    @app.post('/v1/streams/{stream_id}/comparisons')
    def compare_batches(stream_id: UUID, body: ComparisonInput,
                        principal: Principal = Depends(authenticate)):
        return batches.compare(str(stream_id), [str(batch_id) for batch_id in body.batch_ids],
                               principal.customer_id)

    @app.get('/v1/streams/{stream_id}/dashboard')
    def stream_dashboard(stream_id: UUID, principal: Principal = Depends(authenticate)):
        return batches.dashboard(str(stream_id), principal.customer_id)

    @app.get("/v1/calls/{call_id}/report")
    def call_report(call_id: UUID, principal: Principal = Depends(authenticate)):
        return batches.call_report(str(call_id), principal.customer_id)

    @app.get("/v1/admin/stream-defaults")
    def stream_defaults(principal: Principal = Depends(administrator)):
        from config import settings as processing_settings
        return {"whisper_prompt": processing_settings.WHISPER_PROMPT}

    @app.post("/v1/admin/customers/{customer_id}/streams", status_code=201)
    def create_stream(
        customer_id: UUID, config: str = Form(...), knowledge_base: UploadFile = File(...),
        text_corrections: UploadFile | None = File(None),
        unwanted_expressions: UploadFile | None = File(None),
        principal: Principal = Depends(administrator),
    ):
        try:
            parsed = StreamInput.model_validate_json(config)
            materials = {"knowledge_base": knowledge_base.file.read()}
            for kind, upload in (("text_corrections", text_corrections), ("unwanted_expressions", unwanted_expressions)):
                if upload is not None:
                    materials[kind] = upload.file.read()
            return streams.create(str(customer_id), parsed, materials)
        except LookupError:
            raise HTTPException(404)
        except ValueError:
            raise HTTPException(422)

    @app.get("/v1/streams")
    def list_streams(customer_id: UUID | None = None, principal: Principal = Depends(authenticate)):
        if not principal.is_admin and customer_id is not None and str(customer_id) != principal.customer_id:
            raise HTTPException(404)
        owner = str(customer_id) if principal.is_admin and customer_id is not None else principal.customer_id
        return {"items": streams.list(owner)}

    @app.get("/v1/streams/{stream_id}")
    def get_stream(stream_id: UUID, principal: Principal = Depends(authenticate)):
        try:
            return streams.public(streams.get(str(stream_id), principal.customer_id))
        except LookupError:
            raise HTTPException(404)

    @app.get("/v1/admin/streams/{stream_id}")
    def admin_stream(stream_id: UUID, principal: Principal = Depends(administrator)):
        try:
            return streams.get(str(stream_id))
        except LookupError:
            raise HTTPException(404)

    @app.delete('/v1/admin/streams/{stream_id}', status_code=204)
    def delete_stream(stream_id: UUID, principal: Principal = Depends(administrator)):
        batches.delete_stream(str(stream_id))

    return app
