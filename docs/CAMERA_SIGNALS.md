# Camera signals on the interview results page

For a practice interview answer recorded with the camera on, the results page shows measurements taken from frames sampled across the clip. They are shown for the candidate to reflect on. **They are not part of any score.** The video itself is never stored. A few small still frames (snapshots) are kept with the answer so each measurement can be illustrated; see "Snapshots" below.

| Card | What is measured | How |
|---|---|---|
| Face visibility | Share of sampled frames where a face was detected | OpenCV Haar cascade (frontal faces only, so a strong head turn can read as "no face") |
| Facing the camera | Share of all sampled frames where a face was present **and** head yaw/pitch and iris offset were inside the thresholds | MediaPipe FaceLandmarker |
| Head movement | Steady / Moderate / Active, from how much yaw and pitch spread across the answer | head angles from the landmarker (compared circularly, so +179 and -179 degrees are 2 degrees apart) |
| Expression variation | Low / Moderate / High: **how much** brow, eye-squint/wide, smile/frown, cheek and nose movement changed from frame to frame | MediaPipe blendshape coefficients. Jaw and mouth channels (speaking), blinks and eye-look are excluded. It is a movement amount; it never names an emotion |
| Eye contact (approx.) | Share of measurable frames where the eyes and head pointed toward the camera | iris offset + head yaw; the complement of the existing looking-away ratio |
| Position in frame | Good / Fair / Poor: whether the head was a sensible size and roughly centred | face bounding box from the landmarks. Head position only, **not body posture** |
| Timeline | Per sampled frame: face visible, facing camera, facial change, head change | same measurements, in time order. Unmeasured moments leave gaps, never zeros |

## What is deliberately not done
- No emotion, mood, confidence, honesty, attention, engagement or personality labels. "Camera engagement" and "posture" are not claimed because a webcam face crop cannot measure them.
- No stored snapshot or thumbnails of the candidate.
- No effect on the interview score, coding results or any hiring decision.

## When something is unavailable
Without the MediaPipe landmark model (`python -m app.diagnostics --download-vision-model`) only face visibility and a face-only timeline are produced; the other cards show "Unavailable". With an older MediaPipe that rejects the blendshape option, only expression variation is unavailable. Fewer than 5 measurable frames give "not enough data" (null), never 0.

## Tuning (ai-service/.env, all optional)
`HEAD_PITCH_THRESHOLD_DEGREES` (25), `GAZE_DEVIATION_THRESHOLD` (0.35), `HEAD_YAW_THRESHOLD_DEGREES` (20), `HEAD_MOVEMENT_LOW_DEG` (4), `HEAD_MOVEMENT_HIGH_DEG` (10), `EXPRESSION_VARIATION_LOW` (0.02), `EXPRESSION_VARIATION_HIGH` (0.06), `SIGNALS_MIN_FRAMES` (5). The level cut-offs are rough and not validated against any study; treat them as a rule of thumb.

## Accuracy
Unit tests use fake frames and a fake landmark model, so they prove the arithmetic and the privacy/robustness rules, not how well MediaPipe reads your face. Check it on your own camera and lighting. Glasses, low light, a high camera angle and compressed browser video all change the numbers.

Backend: `utils/cameraSignals.js` whitelists, clamps and bounds everything before it is stored (timeline at most 60 points). AI service: `app/services/camera_signals.py`. Frontend: `utils/resultsView.js`, `components/BehaviourTimeline.jsx`, `components/ResultsQuestionView.jsx`.

## Snapshots

Next to each measurement the results page shows a plain-language explanation and, where one exists, real frames from the answer:

| Measurement | Snapshots shown |
|---|---|
| Face visible | a well-placed frame; a frame with no face, if there was one |
| Facing the camera / Eye contact | the most frontal frame; the frame furthest from facing the camera, if any frame was flagged |
| Head movement | the frame with the largest head turn, only if it exceeded the "low" threshold |
| Expression variation | the frame with the most facial movement and the one with the least, only if they differ measurably |
| Position in frame | the best-placed frame |

Frames are chosen from the same measurements as the numbers (no randomness), so a "turned away" picture is a frame that was actually measured as turned away. A signal with no matching frame shows no picture rather than a made-up one.

- **Where they live:** returned by the AI service as small JPEGs (320 px wide, quality 60, about 10-20 KB each, at most 7), stored inside the answer's `cv_metrics.snapshots`. The AI service never writes them to disk and sends them nowhere else; they are not sent to any external API.
- **Who sees them:** only the person practising. Hiring assessments store the measurements but never the frames (`keepSnapshots` is false whenever the session has an application).
- **Removal:** they are part of the answer row, so deleting the session or account removes them.
- **Switch off:** `ANSWER_SNAPSHOTS=off` in `ai-service/.env` stops them being produced, and in `backend/.env` stops them being stored.
- **Sanitising:** the backend keeps only JPEG data URIs under 90,000 characters with known labels, at most 7.
- **Older answers** recorded before this feature show the explanations without pictures.
