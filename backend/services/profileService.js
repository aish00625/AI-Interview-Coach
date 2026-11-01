const { pool } = require('../config/db')
const profileModel = require('../models/profileModel')
const skillModel = require('../models/skillModel')
const { canonicalSkillName } = require('../utils/skillSynonyms')

/**
 * Orchestrates the multi-table write for "save my profile": the profile
 * row itself, plus a full replace of that user's skills. These must
 * succeed or fail together — a half-applied save (profile updated, skills
 * left stale, or vice versa) would be worse than rejecting the request —
 * so it all runs inside one transaction.
 *
 *   BEGIN
 *     → create-or-update profiles row
 *     → resolve skill names to ids (creating new ones as needed)
 *     → delete + reinsert user_skills
 *   COMMIT   (ROLLBACK on any failure)
 */
async function upsertProfileWithSkills(userId, { targetRole, experienceLevel, preferredLanguage, skillNames = [] }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const existing = await profileModel.getProfileByUserId(userId) // read-only, fine outside the client but cheap enough to reuse pool
    const profile = existing
      ? await profileModel.updateProfile(userId, { targetRole, experienceLevel, preferredLanguage }, client)
      : await profileModel.createProfile({ userId, targetRole, experienceLevel, preferredLanguage }, client)

    // Canonicalise and de-duplicate so "ReactJS" + "react" become the single skill "React".
    const names = [...new Map(skillNames.map((n) => canonicalSkillName(n)).filter(Boolean).map((n) => [n.toLowerCase(), n])).values()]
    const resolved = names.length ? await skillModel.findOrCreateSkillsByNames(names, client) : []
    const skills = [...new Map(resolved.map((s) => [String(s.id), s])).values()]
    await profileModel.replaceUserSkills(userId, skills.map((s) => s.id), client)

    await client.query('COMMIT')
    return { profile, skills }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = { upsertProfileWithSkills }
