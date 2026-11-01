const { pool } = require('../config/db')
const model = require('../models/scorecardModel')
const { criteriaFor, validateScorecard } = require('../utils/scorecard')

/** Statuses after which a team has finished screening: colleagues' scorecards are then visible to everyone on the team. */
const SCREENING_DONE = ['shortlisted', 'rejected', 'hired']

function shape(row) {
  return {
    id: row.id, reviewerId: row.reviewer_id, reviewerName: row.reviewer_name, recommendation: row.recommendation,
    summary: row.summary, ratings: row.ratings, updatedAt: row.updated_at,
  }
}

/**
 * Independent scoring: until a reviewer has submitted their own scorecard (or screening is finished) colleagues'
 * scorecards stay hidden, so one person's opinion does not anchor the others. Only the COUNT of others is shown.
 */
async function forActor({ application, actorId }) {
  const all = await model.listForApplication(application.id)
  const mine = all.find((s) => String(s.reviewer_id) === String(actorId)) || null
  const others = all.filter((s) => s !== mine)
  const visible = Boolean(mine) || SCREENING_DONE.includes(application.status)
  return {
    criteria: criteriaFor(application),
    mine: mine ? shape(mine) : null,
    others: visible ? others.map(shape) : [],
    othersCount: others.length,
    othersHidden: !visible && others.length > 0,
  }
}

async function submit({ application, reviewerId, recommendation, summary, ratings }) {
  const clean = validateScorecard({ criteria: criteriaFor(application), ratings, recommendation, summary })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await model.upsert({ applicationId: application.id, reviewerId, recommendation: clean.recommendation, summary: clean.summary, ratings: clean.ratings }, client)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  return forActor({ application, actorId: reviewerId })
}

module.exports = { forActor, submit, SCREENING_DONE }
