import { useState } from 'react'

const SUGGESTED_SKILLS = ['Java', 'Python', 'JavaScript', 'C++', 'React', 'Node.js', 'SQL', 'PostgreSQL', 'MongoDB', 'Docker', 'Spring Boot']

/** Multi-select skill picker backed by Phase 1's `skills` lookup table. */
export default function SkillSelector({ value = [], onChange }) {
  const [customSkill, setCustomSkill] = useState('')

  function toggleSkill(skill) {
    if (value.includes(skill)) onChange(value.filter((s) => s !== skill))
    else onChange([...value, skill])
  }

  function addCustomSkill() {
    const trimmed = customSkill.trim()
    if (trimmed && !value.includes(trimmed)) onChange([...value, trimmed])
    setCustomSkill('')
  }

  return (
    <div className="field">
      <label>Skills</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {SUGGESTED_SKILLS.map((skill) => {
          const active = value.includes(skill)
          return (
            <button
              type="button"
              key={skill}
              onClick={() => toggleSkill(skill)}
              className="badge"
              style={{
                cursor: 'pointer',
                borderColor: active ? 'var(--accent-amber)' : 'var(--border-400)',
                color: active ? 'var(--accent-amber)' : 'var(--text-300)',
                background: 'none',
              }}
            >
              {skill}
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="input"
          placeholder="Add another skill"
          value={customSkill}
          onChange={(e) => setCustomSkill(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustomSkill())}
        />
        <button type="button" className="btn btn-secondary" onClick={addCustomSkill}>
          Add
        </button>
      </div>
    </div>
  )
}
