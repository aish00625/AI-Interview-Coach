const { pool } = require('../config/db')

/**
 * Organization-owned MCQ bank (migration 018). Every query is scoped by organization_id. This module returns answer keys,
 * so it is only ever called for hirers who manage assessments; candidate-facing code reads questions through
 * assessmentAttemptModel, which never selects correct_keys or explanation.
 */
const shape = (r) => r && ({
  id: Number(r.id), sectionKind: r.section_kind, category: r.category, questionType: r.question_type, questionText: r.question_text,
  choices: r.choices, correctKeys: r.correct_keys, explanation: r.explanation, difficulty: r.difficulty, marks: Number(r.marks),
  archived: r.archived_at != null, usedInAssessments: r.used_in == null ? undefined : Number(r.used_in),
  locked: r.locked == null ? undefined : Boolean(r.locked), createdAt: r.created_at, updatedAt: r.updated_at,
})

// A question is locked once an assessment that uses it has an attempt: editing it would silently change past scoring.
const USAGE = `(SELECT count(DISTINCT s.assessment_id) FROM assessment_items i JOIN assessment_sections s ON s.id = i.section_id WHERE i.mcq_question_id = q.id) AS used_in,
  EXISTS (SELECT 1 FROM assessment_items i JOIN assessment_sections s ON s.id = i.section_id
           JOIN assessment_attempts t ON t.assessment_id = s.assessment_id WHERE i.mcq_question_id = q.id) AS locked`

async function listForOrg(organizationId, { sectionKind = null, category = null, includeArchived = false } = {}) {
  const { rows } = await pool.query(
    `SELECT q.*, ${USAGE} FROM mcq_questions q
      WHERE q.organization_id = $1 AND ($2::text IS NULL OR q.section_kind = $2) AND ($3::text IS NULL OR q.category = $3)
        AND ($4::boolean OR q.archived_at IS NULL)
      ORDER BY q.section_kind, q.category, q.id`,
    [organizationId, sectionKind, category, includeArchived],
  )
  return rows.map(shape)
}

async function getForOrg(id, organizationId, client = pool) {
  const { rows } = await client.query(`SELECT q.*, ${USAGE} FROM mcq_questions q WHERE q.id = $1 AND q.organization_id = $2`, [id, organizationId])
  return shape(rows[0] || null)
}

/** Questions by id that belong to the organization (any missing/foreign id is simply absent from the result). */
async function getManyForOrg(ids, organizationId, client = pool) {
  if (!ids.length) return []
  const { rows } = await client.query('SELECT q.* FROM mcq_questions q WHERE q.id = ANY($1::bigint[]) AND q.organization_id = $2', [ids, organizationId])
  return rows.map(shape)
}

async function create(organizationId, createdBy, q) {
  const { rows } = await pool.query(
    `INSERT INTO mcq_questions (organization_id, section_kind, category, question_type, question_text, choices, correct_keys, explanation, difficulty, marks, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11) RETURNING *`,
    [organizationId, q.sectionKind, q.category, q.questionType, q.questionText, JSON.stringify(q.choices), JSON.stringify(q.correctKeys), q.explanation, q.difficulty, q.marks, createdBy],
  )
  return shape(rows[0])
}

async function update(id, organizationId, q, client = pool) {
  const { rows } = await client.query(
    `UPDATE mcq_questions SET section_kind = $3, category = $4, question_type = $5, question_text = $6, choices = $7::jsonb,
            correct_keys = $8::jsonb, explanation = $9, difficulty = $10, marks = $11
      WHERE id = $1 AND organization_id = $2 RETURNING *`,
    [id, organizationId, q.sectionKind, q.category, q.questionType, q.questionText, JSON.stringify(q.choices), JSON.stringify(q.correctKeys), q.explanation, q.difficulty, q.marks],
  )
  return shape(rows[0] || null)
}

async function setArchived(id, organizationId, archived) {
  const { rows } = await pool.query(
    `UPDATE mcq_questions SET archived_at = CASE WHEN $3 THEN coalesce(archived_at, now()) ELSE NULL END
      WHERE id = $1 AND organization_id = $2 RETURNING *`,
    [id, organizationId, archived],
  )
  return shape(rows[0] || null)
}

module.exports = { listForOrg, getForOrg, getManyForOrg, create, update, setArchived }
