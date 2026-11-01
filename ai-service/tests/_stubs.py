"""
Test helper: makes `import fastapi` work when FastAPI is not installed (the authoring sandbox has no network), so the
route functions can be called directly. If real FastAPI is installed it is used untouched.
These stubs only model what the routes use (decorators, HTTPException, File/Form/Header markers).
"""
import sys
import types


def install_fastapi_stub():
    try:
        import fastapi  # noqa: F401
        return False
    except ImportError:
        pass

    mod = types.ModuleType("fastapi")

    class HTTPException(Exception):
        def __init__(self, status_code, detail=None):
            super().__init__(str(detail))
            self.status_code, self.detail = status_code, detail

    class APIRouter:
        def __init__(self, *a, **k):
            pass

        def post(self, *a, **k):
            return lambda fn: fn
        get = post
        delete = post

    class UploadFile:
        def __init__(self, data=b"", filename="a.webm", content_type="audio/webm"):
            self._data, self.filename, self.content_type, self._pos = data, filename, content_type, 0

        async def read(self, n=-1):
            chunk = self._data[self._pos:] if n < 0 else self._data[self._pos:self._pos + n]
            self._pos += len(chunk)
            return chunk

    mod.HTTPException, mod.APIRouter, mod.UploadFile = HTTPException, APIRouter, UploadFile
    mod.File = mod.Form = mod.Header = lambda *a, **k: (a[0] if a else None)
    sys.modules["fastapi"] = mod

    # Pieces of fastapi that other modules import
    mw = types.ModuleType("fastapi.middleware")
    cors = types.ModuleType("fastapi.middleware.cors")
    cors.CORSMiddleware = object
    sys.modules["fastapi.middleware"], sys.modules["fastapi.middleware.cors"] = mw, cors
    return True
