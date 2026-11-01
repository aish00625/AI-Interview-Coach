import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import Badge from '../components/Badge.jsx'
import Input from '../components/Input.jsx'
import Select from '../components/Select.jsx'
import PageHeader from '../components/PageHeader.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { questionBankApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { useToast } from '../context/FeedbackContext.jsx'
import { CATEGORY_LABELS, SECTION_LABELS } from '../utils/assessmentView.js'

const KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
const blank = () => ({ sectionKind: 'aptitude', category: 'numerical', questionType: 'single', questionText: '', choices: ['', '', '', ''], correctKeys: [], explanation: '', difficulty: 'medium', marks: 1 })

/** The organization's MCQ bank. Answer keys are visible here only to owners and recruiters (the API enforces it). */
export default function HirerQuestionBank() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [filter, setFilter] = useState({ sectionKind: '', includeArchived: false })
  const [form, setForm] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setData(await questionBankApi.list({ sectionKind: filter.sectionKind || undefined, includeArchived: filter.includeArchived ? 'true' : undefined })) } catch (err) { setError(apiErrorMessage(err, 'Could not load the question bank.')) }
  }, [filter])
  useEffect(() => { load() }, [load])

  const cats = (kind) => (data?.categories?.[kind] || []).map((c) => ({ value: c, label: CATEGORY_LABELS[c] || c }))
  const setF = (patch) => setForm((f) => ({ ...f, ...patch }))
  const toggleKey = (k) => setForm((f) => {
    if (f.questionType === 'single') return { ...f, correctKeys: [k] }
    return { ...f, correctKeys: f.correctKeys.includes(k) ? f.correctKeys.filter((x) => x !== k) : [...f.correctKeys, k] }
  })

  function edit(q) {
    setEditingId(q.id)
    setForm({ sectionKind: q.sectionKind, category: q.category, questionType: q.questionType, questionText: q.questionText, choices: q.choices.map((c) => c.text), correctKeys: q.correctKeys, explanation: q.explanation || '', difficulty: q.difficulty, marks: q.marks })
  }

  async function save(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const body = { ...form, marks: Number(form.marks), choices: form.choices.map((c) => c.trim()), correctKeys: form.correctKeys.filter((k) => KEYS.indexOf(k) < form.choices.length) }
      if (editingId) await questionBankApi.update(editingId, body)
      else await questionBankApi.create(body)
      toast.success(editingId ? 'Question updated.' : 'Question added.')
      setForm(null); setEditingId(null); await load()
    } catch (err) { setError(apiErrorMessage(err, 'Could not save the question.')) } finally { setBusy(false) }
  }

  async function archive(q, archived) {
    setBusy(true); setError('')
    try { await questionBankApi.archive(q.id, archived); await load() } catch (err) { setError(apiErrorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHeader title="Question bank" description="Aptitude and technical MCQs your assessments can use. Correct answers and explanations never reach candidates."
        actions={<div style={{ display: 'flex', gap: 8 }}><Link className="btn btn-secondary" to="/hirer/assessments">Assessments</Link><Button onClick={() => { setEditingId(null); setForm(blank()) }}>New question</Button></div>} />
      {error && <div className="field-error" style={{ marginBottom: 12 }} role="alert">{error}</div>}

      {form && (
        <Card style={{ marginBottom: 12 }}>
          <form onSubmit={save}>
            <h3 style={{ marginTop: 0 }}>{editingId ? 'Edit question' : 'New question'}</h3>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <Select label="Section" value={form.sectionKind} onChange={(e) => setF({ sectionKind: e.target.value, category: (data?.categories?.[e.target.value] || [''])[0] })} options={[{ value: 'aptitude', label: SECTION_LABELS.aptitude }, { value: 'technical', label: SECTION_LABELS.technical }]} />
              <Select label="Topic" value={form.category} onChange={(e) => setF({ category: e.target.value })} options={cats(form.sectionKind)} />
              <Select label="Answer type" value={form.questionType} onChange={(e) => setF({ questionType: e.target.value, correctKeys: [] })} options={[{ value: 'single', label: 'One correct answer' }, { value: 'multiple', label: 'Several correct answers' }]} />
              <Select label="Difficulty" value={form.difficulty} onChange={(e) => setF({ difficulty: e.target.value })} options={['easy', 'medium', 'hard'].map((d) => ({ value: d, label: d }))} />
              <Input label="Marks" type="number" min={0.25} step="0.25" max={100} value={form.marks} onChange={(e) => setF({ marks: e.target.value })} />
            </div>
            <label className="field-label" htmlFor="qt" style={{ display: 'block', marginTop: 12 }}>Question</label>
            <textarea id="qt" className="input" rows={3} maxLength={4000} value={form.questionText} onChange={(e) => setF({ questionText: e.target.value })} style={{ width: '100%' }} required />
            <fieldset style={{ border: 0, padding: 0, marginTop: 12 }}>
              <legend className="field-label">Choices (4-8) - mark the correct {form.questionType === 'single' ? 'one' : 'ones'}</legend>
              {form.choices.map((c, i) => (
                <div key={KEYS[i]} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <input type={form.questionType === 'single' ? 'radio' : 'checkbox'} name="correct" checked={form.correctKeys.includes(KEYS[i])} onChange={() => toggleKey(KEYS[i])} aria-label={`Choice ${KEYS[i]} is correct`} />
                  <strong style={{ width: 16 }}>{KEYS[i]}</strong>
                  <input className="input" value={c} maxLength={1000} onChange={(e) => setF({ choices: form.choices.map((x, j) => (j === i ? e.target.value : x)) })} style={{ flex: 1 }} aria-label={`Choice ${KEYS[i]}`} required />
                  {form.choices.length > 4 && <Button variant="secondary" size="sm" onClick={() => setF({ choices: form.choices.filter((_, j) => j !== i), correctKeys: [] })}>Remove</Button>}
                </div>
              ))}
              {form.choices.length < 8 && <Button variant="secondary" size="sm" onClick={() => setF({ choices: [...form.choices, ''] })}>Add choice</Button>}
            </fieldset>
            <label className="field-label" htmlFor="ex" style={{ display: 'block', marginTop: 12 }}>Explanation (optional, shown only to your team after a candidate submits)</label>
            <textarea id="ex" className="input" rows={2} maxLength={4000} value={form.explanation} onChange={(e) => setF({ explanation: e.target.value })} style={{ width: '100%' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save question'}</Button>
              <Button variant="secondary" onClick={() => { setForm(null); setEditingId(null) }}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginBottom: 8 }}>
          <Select label="Show" value={filter.sectionKind} onChange={(e) => setFilter((f) => ({ ...f, sectionKind: e.target.value }))} options={[{ value: '', label: 'All sections' }, { value: 'aptitude', label: 'Aptitude' }, { value: 'technical', label: 'Technical' }]} />
          <label><input type="checkbox" checked={filter.includeArchived} onChange={(e) => setFilter((f) => ({ ...f, includeArchived: e.target.checked }))} /> Include archived</label>
        </div>
        {!data && <LoadingSpinner label="Loading questions..." />}
        {data && data.questions.length === 0 && <p className="muted">No questions yet. Add your first one above.</p>}
        {data && data.questions.map((q) => (
          <div key={q.id} style={{ borderTop: '1px solid var(--border-400)', padding: '10px 0' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <Badge>{SECTION_LABELS[q.sectionKind]}</Badge><Badge tone="info">{CATEGORY_LABELS[q.category] || q.category}</Badge>
              <Badge tone="muted">{q.difficulty}</Badge><span className="small muted">{q.marks} mark(s) - {q.questionType === 'multiple' ? 'several answers' : 'one answer'}</span>
              {q.archived && <Badge tone="warning">archived</Badge>}
              {q.locked && <Badge tone="violet" title="Used by an assessment that candidates have attempted">locked</Badge>}
              {q.usedInAssessments > 0 && <span className="small muted">used in {q.usedInAssessments} assessment(s)</span>}
            </div>
            <p style={{ margin: '6px 0' }}>{q.questionText}</p>
            <ol type="A" style={{ margin: 0 }} className="small">
              {q.choices.map((c) => <li key={c.key} style={{ fontWeight: q.correctKeys.includes(c.key) ? 600 : 400 }}>{c.text}{q.correctKeys.includes(c.key) ? ' (correct)' : ''}</li>)}
            </ol>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              {!q.locked && !q.archived && <Button variant="secondary" size="sm" onClick={() => edit(q)} disabled={busy}>Edit</Button>}
              <Button variant="secondary" size="sm" onClick={() => archive(q, !q.archived)} disabled={busy}>{q.archived ? 'Restore' : 'Archive'}</Button>
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}
