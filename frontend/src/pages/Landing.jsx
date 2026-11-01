import { Link } from 'react-router-dom'

const FEATURES = [
  {
    title: 'AI Interview Coach',
    body: 'Practice technical, behavioral, and HR rounds with questions generated for your target role and adjusted to where you\u2019re weakest.',
  },
  {
    title: 'Coding Round Analyzer',
    body: 'Solve problems in a real editor, run them against test cases in an isolated sandbox, and get a complexity estimate alongside your pass rate.',
  },
  {
    title: 'Performance Tracking',
    body: 'Every session is scored on technical accuracy, clarity, and completeness, so you can see trend lines instead of a single pass/fail.',
  },
  {
    title: 'Personalized Questions',
    body: 'Repeated gaps in a topic — hashing, DP, system design — get surfaced back to you as targeted practice, not a random question bank.',
  },
]

export default function Landing() {
  return (
    <div>
      <section className="container" style={{ paddingTop: 88, paddingBottom: 64 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 56, alignItems: 'center' }}>
          <div>
            <span className="badge" style={{ marginBottom: 20, display: 'inline-block' }}>Built for interview prep</span>
            <h1>Practice the interview before it counts.</h1>
            <p style={{ fontSize: '1.05rem' }}>
              Run mock technical and behavioral interviews, solve coding problems in a real editor,
              and get scored feedback on what to fix before the real thing.
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
              <Link to="/register" className="btn btn-primary">Start Practicing</Link>
              <Link to="/login" className="btn btn-secondary">I already have an account</Link>
            </div>
          </div>

          <div className="card" style={{ fontFamily: 'var(--font-display)', fontSize: '0.85rem', lineHeight: 1.7 }}>
            <div style={{ color: 'var(--text-500)', marginBottom: 10 }}>live_interview.session</div>
            <div><span style={{ color: 'var(--accent-teal)' }}>Q3</span> · React · medium</div>
            <div style={{ color: 'var(--text-300)', margin: '10px 0' }}>
              "Walk through what happens, render by render, when you call setState inside a click handler."
            </div>
            <div style={{ color: 'var(--text-500)' }}>-- scoring --</div>
            <div>technical&nbsp;&nbsp;78/100</div>
            <div>clarity&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;72/100</div>
            <div style={{ color: 'var(--accent-amber)' }}>overall&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;76/100</div>
          </div>
        </div>
      </section>

      <section className="container" style={{ paddingBottom: 96 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }}>
          {FEATURES.map((f) => (
            <div className="card" key={f.title}>
              <h3>{f.title}</h3>
              <p style={{ margin: 0 }}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
