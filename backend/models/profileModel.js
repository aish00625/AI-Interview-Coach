const { pool } = require('../config/db')

/**
 * `profiles` + `user_skills` operations. One profile per user
 * (profiles.user_id is UNIQUE); skills are many-to-many via user_skills,
 * never stored as a comma-separated string.
 */

async function getProfileByUserId(userId) {
  const { rows } = await pool.query(
    `SELECT id, user_id, target_role, experience_level, preferred_language, updated_at
     FROM profiles WHERE user_id = $1`,
    [userId],
  )
  return rows[0] || null
}

async function createProfile({ userId, targetRole, experienceLevel, preferredLanguage }, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO profiles (user_id, target_role, experience_level, preferred_language)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, target_role, experience_level, preferred_language, updated_at`,
    [userId, targetRole ?? null, experienceLevel ?? 'fresher', preferredLanguage ?? 'javascript'],
  )
  return rows[0]
}

async function updateProfile(userId, { targetRole, experienceLevel, preferredLanguage }, client = pool) {
  const { rows } = await client.query(
    `UPDATE profiles
     SET target_role = COALESCE($2, target_role),
         experience_level = COALESCE($3, experience_level),
         preferred_language = COALESCE($4, preferred_language)
     WHERE user_id = $1
     RETURNING id, user_id, target_role, experience_level, preferred_language, updated_at`,
    [userId, targetRole ?? null, experienceLevel ?? null, preferredLanguage ?? null],
  )
  return rows[0] || null
}

async function getUserSkills(userId) {
  const { rows } = await pool.query(
    `SELECT s.id, s.name
     FROM skills s
     JOIN user_skills us ON us.skill_id = s.id
     WHERE us.user_id = $1
     ORDER BY s.name`,
    [userId],
  )
  return rows
}

/** Deletes all of a user's current skills and inserts the given list. Pass a transaction client when calling this alongside updateProfile — see services/profileService.js. */
async function replaceUserSkills(userId, skillIds, client = pool) {
  await client.query('DELETE FROM user_skills WHERE user_id = $1', [userId])
  for (const skillId of skillIds) {
    await client.query(
      'INSERT INTO user_skills (user_id, skill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, skillId],
    )
  }
}

module.exports = { getProfileByUserId, createProfile, updateProfile, getUserSkills, replaceUserSkills }
