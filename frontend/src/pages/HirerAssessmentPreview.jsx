import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Card from '../components/Card.jsx'
import PageHeader from '../components/PageHeader.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { hirerAssessmentApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { SECTION_LABELS } from '../utils/assessmentView.js'

/** What a candidate will see: the same payload the candidate API builds, so it contains no answer keys. */
export default function HirerAssessmentPreview() {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { hirerAssessmentApi.preview(id).then(setData).catch((e) => setError(apiErrorMessage(e, 'Could not load the preview.'))) }, [id])
  if (!data) return error ? <div className="field-error">{error}</div> : <LoadingSpinner label="Loading preview..." />
  const a = data.assessment
  return (
    <div>
      <PageHeader title={`Preview: ${a.title}`} description="Read-only candidate view. Answers cannot be selected here and no keys are included." actions={<Link className="btn btn-secondary" to={`/hirer/assessments/${id}`}>Back to the builder</Link>} />
      <Card style={{ marginBottom: 12 }}>
        <p style={{ marginTop: 0 }}><strong>Duration:</strong> {a.durationMinutes} minutes {a.monitoringEnabled ? '- camera monitoring offered (with a no-camera alternative)' : '- no monitoring'}</p>
        <p style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{a.instructions || <em>No instructions yet.</em>}</p>
      </Card>
      {data.sections.map((s) => (
        <Card key={s.id} style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>Section {s.position}: {SECTION_LABELS[s.kind]} {s.durationMinutes ? `(${s.durationMinutes} min)` : ''}</h3>
          <p className="small muted">{s.allowBack ? 'Candidates may return to this section.' : 'Once candidates leave this section they cannot return.'} {s.negativeMarking > 0 ? `Wrong answers lose ${s.negativeMarking * 100}% of the question's marks.` : ''}</p>
          <ol>
            {s.items.map((it) => (
              <li key={it.id} style={{ marginBottom: 12 }}>
                {it.question ? (
                  <>
                    <div>{it.question.questionText} <span className="small muted">({it.marks} mark(s){it.question.questionType === 'multiple' ? ', choose all that apply' : ''})</span></div>
                    <ol type="A" className="small">{it.question.choices.map((c) => <li key={c.key}>{c.text}</li>)}</ol>
                  </>
                ) : (
                  <>
                    <div><strong>{it.coding.title}</strong> <span className="small muted">({it.coding.difficulty}, {it.marks} marks)</span></div>
                    <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{it.coding.description}</p>
                  </>
                )}
              </li>
            ))}
          </ol>
        </Card>
      ))}
    </div>
  )
}
