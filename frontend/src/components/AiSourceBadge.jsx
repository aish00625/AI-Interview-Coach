import Badge from './Badge.jsx'

/** Says where a piece of feedback came from, so local-AI text is never mistaken for the deterministic evaluator. */
export default function AiSourceBadge({ source, model }) {
  if (source === 'local_ai') return <Badge tone="violet" title="Written by a language model running on this computer. It can be wrong.">Local AI{model ? ` · ${model}` : ''}</Badge>
  return <Badge tone="muted" title="Produced by fixed rules, not by a language model.">Rule-based</Badge>
}
