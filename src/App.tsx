import { CONCEPTS, PHASES, findConcept, type Concept } from './concepts/registry'
import { href, useHashRoute } from './useHashRoute'

function ConceptCard({ concept }: { concept: Concept }) {
  const built = Boolean(concept.Panel)
  const inner = (
    <>
      <div className="card-head">
        <h3>{concept.title}</h3>
        {built ? null : <span className="tag pending">planned</span>}
      </div>
      <p className="card-blurb">{concept.blurb}</p>
      <div className="card-meta">
        <span className="reading">{concept.reading}</span>
        {concept.elastic ? <span className="elastic">{concept.elastic}</span> : null}
      </div>
    </>
  )

  return built ? (
    <a className="card built" href={href(`c/${concept.id}`)}>
      {inner}
    </a>
  ) : (
    <div className="card">{inner}</div>
  )
}

function Index() {
  const built = CONCEPTS.filter((concept) => concept.Panel).length

  return (
    <>
      <section className="intro">
        <h2>How data systems actually work</h2>
        <p>
          Read about an LSM-tree and you get a diagram of one moment. Here you drive it — put keys until the memtable
          spills, watch the flush, let compaction run on its own clock, then scrub backward and watch it again.
        </p>
        <p className="intro-note">
          Every visualization runs a real implementation over a deterministic simulated clock. Randomness is seeded, so
          any run reproduces exactly. {built} of {CONCEPTS.length} built so far.
        </p>
      </section>

      {PHASES.map((phase) => {
        const inPhase = CONCEPTS.filter((concept) => concept.phase === phase)
        if (inPhase.length === 0) return null
        return (
          <section key={phase} className="phase">
            <h2 className="phase-title">{phase}</h2>
            <div className="cards">
              {inPhase.map((concept) => (
                <ConceptCard key={concept.id} concept={concept} />
              ))}
            </div>
          </section>
        )
      })}
    </>
  )
}

function ConceptPage({ concept }: { concept: Concept }) {
  const { Panel, Explainer } = concept

  return (
    <article className="concept">
      <header className="concept-head">
        <a className="back" href={href('')}>
          ← all concepts
        </a>
        <h2>{concept.title}</h2>
        <p className="concept-blurb">{concept.blurb}</p>
        <div className="card-meta">
          <span className="reading">{concept.reading}</span>
          {concept.elastic ? <span className="elastic">{concept.elastic}</span> : null}
        </div>
      </header>

      {Panel ? <Panel /> : <p className="empty">Not built yet.</p>}
      {Explainer ? (
        <div className="explainer">
          <Explainer />
        </div>
      ) : null}
    </article>
  )
}

function NotFound() {
  return (
    <div className="empty-page">
      <h2>Nothing here</h2>
      <p>
        <a href={href('')}>Back to all concepts</a>
      </p>
    </div>
  )
}

export default function App() {
  const route = useHashRoute()
  const conceptId = route.startsWith('c/') ? route.slice(2) : null
  const concept = conceptId ? findConcept(conceptId) : null

  return (
    <div className="app">
      <header className="site-head">
        <a className="brand" href={href('')}>
          <span className="brand-mark">↳</span>
          <span className="brand-name">The Read Path</span>
        </a>
        <p className="brand-tagline">Storage engines, search, and distributed systems — running live</p>
      </header>

      <main>{conceptId ? (concept ? <ConceptPage concept={concept} /> : <NotFound />) : <Index />}</main>

      <footer className="site-foot">
        <span>Deterministic simulations, seeded and replayable.</span>
      </footer>
    </div>
  )
}
