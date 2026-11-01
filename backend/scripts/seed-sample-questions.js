#!/usr/bin/env node
/**
 * Adds the 30 sample MCQs (data/sample-questions.js) to ONE approved hiring organization's question bank, through the
 * normal question-bank service (same validation as POST /api/hirer/question-bank).
 *
 *   npm run seed:questions -- --org="Acme Corp"            # DRY RUN (default): validates and reports; writes nothing
 *   npm run seed:questions -- --org="Acme Corp" --apply    # inserts the questions that are not already in that bank
 *   (--org-id=<id> works instead of --org=<name>)
 *
 * Insert-only and idempotent: a question whose text already exists in that organization's bank is skipped, and nothing is
 * ever updated, archived or deleted. The organization must be approved and have an owner (register a hirer, then approve
 * it as an admin at /admin/organizations or with database/seed/approve_organization.sql). Prints no answer keys.
 */
try { require('dotenv').config() } catch { /* DATABASE_URL may come from the environment */ }
const { pool } = require('../config/db')
const questionBankService = require('../services/questionBankService')
const { validateQuestion } = require('../utils/assessmentRules')
const QUESTIONS = require('../data/sample-questions')

const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=')
const APPLY = process.argv.includes('--apply')
const norm = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase()

async function main() {
  const orgName = arg('org'); const orgId = arg('org-id')
  if (!orgName && !orgId) throw new Error('Choose the organization: --org="Company name" or --org-id=<id>.')
  const { rows: orgs } = await pool.query(
    `SELECT o.id, o.name, o.status, (SELECT m.user_id FROM organization_members m WHERE m.organization_id = o.id AND m.member_role = 'owner' ORDER BY m.created_at LIMIT 1) AS owner_id
       FROM organizations o WHERE ($1::text <> '' AND o.name = $1) OR ($2::text <> '' AND o.id::text = $2)`,
    [orgName || '', orgId || ''],
  )
  if (orgs.length !== 1) throw new Error(orgs.length ? 'More than one organization matches; use --org-id.' : 'No organization matches.')
  const org = orgs[0]
  if (org.status !== 'approved') throw new Error(`Organization "${org.name}" is ${org.status}; approve it first.`)
  if (!org.owner_id) throw new Error(`Organization "${org.name}" has no owner.`)

  const seen = new Set()
  for (const [i, q] of QUESTIONS.entries()) {
    const { errors } = validateQuestion(q)
    if (errors.length) throw new Error(`Sample question ${i + 1} is invalid: ${errors.join(' ')}`)
    if (seen.has(norm(q.questionText))) throw new Error(`Sample question ${i + 1} is duplicated in the data file.`)
    seen.add(norm(q.questionText))
  }
  const { rows: existing } = await pool.query('SELECT question_text FROM mcq_questions WHERE organization_id = $1', [org.id])
  const have = new Set(existing.map((r) => norm(r.question_text)))
  const todo = QUESTIONS.filter((q) => !have.has(norm(q.questionText)))
  const by = (k) => QUESTIONS.reduce((m, q) => ({ ...m, [q[k]]: (m[q[k]] || 0) + 1 }), {})
  console.log(`Organization "${org.name}" (id ${org.id}): ${existing.length} question(s) already in its bank.`)
  console.log(`Sample set: ${QUESTIONS.length} valid questions ${JSON.stringify(by('sectionKind'))}; ${todo.length} new, ${QUESTIONS.length - todo.length} already present (skipped).`)
  if (!APPLY) { console.log('DRY RUN: nothing was written. Add --apply to insert.'); return }
  let created = 0
  for (const q of todo) { await questionBankService.create({ organizationId: Number(org.id), userId: Number(org.owner_id), input: q }); created += 1 }
  console.log(`Created ${created} question(s). They appear under Question bank for that organization's owners and recruiters.`)
}

main().catch((err) => { console.error(`Not seeded: ${err.message}`); process.exitCode = 1 }).finally(() => pool.end())
