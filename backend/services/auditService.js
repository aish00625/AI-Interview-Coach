const model = require('../models/auditModel')

const ACTION_LABELS = {
  resume_view: 'viewed your resume',
  resume_download: 'downloaded your resume',
  assessment_view: 'viewed your assessment results',
  comparison_view: 'included your assessment results in a side-by-side comparison',
}

/** Awaited by callers BEFORE sensitive data is returned: if the entry cannot be written, the request fails (fail closed). */
const record = (entry, client) => model.record(entry, client)

async function listForOrganization({ organizationId, applicationId, before, limit }) {
  const rows = await model.listForOrganization({
    organizationId, applicationId: applicationId || null, before: before || null, limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
  })
  return rows.map((r) => ({ ...r, description: ACTION_LABELS[r.action] || r.action }))
}

/** Candidate view: the organization name and the kind of access only; individual team members are not identified. */
async function listForCandidate({ applicationId, candidateId, organizationName }) {
  const rows = await model.listForCandidateApplication({ applicationId, candidateId })
  return rows.map((r) => ({ id: r.id, action: r.action, at: r.created_at, description: `Someone at ${organizationName} ${ACTION_LABELS[r.action] || 'accessed your data'}` }))
}

module.exports = { record, listForOrganization, listForCandidate, ACTION_LABELS }
