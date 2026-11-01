import { useCallback, useEffect, useRef, useState } from 'react'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'
import EmptyState from '../components/EmptyState.jsx'
import LoadingSpinner from '../components/LoadingSpinner.jsx'
import { resumeApi } from '../services/api.js'
import { apiErrorMessage } from '../utils/apiError.js'
import { saveBlob, formatBytes } from '../utils/download.js'
import { useConfirm, useToast } from '../context/FeedbackContext.jsx'

const MAX_BYTES = 5 * 1024 * 1024
const EXTRACTION_NOTE = {
  ok: 'Text extracted',
  empty: 'No readable text found (scanned image?)',
  unsupported: 'Text preview not available for this file',
  failed: 'Text could not be extracted',
}

export default function MyResumes() {
  const confirm = useConfirm()
  const toast = useToast()
  const [resumes, setResumes] = useState(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState(null)
  const fileInput = useRef(null)

  const load = useCallback(async () => {
    try { setResumes(await resumeApi.list()) } catch (err) { setError(apiErrorMessage(err, 'Could not load your resumes.')); setResumes([]) }
  }, [])
  useEffect(() => { load() }, [load])

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    if (file.size > MAX_BYTES) return setError('That file is larger than 5 MB.')
    if (!/\.(pdf|docx)$/i.test(file.name)) return setError('Please choose a PDF or DOCX file.')
    setUploading(true)
    try {
      await resumeApi.upload(file)
      await load()
    } catch (err) {
      setError(apiErrorMessage(err, 'Upload failed.'))
    } finally {
      setUploading(false)
    }
  }

  async function download(r) {
    setError('')
    try { saveBlob(await resumeApi.download(r.id), r.original_filename) } catch (err) { setError(apiErrorMessage(err, 'Download failed.')) }
  }

  async function remove(r) {
    if (!(await confirm({ title: 'Delete this resume?', message: `"${r.original_filename}" will be permanently deleted.`, confirmLabel: 'Delete resume', tone: 'danger' }))) return
    setError('')
    try {
      await resumeApi.remove(r.id)
      if (preview?.id === r.id) setPreview(null)
      await load()
      toast.success('Resume deleted.')
    } catch (err) { setError(apiErrorMessage(err)) }
  }

  async function showPreview(r) {
    setError('')
    try { setPreview(await resumeApi.get(r.id)) } catch (err) { setError(apiErrorMessage(err)) }
  }

  return (
    <div>
      <h1>My resumes</h1>
      <p style={{ color: 'var(--text-500)' }}>
        Upload PDF or DOCX files (max 5 MB, up to 5 resumes). A resume is only shared with a hiring team when you apply to one of their jobs.
      </p>
      <input ref={fileInput} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={onFile} style={{ display: 'none' }} />
      <Button onClick={() => fileInput.current?.click()} disabled={uploading}>{uploading ? 'Uploading...' : 'Upload resume'}</Button>
      {error && <div className="field-error" style={{ margin: '12px 0' }}>{error}</div>}

      <div style={{ marginTop: 16 }}>
        {resumes === null ? <LoadingSpinner label="Loading..." /> : resumes.length === 0 ? (
          <EmptyState title="No resumes yet" description="Upload a resume to be able to apply for jobs." />
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {resumes.map((r) => (
              <Card key={r.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <strong>{r.original_filename}</strong>
                    <div style={{ color: 'var(--text-500)' }}>
                      {formatBytes(r.size_bytes)} · uploaded {new Date(r.created_at).toLocaleDateString()} · {EXTRACTION_NOTE[r.extraction_status]}
                      {r.application_count > 0 ? ` · used in ${r.application_count} application${r.application_count > 1 ? 's' : ''}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {r.extraction_status === 'ok' && <Button variant="secondary" onClick={() => showPreview(r)}>Preview text</Button>}
                    <Button variant="secondary" onClick={() => download(r)}>Download</Button>
                    <Button variant="danger" onClick={() => remove(r)} disabled={r.application_count > 0} title={r.application_count > 0 ? 'Attached to an application' : undefined}>Delete</Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {preview && (
        <Card style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>{preview.original_filename} — extracted text</h3>
            <Button variant="secondary" onClick={() => setPreview(null)}>Close</Button>
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto', marginTop: 12 }}>{preview.extracted_text}</pre>
        </Card>
      )}
    </div>
  )
}
