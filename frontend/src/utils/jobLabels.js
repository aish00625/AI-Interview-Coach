export const EMPLOYMENT_TYPES = [
  { value: 'full_time', label: 'Full time' },
  { value: 'part_time', label: 'Part time' },
  { value: 'internship', label: 'Internship' },
  { value: 'contract', label: 'Contract' },
]
export const EXPERIENCE_LEVELS = [
  { value: 'any', label: 'Any experience level' },
  { value: 'fresher', label: 'Freshers' },
  { value: 'experienced', label: 'Experienced' },
]
const label = (list, v) => list.find((o) => o.value === v)?.label || v
export const employmentLabel = (v) => label(EMPLOYMENT_TYPES, v)
export const experienceLabel = (v) => label(EXPERIENCE_LEVELS, v)
