const { pool } = require('../config/db')

/** Recruiter scorecards (Phase J). Callers must already have resolved the application inside their organization. */

async function upsert({ applicationId, reviewerId, recommendation, summary, ratings }, client) {
  const { rows } = await client.query(
    `INSERT INTO application_scorecards (application_id, reviewer_id, recommendation, summary)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (application_id, reviewer_id) WHERE reviewer_id IS NOT NULL
     DO UPDATE SET recommendation = EXCLUDED.recommendation, summary = EXCLUDED.summary
     RETURNING id`,
    [applicationId, reviewerId, recommendation, summary],
  )
  const id = rows[0].id
  await client.query('DELETE FROM application_scorecard_ratings WHERE scorecard_id = $1', [id])
  for (const r of ratings) {
    await client.query(
      'INSERT INTO application_scorecard_ratings (scorecard_id, criterion_key, criterion_label, rating, comment) VALUES ($1, $2, $3, $4, $5)',
      [id, r.key, r.label, r.rating, r.comment],
    )
  }
  return id
}

async function listForApplication(applicationId) {
  const { rows } = await pool.query(
    `SELECT s.id, s.reviewer_id, s.recommendation, s.summary, s.created_at, s.updated_at, u.name AS reviewer_name,
            COALESCE((SELECT json_agg(json_build_object('key', r.criterion_key, 'label', r.criterion_label, 'rating', r.rating, 'comment', r.comment)
                                      ORDER BY r.criterion_key)
                        FROM application_scorecard_ratings r WHERE r.scorecard_id = s.id), '[]'::json) AS ratings
       FROM application_scorecards s LEFT JOIN users u ON u.id = s.reviewer_id
      WHERE s.application_id = $1 ORDER BY s.id`,
    [applicationId],
  )
  return rows
}

module.exports = { upsert, listForApplication }
