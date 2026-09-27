export function PlaceholderPage(props: { title: string; phase: number; description: string }) {
  return (
    <div className="page">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">Phase {props.phase}</span>
          <h1>{props.title}</h1>
        </div>
      </header>
      <div className="empty-state">
        <p>{props.description}</p>
      </div>
    </div>
  );
}
