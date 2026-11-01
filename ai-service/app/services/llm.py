"""
Thin client for a LOCAL Ollama server (free, runs on this machine, no API key, no paid service).

Uses only the standard library (urllib), so it adds no dependency to the AI service. Everything that can go wrong maps
to a LlmError with a stable machine-readable `code`, a message written for the end user, and a `retryable` flag - the
routes forward those and the Node backend falls back to the rule-based behaviour.

What this module does NOT do: it never decides anything. It returns text/JSON that callers validate (see
llm_tasks.py) and that the backend labels as advisory, AI-generated feedback.
"""
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from app import config

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", "[::1]"}


class LlmError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


_slots = threading.BoundedSemaphore(config.LLM_MAX_CONCURRENT)
_status_cache: Dict[str, Any] = {"at": 0.0, "value": None}


def _base_url() -> str:
    url = config.OLLAMA_BASE_URL
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise LlmError("llm_misconfigured", "OLLAMA_BASE_URL is not a valid http(s) URL.", False)
    if not config.LLM_ALLOW_REMOTE and parsed.hostname not in LOOPBACK_HOSTS:
        raise LlmError(
            "llm_misconfigured",
            "OLLAMA_BASE_URL points to another machine. Interview data would leave this computer, so this is blocked "
            "unless LLM_ALLOW_REMOTE=true is set deliberately.",
            False,
        )
    return url


def _ollama_error_text(body: str) -> str:
    """Ollama's own error message (it describes the machine, never the interview), shortened and single-line."""
    try:
        data = json.loads(body)
        text = data.get("error") if isinstance(data, dict) else None
    except ValueError:
        text = None
    text = text if isinstance(text, str) else ""
    return re.sub(r"\s+", " ", text).strip()[:200]


def _request(path: str, payload: Optional[dict], timeout: float) -> Any:
    url = _base_url() + path
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="GET" if data is None else "POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # nosec - URL is validated to be loopback by default
            raw = resp.read(8 * 1024 * 1024)
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read(2000).decode("utf-8", "replace")
        except Exception:
            pass
        if e.code == 404 and "model" in body.lower():
            raise LlmError("llm_model_missing", f"The model '{config.LLM_MODEL}' is not installed in Ollama. Run: ollama pull {config.LLM_MODEL}", False)
        detail = _ollama_error_text(body)
        low = detail.lower()
        if "more system memory" in low or "out of memory" in low or "insufficient memory" in low:
            raise LlmError("llm_out_of_memory", f"Ollama could not load '{config.LLM_MODEL}' because this computer has too little free memory ({detail}). Close other programs or use a smaller model, e.g. ollama pull qwen3:1.7b, then set LLM_MODEL in ai-service/.env.", False)
        if "runner process" in low or "terminated" in low or "exit status" in low:
            raise LlmError("llm_error", f"The local model crashed while answering ({detail}). Restart Ollama; if it repeats, use a smaller model.", True)
        suffix = f": {detail}" if detail else ""
        raise LlmError("llm_error", f"Ollama returned an error (HTTP {e.code}){suffix}", e.code >= 500)
    except (TimeoutError, urllib.error.URLError, ConnectionError, OSError) as e:
        reason = getattr(e, "reason", e)
        if isinstance(reason, TimeoutError) or "timed out" in str(reason).lower():
            raise LlmError("llm_timeout", "The local AI model took too long to answer. A smaller model or a shorter answer can help.", True)
        raise LlmError("llm_unreachable", "The local AI model (Ollama) is not running. Start Ollama and try again.", True)
    try:
        return json.loads(raw.decode("utf-8"))
    except ValueError:
        raise LlmError("llm_bad_response", "Ollama sent a response that could not be read.", True)


def status(force: bool = False, timeout: Optional[float] = None) -> Dict[str, Any]:
    """Cheap health check (cached for a few seconds). Never raises."""
    now = time.monotonic()
    if not force and _status_cache["value"] is not None and now - _status_cache["at"] < 5:
        return _status_cache["value"]
    base = {"enabled": config.LLM_ENABLED, "model": config.LLM_MODEL, "provider": "ollama"}
    if not config.LLM_ENABLED:
        value = {**base, "state": "disabled", "message": "The local AI model is switched off (LLM_ENABLED=false)."}
    else:
        try:
            tags = _request("/api/tags", None, timeout or config.LLM_STATUS_TIMEOUT_SECONDS)
            names = [m.get("name") for m in (tags.get("models") or []) if isinstance(m, dict) and isinstance(m.get("name"), str)]
            wanted = config.LLM_MODEL
            present = wanted in names or (":" not in wanted and any(n.split(":")[0] == wanted for n in names))
            if present:
                value = {**base, "state": "ready", "installedModels": names[:20]}
            else:
                value = {**base, "state": "model_missing", "installedModels": names[:20],
                         "message": f"Ollama is running but '{wanted}' is not installed. Run: ollama pull {wanted}"}
        except LlmError as e:
            value = {**base, "state": "unreachable" if e.code in ("llm_unreachable", "llm_timeout") else "error", "code": e.code, "message": e.message}
    _status_cache.update(at=now, value=value)
    return value


_THINK = re.compile(r"<think>.*?</think>", re.S)


def extract_json(text: str) -> Any:
    """Parses the first JSON object in the model output (models sometimes wrap it in prose or code fences)."""
    text = _THINK.sub("", text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", text).strip()
    try:
        return json.loads(text)
    except ValueError:
        pass
    start = text.find("{")
    while start != -1:
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except ValueError:
                        break
        start = text.find("{", start + 1)
    raise LlmError("llm_bad_response", "The local AI model did not return structured feedback. Please try again.", True)


_NO_THINK_MODELS = ("qwen3", "deepseek-r1", "qwq")


def _prepare_messages(messages: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """qwen3-style models also honour a '/no_think' soft switch, which keeps working on Ollama versions that ignore the
    `think` request field. Without it the hidden reasoning would eat the output budget and cut the JSON off."""
    if not config.LLM_MODEL.lower().startswith(_NO_THINK_MODELS):
        return messages
    out = [dict(m) for m in messages]
    for m in out:
        if m.get("role") == "system":
            m["content"] = m["content"] + " /no_think"
            break
    return out


def _generate(messages: List[Dict[str, str]], schema: Optional[dict], max_tokens: int) -> Any:
    payload = {
        "model": config.LLM_MODEL,
        "messages": _prepare_messages(messages),
        "stream": False,
        "think": False,  # skip the hidden reasoning pass: it only costs time and tokens here
        "format": schema or "json",
        "options": {
            "temperature": config.LLM_TEMPERATURE,
            "num_predict": max_tokens,
            "num_ctx": config.LLM_CONTEXT_TOKENS,
        },
    }
    try:
        body = _request("/api/chat", payload, config.LLM_TIMEOUT_SECONDS)
    except LlmError as e:
        # A model that does not know the `think` option can answer 400; try once more without it.
        if e.code == "llm_error" and "HTTP 400" in e.message:
            payload.pop("think", None)
            body = _request("/api/chat", payload, config.LLM_TIMEOUT_SECONDS)
        elif e.code == "llm_error" and "HTTP 5" in e.message and isinstance(payload.get("format"), dict):
            # Some Ollama versions fail (HTTP 500) while turning a JSON schema into a grammar. Plain JSON mode still works:
            # the prompt states the shape and every caller validates the result, so retry once that way.
            payload["format"] = "json"
            body = _request("/api/chat", payload, config.LLM_TIMEOUT_SECONDS)
        else:
            raise
    msg = body.get("message") if isinstance(body, dict) else None
    content = msg.get("content") if isinstance(msg, dict) else None  # a separate `thinking` field is deliberately ignored
    if not isinstance(content, str) or not content.strip():
        raise LlmError("llm_bad_response", "The local AI model returned an empty answer. Please try again.", True)
    try:
        return extract_json(content)
    except LlmError:
        if isinstance(body, dict) and body.get("done_reason") == "length":
            raise LlmError("llm_bad_response", "The local AI model ran out of room before finishing its answer. Trying again usually works.", True)
        raise


def chat_json(messages: List[Dict[str, str]], schema: Optional[dict] = None, max_tokens: Optional[int] = None) -> Any:
    """One generation, parsed as JSON. Raises LlmError. Concurrency-limited so a CPU-only machine is not overloaded.
    A reply that is cut off or not valid JSON is retried ONCE with a bigger budget; timeouts and outages are not retried."""
    if not config.LLM_ENABLED:
        raise LlmError("llm_disabled", "The local AI model is switched off (LLM_ENABLED=false).", False)
    if not _slots.acquire(timeout=config.LLM_QUEUE_WAIT_SECONDS):
        raise LlmError("llm_busy", "The local AI model is busy with another request. Please try again in a moment.", True)
    try:
        budget = max_tokens or config.LLM_MAX_OUTPUT_TOKENS
        try:
            return _generate(messages, schema, budget)
        except LlmError as e:
            if e.code != "llm_bad_response":
                raise
            return _generate(messages, schema, int(budget * 1.5))
    finally:
        _slots.release()
