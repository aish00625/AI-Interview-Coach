import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import Badge from '../components/Badge.jsx'
import Input from '../components/Input.jsx'
import Select from '../components/Select.jsx'
import PageHeader from '../components/PageHeader.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { hirerAssessmentApi, hirerJobApi, hirerTeamApi, questionBankApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { useConfirm, useToast } from '../context/FeedbackContext.jsx'
import { useAuth } from '../hooks/useAuth.js'
import { SECTION_LABELS, CATEGORY_LABELS, emptyDefinition, definitionFromDetail, toPayload, formIssues, totalMarks } from '../utils/assessmentView.js'

const STATUS_TONE = { draft: 'muted', published: 'success', closed: 'neutral' }

/** Create or edit an assessment. Editable only while it is a draft with no attempts; afterwards changes go into a new version. */
export default function HirerAssessmentBuilder() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  const confirm = useConfirm()
  const toast = useToast()
  const { user } = useAuth()
  const canBuild = ['owner', 'recruiter'].includes(user?.organization?.memberRole)

  const [form, setForm] = useState(isNew ? emptyDefinition() : null)
  const [detail, setDetail] = useState(null)
  const [jobs, setJobs] = useState([])
  const [bank, setBank] = useState([])
  const [problems, setProblems] = useState([])
  const [team, setTeam] = useState([])
  const [reviewers, setReviewers] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState({})

  const load = useCallback(async () => {
    try {
      const tasks = [hirerJobApi.list().catch(() => []), hirerJobApi.codingProblems().catch(() => [])]
      if (canBuild) tasks.push(questionBankApi.list().then((d) => d.questions).catch(() => []), hirerTeamApi.get().then((d) => d.members).catch(() => []))
      const [j, p, q = [], t = []] = await Promise.all(tasks)
      setJobs(j); setProblems(p); setBank(q); setTeam(t)
      if (!isNew) {
        const d = await hirerAssessmentApi.get(id)
        setDetail(d); setForm(definitionFromDetail(d)); setReviewers(d.reviewers.map((r) => r.userId))
      }
    } catch (err) { setError(apiErrorMessage(err, 'Could not load the assessment.')) }
  }, [id, isNew, canBuild])
  useEffect(() => { load() }, [load])

  const editable = canBuild && (isNew || detail?.editable)
  const issues = useMemo(() => (form ? formIssues(form) : []), [form])
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const setSection = (kind, patch) => setForm((f) => ({ ...f, sections: f.sections.map((s) => (s.kind === kind ? { ...s, ...patch } : s)) }))
  const move = (kind, dir) => setForm((f) => {
    const list = [...f.sections]; const i = list.findIndex((s) => s.kind === kind); const j = i + dir
    if (j < 0 || j >= list.length) return f
    ;[list[i], list[j]] = [list[j], list[i]]
    return { ...f, sections: list }
  })

  function addItem(section) {
    const value = pick[section.kind]
    if (!value) return
    if (section.kind === 'coding') {
      const p = problems.find((x) => String(x.id) === String(value))
      if (!p || section.items.some((i) => i.codingProblemId === p.id)) return
      setSection('coding', { items: [...section.items, { codingProblemId: p.id, marks: 10, summary: `${p.title} (${p.difficulty})` }] })
    } else {
      const q = bank.find((x) => String(x.id) === String(value))
      if (!q || section.items.some((i) => i.mcqQuestionId === q.id)) return
      setSection(section.kind, { items: [...section.items, { mcqQuestionId: q.id, marks: q.marks, summary: q.questionText }] })
    }
    setPick((p) => ({ ...p, [section.kind]: '' }))
  }

  async function save() {
    setBusy(true); setError('')
    try {
      const body = toPayload(form)
      const d = isNew ? await hirerAssessmentApi.create(body) : await hirerAssessmentApi.update(id, body)
      toast.success('Draft saved.')
      if (isNew) navigate(`/hirer/assessments/${d.assessment.id}`, { replace: true })
      else { setDetail(d); setForm(definitionFromDetail(d)) }
    } catch (err) { setError(apiErrorMessage(err, 'Could not save the assessment.')) } finally { setBusy(false) }
  }

  async function act(kind) {
    const text = {
      publish: ['Publish this assessment?', 'Once published you can invite applicants. It can no longer be edited; later changes go into a new version.'],
      close: ['Close this assessment?', 'No one can start it any more. Attempts already in progress can finish until their own deadline.'],
      version: ['Create a new version?', 'A new draft copy is created. Existing attempts stay on this version.'],
    }[kind]
    if (!(await confirm({ title: text[0], message: text[1] }))) return
    setBusy(true); setError('')
    try {
      if (kind === 'version') { const d = await hirerAssessmentApi.newVersion(id); navigate(`/hirer/assessments/${d.assessment.id}`); return }
      const d = kind === 'publish' ? await hirerAssessmentApi.publish(id) : await hirerAssessmentApi.close(id)
      setDetail(d); setForm(definitionFromDetail(d)); toast.success(kind === 'publish' ? 'Published.' : 'Closed.')
    } catch (err) { setError(apiErrorMessage(err)) } finally { setBusy(false) }
  }

  async function saveReviewers() {
    setBusy(true); setError('')
    try { await hirerAssessmentApi.setReviewers(id, reviewers); toast.success('Reviewers saved.') } catch (err) { setError(apiErrorMessage(err)) } finally { setBusy(false) }
  }

  if (!form) return error ? <div className="field-error">{error}</div> : <LoadingSpinner label="Loading assessment..." />
  const a = detail?.assessment
  return (
    <div>
      <PageHeader
        title={isNew ? 'New assessment' : a.title}
        description={isNew ? 'Set the details, choose the sections and their questions, then save a draft.' : `${a.jobTitle} - version ${a.version}`}
        actions={!isNew && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
            <Link className="btn btn-secondary" to={`/hirer/assessments/${id}/preview`}>Preview as candidate</Link>
            <Link className="btn btn-secondary" to={`/hirer/assessments/${id}/candidates`}>Candidates &amp; results</Link>
          </div>
        )}
      />
      {error && <div className="field-error" style={{ marginBottom: 12 }} role="alert">{error}</div>}
      {!isNew && !detail.editable && (
        <Card style={{ marginBottom: 12 }}>
          <p style={{ margin: 0 }}>
            {a.status === 'draft' ? 'Candidates have attempted this assessment, so it is frozen.' : `This assessment is ${a.status} and can no longer be edited.`}
            {canBuild && <> To change it, <Button variant="secondary" size="sm" onClick={() => act('version')} disabled={busy}>create a new version</Button>.</>}
          </p>
        </Card>
      )}

      <fieldset disabled={!editable || busy} style={{ border: 0, padding: 0, margin: 0 }}>
        <Card style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>Details</h3>
          <div className="form-grid" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <Select label="Job" value={form.jobId} onChange={(e) => set({ jobId: e.target.value })} placeholder="Choose a job" options={jobs.map((j) => ({ value: String(j.id), label: `${j.title} (${j.status})` }))} />
            <Input label="Title" value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} />
            <Input label="Duration (minutes)" type="number" min={5} max={600} value={form.durationMinutes} onChange={(e) => set({ durationMinutes: e.target.value })} />
            <Input label="Maximum attempts" type="number" min={1} max={5} value={form.maxAttempts} onChange={(e) => set({ maxAttempts: e.target.value })} />
            <Input label="Pass mark % (optional, informational)" type="number" min={0} max={100} value={form.passPercent} onChange={(e) => set({ passPercent: e.target.value })} />
            <Input label="Available from (optional)" type="datetime-local" value={form.availableFrom} onChange={(e) => set({ availableFrom: e.target.value })} />
            <Input label="Available until (optional)" type="datetime-local" value={form.availableUntil} onChange={(e) => set({ availableUntil: e.target.value })} />
          </div>
          <label className="field-label" htmlFor="desc" style={{ display: 'block', marginTop: 12 }}>Description (optional)</label>
          <textarea id="desc" className="input" rows={2} maxLength={4000} value={form.description} onChange={(e) => set({ description: e.target.value })} style={{ width: '100%' }} />
          <label className="field-label" htmlFor="instr" style={{ display: 'block', marginTop: 12 }}>Instructions for candidates</label>
          <textarea id="instr" className="input" rows={4} maxLength={8000} value={form.instructions} onChange={(e) => set({ instructions: e.target.value })} style={{ width: '100%' }} />
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12 }}>
            <input type="checkbox" checked={form.monitoringEnabled} onChange={(e) => set({ monitoringEnabled: e.target.checked })} />
            <span>
              Offer consent-based camera monitoring.
              <span className="small muted" style={{ display: 'block' }}>
                Candidates are told exactly what is measured and can choose an alternative without a camera. Events are shown to reviewers as observations only;
                they are never part of the score and never reject anyone automatically. No video or images are stored.
              </span>
            </span>
          </label>
          <p className="small muted" style={{ marginBottom: 0 }}>
            The pass mark only labels a result as meeting it or not. It never changes an application&apos;s status; your team decides.
          </p>
        </Card>

        {form.sections.map((s, idx) => {
          const options = s.kind === 'coding'
            ? problems.filter((p) => !s.items.some((i) => i.codingProblemId === p.id)).map((p) => ({ value: String(p.id), label: `${p.title} (${p.difficulty}${p.topic ? `, ${p.topic}` : ''})` }))
            : bank.filter((q) => q.sectionKind === s.kind && !q.archived && !s.items.some((i) => i.mcqQuestionId === q.id))
              .map((q) => ({ value: String(q.id), label: `[${CATEGORY_LABELS[q.category] || q.category}, ${q.difficulty}] ${q.questionText.slice(0, 80)}` }))
          return (
            <Card key={s.kind} style={{ marginBottom: 12, opacity: s.enabled ? 1 : 0.7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <h3 style={{ margin: 0 }}>Section {form.sections.filter((x, i) => x.enabled && i <= idx).length || '-'}: {SECTION_LABELS[s.kind]}</h3>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <label className="small"><input type="checkbox" checked={s.enabled} onChange={(e) => setSection(s.kind, { enabled: e.target.checked })} /> Include</label>
                  <Button variant="secondary" size="sm" onClick={() => move(s.kind, -1)} aria-label={`Move ${s.kind} up`} disabled={idx === 0}>&uarr;</Button>
                  <Button variant="secondary" size="sm" onClick={() => move(s.kind, 1)} aria-label={`Move ${s.kind} down`} disabled={idx === form.sections.length - 1}>&darr;</Button>
                </div>
              </div>
              {s.enabled && (
                <>
                  <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginTop: 12 }}>
                    <Input label="Section time limit (minutes, optional)" type="number" min={1} value={s.durationMinutes} onChange={(e) => setSection(s.kind, { durationMinutes: e.target.value })} />
                    {s.kind !== 'coding' && <Input label="Negative marking (fraction of marks, 0-1)" type="number" step="0.05" min={0} max={1} value={s.negativeMarking} onChange={(e) => setSection(s.kind, { negativeMarking: e.target.value })} />}
                    <label style={{ alignSelf: 'end' }}><input type="checkbox" checked={s.allowBack} onChange={(e) => setSection(s.kind, { allowBack: e.target.checked })} /> Candidates may come back to this section</label>
                    {s.kind !== 'coding' && <label style={{ alignSelf: 'end' }}><input type="checkbox" checked={s.randomize} onChange={(e) => setSection(s.kind, { randomize: e.target.checked })} /> Randomise question order</label>}
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
                    <thead><tr style={{ textAlign: 'left' }}><th>#</th><th>{s.kind === 'coding' ? 'Problem' : 'Question'}</th><th style={{ width: 110 }}>Marks</th><th></th></tr></thead>
                    <tbody>
                      {s.items.map((it, i) => (
                        <tr key={it.mcqQuestionId || `c${it.codingProblemId}`} style={{ borderTop: '1px solid var(--border-400)' }}>
                          <td>{i + 1}</td>
                          <td>{it.summary}</td>
                          <td><input className="input" type="number" min={0.25} step="0.25" max={100} value={it.marks} aria-label="Marks"
                            onChange={(e) => setSection(s.kind, { items: s.items.map((x, j) => (j === i ? { ...x, marks: e.target.value } : x)) })} style={{ width: 90 }} /></td>
                          <td><Button variant="secondary" size="sm" onClick={() => setSection(s.kind, { items: s.items.filter((_, j) => j !== i) })}>Remove</Button></td>
                        </tr>
                      ))}
                      {!s.items.length && <tr><td colSpan={4} className="muted small" style={{ padding: 8 }}>No {s.kind === 'coding' ? 'problems' : 'questions'} yet.</td></tr>}
                    </tbody>
                  </table>
                  {editable && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'end' }}>
                      <div style={{ flex: 1, minWidth: 240 }}>
                        <Select label={s.kind === 'coding' ? 'Add a coding problem from the catalogue' : `Add a ${s.kind} question from your bank`} value={pick[s.kind] || ''} placeholder="Choose..." options={options}
                          onChange={(e) => setPick((p) => ({ ...p, [s.kind]: e.target.value }))} />
                      </div>
                      <Button variant="secondary" onClick={() => addItem(s)} disabled={!pick[s.kind]}>Add</Button>
                      {s.kind !== 'coding' && <Link to="/hirer/question-bank" className="small">Manage question bank</Link>}
                    </div>
                  )}
                  {s.kind === 'coding' && <p className="small muted">Coding runs in the existing secure Docker executor (Python, JavaScript, Java, C++). Candidates see only pass/fail per test; hidden test inputs and outputs are never shown.</p>}
                </>
              )}
            </Card>
          )
        })}
      </fieldset>

      <Card style={{ marginBottom: 12 }}>
        <p style={{ marginTop: 0 }}>Total marks: <strong>{totalMarks(form)}</strong></p>
        {editable && issues.length > 0 && <ul className="small" style={{ color: 'var(--warning, #b7791f)' }}>{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
        {detail?.publishProblems?.length > 0 && (
          <div className="small"><strong>Before publishing:</strong><ul>{detail.publishProblems.map((p) => <li key={p}>{p}</li>)}</ul></div>
        )}
        {canBuild && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {editable && <Button onClick={save} disabled={busy || issues.length > 0}>{busy ? 'Saving...' : 'Save draft'}</Button>}
            {!isNew && a.status === 'draft' && detail.editable && <Button variant="secondary" onClick={() => act('publish')} disabled={busy || detail.publishProblems.length > 0}>Publish</Button>}
            {!isNew && a.status === 'published' && <Button variant="secondary" onClick={() => act('close')} disabled={busy}>Close</Button>}
            {!isNew && a.status !== 'draft' && <Button variant="secondary" onClick={() => act('version')} disabled={busy}>New version</Button>}
          </div>
        )}
      </Card>

      {!isNew && canBuild && (
        <Card>
          <h3 style={{ marginTop: 0 }}>Reviewers</h3>
          <p className="small muted">Members with the reviewer role see only assessments assigned to them. Owners and recruiters see all assessments.</p>
          {team.length === 0 && <p className="small muted">No team members found.</p>}
          {team.map((m) => (
            <label key={m.user_id} style={{ display: 'block' }}>
              <input type="checkbox" checked={reviewers.includes(Number(m.user_id))}
                onChange={(e) => setReviewers((r) => (e.target.checked ? [...r, Number(m.user_id)] : r.filter((x) => x !== Number(m.user_id))))} />
              {' '}{m.name} <span className="small muted">({m.member_role})</span>
            </label>
          ))}
          <Button variant="secondary" onClick={saveReviewers} disabled={busy} style={{ marginTop: 8 }}>Save reviewers</Button>
        </Card>
      )}
    </div>
  )
}
