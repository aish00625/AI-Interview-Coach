/**
 * Mirrors the parts of express-validator's normalizeEmail() default that change the address (registration stores the
 * normalized form), so an invitation addressed to "Jane.Doe+x@gmail.com" matches the account that registers with it.
 */
function canonicalEmail(value) {
  const raw = String(value || '').trim().toLowerCase()
  const at = raw.lastIndexOf('@')
  if (at < 1) return raw
  let local = raw.slice(0, at)
  let domain = raw.slice(at + 1)
  if (domain === 'googlemail.com') domain = 'gmail.com'
  if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '')
  return `${local}@${domain}`
}
module.exports = { canonicalEmail }
