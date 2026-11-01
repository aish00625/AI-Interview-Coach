const model = require('../models/mcqQuestionModel')
const { validateQuestion, CATEGORIES } = require('../utils/assessmentRules')

/** Organization MCQ bank (migration 018). Only members who manage assessments reach this service (see the routes). */
function httpError(statusCode, message, details) {
  const err = new Error(message)
  err.statusCode = statusCode
  if (details) err.details = details
  return err
}

function validated(input) {
  const { question, errors } = validateQuestion(input)
  if (errors.length) throw httpError(400, errors[0], errors)
  return question
}

async function list({ organizationId, sectionKind, category, includeArchived }) {
  return { questions: await model.listForOrg(organizationId, { sectionKind: sectionKind || null, category: category || null, includeArchived: Boolean(includeArchived) }), categories: CATEGORIES }
}

async function create({ organizationId, userId, input }) {
  return model.create(organizationId, userId, validated(input))
}

/** Editing a question that an attempted assessment uses would silently change how past attempts are scored: refused. */
async function update({ organizationId, id, input }) {
  const existing = await model.getForOrg(id, organizationId)
  if (!existing) throw httpError(404, 'Question not found.')
  if (existing.locked) throw httpError(409, 'Candidates have already answered an assessment that uses this question, so it can no longer be edited. Archive it and create a new one instead.')
  return model.update(id, organizationId, validated(input))
}

async function setArchived({ organizationId, id, archived }) {
  const q = await model.setArchived(id, organizationId, Boolean(archived))
  if (!q) throw httpError(404, 'Question not found.')
  return q
}

module.exports = { list, create, update, setArchived }
