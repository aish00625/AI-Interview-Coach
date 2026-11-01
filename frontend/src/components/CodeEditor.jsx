import Editor from '@monaco-editor/react'

/**
 * Thin wrapper around Monaco. This component only renders/edits code —
 * it never executes anything. Phase 9 connects the Run/Submit buttons
 * (in pages/CodingEnvironment.jsx) to the Docker execution service via
 * services/api.js; this component stays unchanged.
 */
export default function CodeEditor({
  language = 'javascript',
  value,
  onChange,
  theme = 'vs-dark',
  readOnly = false,
  height = '100%',
  fontSize = 14,
}) {
  return (
    <Editor
      height={height}
      language={language}
      value={value}
      theme={theme}
      onChange={(newValue) => onChange?.(newValue ?? '')}
      options={{
        readOnly,
        fontSize,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
      }}
    />
  )
}
