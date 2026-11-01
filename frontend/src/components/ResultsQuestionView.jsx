import { useState } from 'react'
import Panel from './Panel.jsx'
import Badge from './Badge.jsx'
import BehaviourTimeline from './BehaviourTimeline.jsx'
import { SpeechMetricsView } from './DeliveryPanel.jsx'
import DeliveryPanel from './DeliveryPanel.jsx'
import { answerScores, overallScore, qualityView, attemptsView, verdict, scoreTone, cameraView, signalGuide, typingView, idealAnswer, givenAnswer } from '../utils/resultsView.js'

const TONE_VAR = { success: 'var(--success)', warning: 'var(--accent-amber)', danger: 'var(--danger)', muted: 'var(--text-500)' }
const METRIC_COLOR = ['var(--indigo-500)', 'var(--accent-teal)', 'var(--accent-amber)', 'var(--violet-500)']

function Ring({ value, tone }) {
  const r = 52
  const c = 2 * Math.PI * r
  const shown = value === null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <div className="rv-ring" role="img" aria-label={value === null ? 'No overall score' : `Overall score ${value} out of 100`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--border-500)" strokeWidth="9" />
        {value !== null && <circle cx="60" cy="60" r={r} fill="none" stroke={TONE_VAR[tone]} strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - shown / 100)} />}
      </svg>
      <div className="rv-ring-label"><strong>{value === null ? '—' : value}</strong><span>/ 100</span></div>
    </div>
  )
}

function Tile({ label, value, unit, hint, ratio, color, muted }) {
  return (
    <div className="rv-tile" data-tile={label} style={muted ? { opacity: 0.7 } : undefined}>
      <div className="rv-tile-label">{label}</div>
      <div className="rv-tile-value" style={muted ? { fontSize: '1rem', color: 'var(--text-500)' } : undefined}>{value}{unit && <small>{unit}</small>}</div>
      {hint && <div className="rv-tile-hint">{hint}</div>}
      {typeof ratio === 'number' && <div className="rv-bar" aria-hidden="true"><span style={{ width: `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`, background: color }} /></div>}
    </div>
  )
}

function Observations({ title = 'Observations', items }) {
  if (!items || !items.length) return null
  return <div className="rv-obs"><h4>{title}</h4><ul>{items.map((o) => <li key={o}>{o}</li>)}</ul></div>
}

/**
 * One question's results as a dashboard: overall + the four scores, camera and typing/speech measurements (only what was measured),
 * feedback, and the reference answer. `extras` is the practice-only content (follow-ups, STAR) rendered below.
 */
export default function ResultsQuestionView({ question, index, total, difficulty, extras }) {
  const [showFull, setShowFull] = useState(false)
  const a = question.answer
  const v = verdict(a)
  const quality = qualityView(a)
  const attempts = attemptsView(a)
  const scores = answerScores(a)
  const cam = cameraView(a.cv_metrics)
  const guide = signalGuide(a.cv_metrics, cam)
  const typ = typingView(a.typing_metrics)
  const ideal = idealAnswer(a)
  const given = givenAnswer(a)
  const meta = a.evaluation_meta || {}
  const strengths = Array.isArray(a.strengths) ? a.strengths : []
  const weaknesses = Array.isArray(a.weaknesses) ? a.weaknesses : []

  return (
    <div className="rv-layout">
      <div className="rv-main">
        <Panel>
          <div className="rv-head">
            <div style={{ minWidth: 0, flex: '1 1 300px' }}>
              <div style={{ color: 'var(--text-500)', fontSize: '0.85rem' }}>Question {index + 1} of {total}</div>
              <h2 style={{ margin: '4px 0 0', fontSize: '1.2rem' }}>{question.question_text}</h2>
              <div className="rv-chips">
                {question.topic_name && <span className="rv-chip">Topic: {question.topic_name}</span>}
                {difficulty && <span className="rv-chip">Difficulty: {difficulty[0].toUpperCase() + difficulty.slice(1)}</span>}
                {a.audio_transcript ? <span className="rv-chip">Spoken answer</span> : <span className="rv-chip">Typed answer</span>}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Answer score" aside={<Badge tone="muted" title="The plain average of the four scores below. The session's final score is on the page header.">Average of 4</Badge>}>
          <div className="rv-overall">
            <Ring value={v.score} tone={v.tone} />
            <div className="rv-verdict">
              <h3 style={{ color: TONE_VAR[v.tone] }}>{v.title}</h3>
              <p>{v.text}</p>
              {v.notes.map((n) => <p key={n} className="small" style={{ color: 'var(--text-500)' }}>{n}</p>)}
            </div>
          </div>
          <div className="rv-tiles" style={{ marginTop: 14 }}>
            {scores.map((s, i) => (
              <Tile key={s.key} label={s.label} value={s.value === null ? (s.notScored ? 'Not scored' : 'Unavailable') : Math.round(s.value)} unit={s.value === null ? '' : '/ 100'}
                hint={s.key === 'technical_score' && quality && quality.evaluable && quality.basis ? `Based on ${quality.basis}` : undefined}
                ratio={s.value === null ? null : s.value / 100} color={METRIC_COLOR[i]} muted={s.value === null} />
            ))}
          </div>
          {meta.confidence === 'low' && meta.confidenceNote && (
            <div role="alert" className="rv-confidence" data-level="low">
              <strong>Low confidence in this evaluation.</strong>
              <span> This says how far the automated check can be trusted. It is not a measure of how good your answer is.</span>
              <p>Why: {meta.confidenceNote}</p>
              {quality && quality.reasons.filter((r) => r !== meta.confidenceNote && !meta.confidenceNote.includes(r)).map((r) => <p key={r}>{r}</p>)}
            </div>
          )}
          {meta.confidence && meta.confidence !== 'low' && meta.confidenceNote && (
            <p className="small" style={{ margin: '12px 0 0', color: 'var(--text-300)' }}>
              <strong>Evaluation confidence: {meta.confidence}.</strong> {meta.confidenceNote}
            </p>
          )}
        </Panel>

        {cam && (
          <Panel title="Camera analysis" aside={<Badge tone="muted">Experimental</Badge>}>
            {cam.empty ? (
              <p style={{ margin: 0, color: 'var(--text-500)' }}>No visual signals could be measured for this answer.</p>
            ) : (
              <div className="rv-tiles">
                {cam.tiles.map((t, i) => <Tile key={t.key} label={t.label} value={t.value} hint={t.hint} ratio={t.ratio} color={METRIC_COLOR[i % 4]} muted={t.muted} />)}
              </div>
            )}
            {cam.frames && <p className="small" style={{ margin: '10px 0 0', color: 'var(--text-500)' }}>{cam.frames}.</p>}
            <div className="rv-two" style={{ marginTop: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
              <div className="rv-obs">
                <h4>Behaviour timeline <span style={{ fontWeight: 400, color: 'var(--text-500)' }}>(throughout the answer)</span></h4>
                <BehaviourTimeline cv={a.cv_metrics} />
              </div>
              <Observations title="Key observations" items={[...cam.observations, ...cam.details]} />
            </div>
            {guide.length > 0 && (
              <div className="rv-guide">
                <h4>What each measurement means</h4>
                <div className="rv-guide-list">
                  {guide.map((g) => (
                    <div className="rv-guide-card" key={g.key}>
                      <div className="rv-guide-head"><strong>{g.title}</strong><span className="rv-guide-value">{g.value}</span></div>
                      <p>{g.means}</p>
                      {g.shots.length > 0 && (
                        <div className="rv-shots">
                          {g.shots.map((sh) => (
                            <figure key={sh.kind}>
                              <img src={sh.image} alt={`${sh.caption}${sh.at ? ` at ${sh.at}` : ''}`} loading="lazy" />
                              <figcaption>{sh.caption}{sh.at ? <span> · {sh.at}</span> : null}</figcaption>
                            </figure>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {!(a.cv_metrics && Array.isArray(a.cv_metrics.snapshots) && a.cv_metrics.snapshots.length) && (
                  <p className="small" style={{ margin: '8px 0 0', color: 'var(--text-500)' }}>No snapshots are saved for this answer. Record a new video answer to see them.</p>
                )}
              </div>
            )}
            <p className="small" style={{ margin: '10px 0 0', color: 'var(--text-500)' }}>
              Rough measurements from a normal webcam, sampled from the clip. Expression variation is only how much the face moved, not what it means. These are not an assessment of confidence, attention, honesty, personality or emotion. They are not part of your score. Snapshots are a few small stills from your own practice video, kept with this answer, shown only to you and removed with it. The video itself is not kept.
            </p>
          </Panel>
        )}

        <DeliveryPanel summary={a.behavior_summary} />

        {attempts && (
          <Panel title={`Attempt ${attempts.count}`}>
            <p className="small" style={{ margin: 0, color: 'var(--text-300)' }}>You answered this question again. The latest attempt is the one scored; earlier attempts are kept here for reference.</p>
            {attempts.previous.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary>Earlier attempts ({attempts.previous.length})</summary>
                <ol style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {attempts.previous.map((p, i) => (
                    <li key={i} style={{ marginBottom: 6 }}>
                      {p.skipped ? <em>Skipped (0)</em> : <>Average {p.average ?? '-'}{p.preview ? <>: <span style={{ color: 'var(--text-300)' }}>{p.preview.length >= 500 ? `${p.preview}...` : p.preview}</span></> : null}</>}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </Panel>
        )}

        {given.mode !== 'none' && (
          <Panel title={given.mode === 'spoken' ? 'Your answer (transcript)' : 'Your answer'}>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontStyle: given.mode === 'spoken' ? 'italic' : 'normal', color: 'var(--text-300)' }}>
              {given.mode === 'spoken' ? <>&ldquo;{given.text}&rdquo;</> : given.text}
            </p>
          </Panel>
        )}

        <Panel title="Answer feedback">
          <div className="rv-two">
            <div className="rv-good">
              <h4>Strengths</h4>
              {strengths.length ? <ul>{strengths.map((s, i) => <li key={i}>{s}</li>)}</ul> : <p style={{ margin: 0, color: 'var(--text-500)' }}>None identified.</p>}
            </div>
            <div className="rv-improve">
              <h4>Areas to improve</h4>
              {weaknesses.length ? <ul>{weaknesses.map((w, i) => <li key={i}>{w}</li>)}</ul> : <p style={{ margin: 0, color: 'var(--text-500)' }}>None identified.</p>}
            </div>
          </div>
          {a.suggested_improvement && <p style={{ margin: '12px 0 0' }}><strong>Suggested improvement. </strong>{a.suggested_improvement}</p>}
          <p className="small" style={{ margin: '8px 0 0', color: 'var(--text-500)' }}>Generated from the scores above. It shows how the automated check read your answer, not proof of what you know.</p>
        </Panel>
      </div>

      <aside className="rv-side" aria-label="Measurements and reference answer">
        {typ && (
          <Panel title="Typing &amp; interaction">
            {typ.empty ? <p style={{ margin: 0, color: 'var(--text-500)' }}>No typing measurements were recorded.</p> : (
              <div className="rv-tiles" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                {typ.tiles.map((t) => <Tile key={t.key} label={t.label} value={t.value} unit={t.unit} hint={t.hint} />)}
              </div>
            )}
            <div style={{ marginTop: 12 }}><Observations items={typ.observations} /></div>
            <p className="small" style={{ margin: '10px 0 0', color: 'var(--text-500)' }}>Only counts and timings are recorded, never which keys you pressed.</p>
          </Panel>
        )}

        {a.speech_metrics && <Panel title="Speaking"><SpeechMetricsView metrics={a.speech_metrics} /></Panel>}

        {!typ && !a.speech_metrics && (
          <Panel title="Typing &amp; speaking"><p style={{ margin: 0, color: 'var(--text-500)' }}>No typing or speech measurements were recorded for this answer.</p></Panel>
        )}

        <Panel title="Reference answer">
          {ideal.kind === 'available' && (
            <>
              <p className={showFull ? '' : 'rv-clamp'} style={{ margin: 0, color: 'var(--text-300)', fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>{showFull ? ideal.text : ideal.short}</p>
              {ideal.truncated && <button type="button" className="btn btn-sm btn-secondary" style={{ marginTop: 10 }} aria-expanded={showFull} onClick={() => setShowFull((x) => !x)}>{showFull ? 'Show less' : 'View full answer'}</button>}
            </>
          )}
          {ideal.kind === 'unavailable' && <p style={{ margin: 0, color: 'var(--text-500)', fontSize: '0.9rem' }}>{ideal.text}</p>}
          {ideal.kind === 'none' && <p style={{ margin: 0, color: 'var(--text-500)' }}>No reference answer is available.</p>}
        </Panel>
      </aside>

      {extras && <div style={{ gridColumn: '1 / -1' }}>{extras}</div>}
    </div>
  )
}
