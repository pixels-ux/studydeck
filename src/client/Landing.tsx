import type { Session } from '../shared/types'

const features = [
  {
    title: 'A real timetable',
    text: 'Your week as a grid, with rooms, teachers and subject colours. The free gaps between classes are easy to spot.',
  },
  {
    title: 'Revision plan that adapts',
    text: 'Enter your exam dates and the hours you have. Studydeck builds an intensive week that never lands on a class and gives the nearest exam the most time.',
  },
  {
    title: 'Assignments in one list',
    text: 'Work with due dates and priorities, grouped into overdue, today and next week.',
  },
  {
    title: 'AI study desk',
    text: 'Summarise your notes into revision points, or ask a question and get an answer drawn only from your own notes, with the note it used. It knows your CBSE class and NCERT chapters.',
  },
]

const steps = [
  {
    number: '01',
    title: 'Sign in and get your week',
    text: 'Your timetable, subjects and notes are private to your account and stored safely in your own workspace.',
  },
  {
    number: '02',
    title: 'Tell it your week',
    text: 'Pick your CBSE class and subjects, your school hours, and your test dates. Studydeck lays out the timetable and revision plan for you.',
  },
  {
    number: '03',
    title: 'Build the exam weeks',
    text: 'When exams get close, turn on the revision plan. Your free hours become focused sessions, subject by subject.',
  },
]

export default function Landing({
  session,
  message,
}: {
  session: Session
  message?: string
}) {
  return (
    <div className="landing">
      <header className="land-nav">
        <span className="wordmark">
          Studydeck<span className="wordmark-dot">.</span>
        </span>
        <nav className="land-nav-links" aria-label="Sections">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
        </nav>
        {session.mode === 'setup' ? null : (
          <a className="btn primary" href="/auth/freebuff/signin?returnTo=%2F">
            Sign in with Freebuff
          </a>
        )}
      </header>

      <section className="land-hero">
        <div className="land-hero-copy">
          <p className="eyebrow">CBSE · NCERT · Timetable · Deadlines · Notes · AI</p>
          <h1>Your timetable, deadlines and notes, in one place.</h1>
          <p className="lede">
            Studydeck is a student workspace that holds your week together: a
            timetable you can change, a revision plan built around your exam
            dates, your assignments, and a study desk that answers questions
            from your own notes.
          </p>
          <div className="land-actions">
            {session.mode === 'setup' ? (
              <p className="notice">
                Sign-in is still being set up for this site. Please check back
                shortly.
              </p>
            ) : (
              <>
                <a
                  className="btn primary large"
                  href="/auth/freebuff/signin?returnTo=%2F"
                >
                  Sign in with Freebuff
                </a>
                <a className="btn ghost large" href="#features">
                  What’s inside
                </a>
              </>
            )}
          </div>
          <p className="fineprint">
            No new password. Your timetable stays private to your account.
          </p>
        </div>

        <div className="land-mock" aria-hidden="true">
          <div className="mock-card">
            <div className="mock-head">
              <span>This week</span>
              <span className="mock-chip">Exam in 9 days</span>
            </div>
            <div className="mock-week">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day, index) => (
                <div className="mock-day" key={day}>
                  <span className="mock-day-label">{day}</span>
                  {index === 0 && (
                    <span className="mock-block green" style={{ top: '18%', height: '18%' }}>
                      Maths
                    </span>
                  )}
                  {index === 0 && (
                    <span className="mock-block amber" style={{ top: '56%', height: '14%' }}>
                      History
                    </span>
                  )}
                  {index === 1 && (
                    <span className="mock-block olive" style={{ top: '30%', height: '22%' }}>
                      Biology
                    </span>
                  )}
                  {index === 2 && (
                    <span className="mock-block green" style={{ top: '18%', height: '16%' }}>
                      Maths
                    </span>
                  )}
                  {index === 2 && (
                    <span className="mock-block blue" style={{ top: '48%', height: '24%' }}>
                      CompSci
                    </span>
                  )}
                  {index === 3 && (
                    <span className="mock-block olive" style={{ top: '30%', height: '20%' }}>
                      Biology
                    </span>
                  )}
                  {index === 4 && (
                    <span className="mock-block green" style={{ top: '18%', height: '16%' }}>
                      Maths
                    </span>
                  )}
                  {index === 4 && (
                    <span className="mock-block faint" style={{ top: '62%', height: '16%' }}>
                      Revision
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="mock-foot">
              <div>
                <span className="mock-label">Next up</span>
                <strong>Mathematics · Room 12</strong>
              </div>
              <span className="mock-time">9:00am</span>
            </div>
          </div>
          <div className="mock-note">
            <span className="mock-label">AI study desk</span>
            <p>
              “Photosynthesis light reactions release oxygen as water is
              split.” <span className="cite">[Photosynthesis]</span>
            </p>
          </div>
        </div>
      </section>

      {message ? <p className="notice land-notice">{message}</p> : null}

      <section id="features" className="land-features">
        <div className="section-intro">
          <p className="eyebrow">Features</p>
          <h2>Four parts of your week.</h2>
        </div>
        <div className="feature-grid">
          {features.map((feature, index) => (
            <article className="feature" key={feature.title}>
              <span className="feature-index">0{index + 1}</span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how" className="land-steps">
        <div className="section-intro">
          <p className="eyebrow">How it works</p>
          <h2>Start with a week you can read.</h2>
        </div>
        <div className="step-grid">
          {steps.map((step) => (
            <article className="step" key={step.number}>
              <span className="feature-index">{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="land-band">
        <div>
          <h2>Exam weeks, planned in advance.</h2>
          <p>
            Give Studydeck your exam dates. It turns the hours you actually have
            into a revision timetable, then lets you move any block by hand.
          </p>
        </div>
        {session.mode === 'setup' ? null : (
          <a
            className="btn cream large"
            href="/auth/freebuff/signin?returnTo=%2F"
          >
            Open my workspace
          </a>
        )}
      </section>

      <footer className="land-foot">
        <span className="wordmark">Studydeck.</span>
        <span>A timetable you can keep up with.</span>
      </footer>
    </div>
  )
}
