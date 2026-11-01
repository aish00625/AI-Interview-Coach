/** question: { id, topic, text } — questionNumber/total for the progress label. */
export default function QuestionCard({ question, questionNumber, total }) {
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span className="badge">{question.topic}</span>
        <span className="mono" style={{ color: 'var(--text-500)', fontSize: '0.82rem' }}>
          Question {questionNumber} of {total}
        </span>
      </div>
      <h3 style={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>{question.text}</h3>
    </div>
  )
}
