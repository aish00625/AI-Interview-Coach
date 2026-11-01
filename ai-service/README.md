# AI Interview Coach — AI Service (Python / FastAPI)

Stateless evaluation service. Receives a question/answer pair from the
Node backend and returns a scored evaluation as JSON — nothing more. Per
the project architecture, **this service never connects to PostgreSQL**;
only Node does that. It also never talks to React directly — every
request comes from Node's `services/aiServiceClient.js`.

## What this is — and isn't

This is a **local NLP-based semantic and concept matching evaluator**,
combining a few classical, explainable techniques:
- keyword/concept matching against a small local reference bank
- TF-IDF + cosine similarity for a semantic-overlap signal
- sentence-length-based clarity heuristics
- answer-length-based completeness heuristics

**It is NOT a large language model.** It doesn't "understand" an answer
the way an LLM does — it can't tell a correct explanation phrased
unusually from a confident-sounding wrong one. It's deterministic (same
input → same output, always) and fully explainable (every score traces
back to a specific, readable rule in `app/services/evaluator.py`), which
is a deliberate trade-off in exchange for not requiring a paid external
API or GPU.

## Setup

```bash
cd ai-service
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt            # core: text evaluation only (small, always works)
pip install -r requirements-speech.txt     # voice answers: faster-whisper (the model, ~460 MB for "small", downloads on first use)
pip install -r requirements-vision.txt     # optional: webcam analysis (face presence; head/gaze need one more small file)
cp .env.example .env
uvicorn app.main:app --port 8000
python -m app.diagnostics                  # checks the speech model really loads and transcribes (run this once)
python -m app.diagnostics --download-vision-model   # optional: fetches MediaPipe's face-landmark file for head/gaze
```

The three requirement files are separate on purpose: the text evaluator must keep working on a machine where the
speech or vision packages fail to install. `GET /capabilities` reports exactly what this installation can do.

Runs on `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

## Why these dependencies (and not others)

- **scikit-learn + numpy** — TF-IDF vectorization and cosine similarity, both proven, well-documented, and CPU-only.
- **No NLTK** — NLTK's tokenizer/stopword data requires a separate `nltk.download(...)` step (network access or manual setup on first run). Tokenization and stopword filtering here are plain Python (regex + a hardcoded list) in `app/utils/text_processing.py` — works completely offline, no download step.
- **No textstat / heavier readability libraries** — clarity is scored with a simple sentence-length heuristic instead, kept in-house so there's one fewer dependency that could fail to install.
- **No LLM / transformers / paid API** — by design, per the project requirements. See "What this is — and isn't" above.

## Endpoints

### `GET /health`
```json
{ "status": "ok", "service": "ai-service" }
```
No authentication required.

### `POST /evaluate`
Requires header `X-AI-Service-Key: <key>` matching `AI_SERVICE_API_KEY` in
`.env` — requests without it (or with the wrong value) get `401`. This is
a shared secret between Node and this service, not a user-auth system;
Node has already verified the end user's JWT before ever calling this.

Request:
```json
{
  "question": "What are the four main principles of Object-Oriented Programming?",
  "answer": "Encapsulation, inheritance, polymorphism, and abstraction.",
  "target_role": "Software Engineer",
  "difficulty": "medium",
  "interview_type": "technical"
}
```
`answer` defaults to `""` if omitted; `target_role`/`difficulty`/`interview_type`
are optional and currently don't change scoring (accepted for future use,
not silently ignored — see the docstring on `evaluate_answer`).

Response (camelCase, matching the Node/`interview_answers` contract exactly):
```json
{
  "technicalScore": 85,
  "relevanceScore": 78,
  "clarityScore": 90,
  "completenessScore": 82,
  "strengths": ["Your answer covered the key concepts."],
  "weaknesses": ["Consider adding a concrete example to strengthen your answer further."],
  "suggestedImprovement": "Focus more directly on what the question is actually asking.",
  "modelAnswer": "Object-Oriented Programming is based on four main principles: ..."
}
```

### `POST /speech-evaluate` — requires `X-AI-Service-Key: <key>`

Multipart/form-data (not JSON) — an audio file plus form fields:

```text
audio            (file, required)  the recorded answer
question         (text, required)
target_role      (text, optional)
difficulty       (text, optional)
interview_type   (text, optional)
```

Accepted audio content types: `audio/webm`, `video/webm` (some browsers
label a webm/opus audio-only blob this way), `audio/wav`, `audio/mpeg`,
`audio/mp4`/`audio/m4a`, `audio/ogg` — matched with any `;codecs=...`
suffix stripped. Anything else is rejected with `415`. Files over
`MAX_AUDIO_BYTES` (10 MB default) are rejected with `413`, checked while
streaming in rather than trusting a `Content-Length` header.

Response — the same 8 fields as `/evaluate`, plus a transcript and speech metrics:
```json
{
  "transcript": "Encapsulation, inheritance, polymorphism, and abstraction.",
  "technicalScore": 85, "relevanceScore": 78, "clarityScore": 90, "completenessScore": 82,
  "strengths": ["..."], "weaknesses": ["..."],
  "suggestedImprovement": "...", "modelAnswer": "...",
  "speechMetrics": {
    "durationSeconds": 6.2, "wordCount": 8, "speakingRateWpm": 77.4,
    "fillerWordCount": 0, "fillerWords": {},
    "pauseCount": null, "averagePauseSeconds": null
  }
}
```
`pauseCount`/`averagePauseSeconds` are `null` — not `0` — whenever pause
detection isn't available (fewer than 2 speech segments, or speech-to-text
itself unavailable). A `0` would mean "measured zero pauses"; `null` means
"couldn't measure this." Never conflate the two.

If speech-to-text can't run at all (package/model unavailable, or
transcription itself throws), this returns `503` — **never a fabricated
transcript**.

## Evaluation methodology

1. **Reference matching** — `find_reference()` looks for a local reference-bank entry whose `match_keywords` appear in the question text (keyword overlap, not exact string equality, so minor wording differences don't break the match). The bank currently covers 5 topics (OOP, DBMS normalization, process vs. thread, binary search, JS `var`/`let`/`const`) and is a flat list — add an entry with `match_keywords`/`concepts`/`model_answer` to support another question.
2. **If a reference is found:**
   - `technicalScore` = % of the reference's key concepts present in the answer (substring match)
   - `relevanceScore` = blend of TF-IDF cosine similarity (answer vs. question+concepts) and concept coverage — pure TF-IDF on short texts is noisy on its own, so coverage anchors it
   - `completenessScore` = blend of concept coverage and answer length relative to a ~40-word target
   - `clarityScore` = sentence-length heuristic (words per sentence), independent of correctness
3. **If no reference matches** — falls back to generic question/answer keyword overlap and TF-IDF similarity instead of concept coverage, and says so explicitly in `modelAnswer` (`"No reference model answer is available for this question yet."`) rather than pretending there's a known correct answer.
4. **Strengths/weaknesses/suggestion** are generated from which specific score is highest/lowest and why (e.g. "Your answer missed some important concepts: X, Y" names the actual missing concepts) — never generic text unrelated to the actual answer. The single `suggestedImprovement` targets whichever of the four scores is weakest.
5. **Empty answer** short-circuits to all-zero scores and a "no answer was submitted" weakness, without running any of the above.

## Speech processing

```text
audio (multipart) -> audio_quality.py   decode, loudness / silence / clipping checks, quiet-audio boost
                  -> speech_processor.py faster-whisper: beam search, VAD, language hint, word timestamps
                                         drop non-speech segments, silence-hallucination filter
                                         compute_speech_metrics (schema v2), transcript_confidence
                  -> evaluator.py        the SAME evaluator used for typed answers, applied to the transcript
```

### Why transcription used to be inaccurate, and what changed

| Cause | Change |
|---|---|
| Greedy decoding | Beam search (`SPEECH_BEAM_SIZE`, default 5) |
| Small default model (`base`) | Default `small` (`SPEECH_MODEL_SIZE`); `medium` is more accurate and much slower |
| No language hint (accented English could be detected as another language) | `SPEECH_LANGUAGE=en` |
| Silence/noise produced invented text | VAD filter, silence checks before decoding, and a hallucination filter |
| Technical words mis-heard | A short `initial_prompt` listing common interview vocabulary (`SPEECH_INITIAL_PROMPT`) |
| Very quiet recordings | Loudness check, automatic boost up to 20 dB, and a clear "too quiet" message when that is not enough |

None of this makes transcription perfect. The service reports a **transcript confidence** (`high | medium | low | unknown`)
taken from the recogniser's own word probabilities. It is a certainty heuristic, **not a word-error-rate**, and is shown
to the candidate so a doubtful transcript is not trusted blindly.

### The `/speech-evaluate` 503, and the error contract

The old behaviour loaded the model lazily on the first request (slow, and timed out the caller), and failures were all
reported as one generic 503. Now the model preloads at start-up (`SPEECH_PRELOAD`), and every failure has a stable reason:

| HTTP | `detail.reason` | Meaning |
|---|---|---|
| 401 | - | wrong `X-AI-Service-Key` |
| 400 | `audio_empty` | empty upload |
| 413 | `audio_too_large` | over `MAX_AUDIO_BYTES` |
| 415 | `unsupported_media` | not an audio type |
| 422 | `audio_unreadable`, `audio_too_short`, `audio_too_long`, `no_speech_detected` | the recording can't be used (record again) |
| 503 | `speech_package_missing` | `faster-whisper` not installed (not retryable) |
| 503 | `speech_model_loading` | still loading (retryable) |
| 503 | `speech_model_unavailable` | download/load failed (retryable after a cooldown) |
| 503 | `speech_transcription_failed` | the engine raised while decoding |
| 500 | `processing_failed` | unexpected; no internals leaked |

A 503 body is `{"detail": {"reason", "message", "retryable"}}`. Nothing is ever scored or stored from a failed transcription.

### Speech metrics (schema v2) - measurements, not judgements

Everything is a count or timing; values that cannot be measured reliably are `null`, never `0`.
`speakingRateWpm` (words / total duration), `articulationRateWpm` (words / speech time, excluding long pauses),
`fillerWordCount` (lexical list), `disfluencyCount` / `disfluencyRatePer100Words` (fillers plus repeated words,
excluding discourse markers like "so" or "I mean" that are normal speech), `pauseCount`, `averagePauseSeconds`,
`longPauseCount`, `longestPauseSeconds` (from word-level timestamps; `pauseBasis` says which), `timeToFirstWordSeconds`,
`transcriptConfidence`, `audioQuality`, `reliable` and `unreliableReasons`. Pace needs at least a few seconds of speech,
so very short answers have `speakingRateWpm: null`.

### Audio handling security

- Audio is read in bounded chunks with a hard size cap rather than trusting `Content-Length`.
- Written to a temp file with a random name inside a fresh temp directory and removed on every path, success or failure.
- No shell commands are built from the filename or audio content; decoding uses PyAV bundled with `faster-whisper`
  (no separate `ffmpeg` is needed).
- Same `X-AI-Service-Key` check as `/evaluate`; raw audio and transcripts are not logged.

## Video / webcam analysis

`POST /vision-evaluate` samples frames evenly across the **whole** clip (an adaptive stride, so browser WebM files,
which often have no duration or frame count, are not analysed only at their start) and reports face presence; head
direction and gaze additionally need the MediaPipe `.task` file (`python -m app.diagnostics --download-vision-model`).
The response includes `framesInClip` and `clipTruncated`. Only measurable signals are returned: no emotion, attention,
confidence or personality inference. Without OpenCV the endpoint returns 503 `vision_unavailable`.

## Capabilities

`GET /capabilities` (needs the API key) returns `speech.state` (`not_loaded | loading | ready | error`, plus the error
code/message) and `vision.state` (`complete | face_presence_only | unavailable`). It never loads a model.

## Failure handling

The AI service has no database and calls nothing external except the one-time model downloads. Node's
`aiServiceClient.js` forwards the structured `reason` / `retryable` above (and distinguishes "unreachable" from
"timed out" and a wrong API key), so the candidate sees what actually went wrong. There is no "fake AI score" fallback
anywhere in the pipeline.

## Security

- `X-AI-Service-Key` shared-secret header, checked on every `/evaluate` call.
- CORS (`ALLOWED_ORIGINS` in `.env`) is defense-in-depth for hitting `/docs`
  from a browser locally — normal Node→Python traffic is server-to-server
  and isn't subject to browser CORS rules at all.
- No request logging of full answer text is set up here (uvicorn's
  default access log only logs the path/status, not the body) — avoid
  adding a logging line that dumps `payload.answer` if you extend this.
- `/speech-evaluate` never logs raw audio bytes or the transcript beyond
  uvicorn's own access log (path/status only).

## Verification status

- **Unit-tested without any model** (`python -m unittest discover -s tests`): audio checks, speech metrics, confidence,
  transcript filtering, the route's error mapping, the video sampler, and the diagnostics tool, using a fake Whisper model.
- **Not verifiable outside a real machine**: actual transcription accuracy and the model download. Run
  `python -m app.diagnostics` after installing `requirements-speech.txt`; it synthesises a test clip, loads the real model
  and reports pass/fail.
