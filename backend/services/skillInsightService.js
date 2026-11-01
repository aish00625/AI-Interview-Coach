const resumeModel = require('../models/resumeModel')
const profileModel = require('../models/profileModel')
const applicationModel = require('../models/applicationModel')
const jobService = require('./jobService')
const { extractSkills, canonicalSkillName } = require('../utils/skillSynonyms')
const { practiceQuestionCountForSkill } = require('./interviewQuestionService')

function httpError(statusCode, message) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

const key = (name) => canonicalSkillName(name).toLowerCase()

/**
 * Pure and deterministic: explains how a candidate's skills line up with a job's required skills. Nothing here is
 * stored, shared with the hiring team, or used to filter, rank or reject anyone - it is a self-assessment aid.
 *
 * @param {{ requiredSkills: Array<{name:string, mandatory:boolean}>, profileSkills: string[], resumeSkills?: Array<{name:string, matchedAs:string[]}>,
 *           jobLevel: string, yourLevel: string, practiceCount?: (skill: string) => number }} input
 */
function computeFit({ requiredSkills, profileSkills, resumeSkills = [], jobLevel, yourLevel, practiceCount = () => 0 }) {
  const inProfile = new Set(profileSkills.map(key))
  const inResume = new Map(resumeSkills.map((s) => [key(s.name), s]))

  const skills = requiredSkills.map((req) => {
    const k = key(req.name)
    const p = inProfile.has(k); const r = inResume.get(k)
    const status = p || r ? 'matched' : 'missing'
    const source = p && r ? 'both' : p ? 'profile' : r ? 'resume' : null
    let evidence = 'Not found on your profile'
    if (p && r) evidence = `On your profile and mentioned in your resume ("${r.matchedAs[0]}")`
    else if (p) evidence = 'Listed on your profile'
    else if (r) evidence = `Mentioned in your resume ("${r.matchedAs[0]}") but not on your profile`
    return { name: req.name, mandatory: req.mandatory, status, source, evidence }
  })

  const matched = skills.filter((s) => s.status === 'matched')
  const mandatory = skills.filter((s) => s.mandatory)
  const mandatoryMatched = mandatory.filter((s) => s.status === 'matched')
  const summary = {
    requiredTotal: skills.length, matched: matched.length,
    mandatoryTotal: mandatory.length, mandatoryMatched: mandatoryMatched.length,
    percent: skills.length ? Math.round((100 * matched.length) / skills.length) : null,
  }

  let experience
  if (jobLevel === 'any') experience = { jobLevel, yourLevel, status: 'any', message: 'This job is open to any experience level.' }
  else if (jobLevel === yourLevel) experience = { jobLevel, yourLevel, status: 'meets', message: `This job is for ${jobLevel === 'fresher' ? 'freshers' : 'experienced candidates'}, which matches your profile.` }
  else experience = { jobLevel, yourLevel, status: 'mismatch', message: `This job is for ${jobLevel === 'fresher' ? 'freshers' : 'experienced candidates'} but your profile says ${yourLevel}. You can change this on your Profile page; you can only apply when it matches.` }

  const nextSteps = []
  for (const s of skills.filter((x) => x.status === 'missing')) {
    const n = practiceCount(s.name)
    nextSteps.push(`${s.mandatory ? 'Required' : 'Optional'} skill "${s.name}" is not on your profile. If you have used it, add it to your profile${n ? `; there ${n === 1 ? 'is 1 practice question' : `are ${n} practice questions`} on it` : ''}. If not, this is a gap you could learn.`)
  }
  for (const s of skills.filter((x) => x.source === 'resume')) {
    nextSteps.push(`"${s.name}" appears in your resume but not on your profile. Add it to your profile so it is counted when you apply.`)
  }

  return {
    summary, skills, experience, nextSteps,
    disclaimer: 'This is a keyword-based self-check, not a hiring decision. It only compares skill names; it cannot judge depth of experience, and the hiring team makes every decision.',
  }
}

/** Skills found in one of the CALLER'S OWN resumes (404 for anyone else's). Suggestions only: nothing is saved. */
async function suggestFromResume({ userId, resumeId }) {
  const resume = await resumeModel.getOwned(resumeId, userId, { withText: true })
  if (!resume) throw httpError(404, 'Resume not found.')
  if (!resume.extracted_text || !resume.extracted_text.trim()) {
    return { available: false, resumeId: Number(resume.id), reason: 'No text could be read from this resume (it may be a scanned image), so skills cannot be suggested.', suggestions: [] }
  }
  const profileSkills = (await profileModel.getUserSkills(userId)).map((s) => key(s.name))
  const suggestions = extractSkills(resume.extracted_text).map((s) => ({ ...s, inProfile: profileSkills.includes(key(s.name)) }))
  return {
    available: true, resumeId: Number(resume.id), suggestions,
    note: 'These are keyword matches against a list of known skills. Review them and add only the ones you can honestly claim.',
  }
}

async function jobFit({ userId, jobId, resumeId }) {
  const job = await jobService.getOpenJob(jobId) // 404 unless open + approved org + not expired
  const profileSkills = (await profileModel.getUserSkills(userId)).map((s) => s.name)
  let resumeSkills = []
  let resumeUsed = null
  if (resumeId) {
    const resume = await resumeModel.getOwned(resumeId, userId, { withText: true })
    if (!resume) throw httpError(404, 'Resume not found.')
    resumeUsed = { id: Number(resume.id), filename: resume.original_filename, textAvailable: Boolean(resume.extracted_text && resume.extracted_text.trim()) }
    if (resumeUsed.textAvailable) resumeSkills = extractSkills(resume.extracted_text)
  }
  const yourLevel = await applicationModel.getCandidateExperienceLevel(userId)
  const fit = computeFit({
    requiredSkills: (job.required_skills || []).map((s) => ({ name: s.name, mandatory: s.mandatory !== false })),
    profileSkills, resumeSkills, jobLevel: job.experience_level, yourLevel,
    practiceCount: practiceQuestionCountForSkill,
  })
  return { jobId: Number(job.id), jobTitle: job.title, resume: resumeUsed, ...fit }
}

module.exports = { computeFit, suggestFromResume, jobFit }
