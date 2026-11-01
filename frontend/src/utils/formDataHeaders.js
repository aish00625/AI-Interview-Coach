/**
 * Axios request-config fix for file uploads.
 *
 * The shared API client sets `Content-Type: application/json` as its default. Axios (1.x) checks that header in its
 * request transform: when the body is a FormData and the header says JSON, it SERIALISES THE FORM TO JSON instead of
 * sending multipart - the file is silently dropped and the server (multer) sees no file. For resumes that surfaced as
 * 'A resume file is required (field name "resume").'; audio/video answers use the same pattern.
 *
 * Removing the header for FormData bodies lets the browser (XHR) or Axios (Node) write
 * `multipart/form-data; boundary=...` itself. Every other request keeps the JSON default.
 */
export function dropJsonHeaderForFormData(config) {
  if (typeof FormData !== 'undefined' && config.data instanceof FormData && config.headers) {
    if (typeof config.headers.delete === 'function') config.headers.delete('Content-Type')
    else delete config.headers['Content-Type']
  }
  return config
}
