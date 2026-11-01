/** Safe attachment header: ASCII fallback + RFC 5987 UTF-8 name; quotes/CRLF can never break out of the header. */
function attachment(filename) {
  const ascii = String(filename).replace(/[^\x20-\x7e]/g, '_').replace(/["\;]/g, '_')
  const utf8 = encodeURIComponent(String(filename)).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`
}
module.exports = { attachment }
