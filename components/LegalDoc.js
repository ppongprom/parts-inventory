function renderBlock(block, key) {
  switch (block.type) {
    case "p":
      return (
        <p key={key} className="legal-p">
          {block.boldPrefix ? <strong>{block.boldPrefix}</strong> : null}
          {block.text}
        </p>
      );
    case "h2":
      return (
        <h3 key={key} className="legal-h2">
          {block.text}
        </h3>
      );
    case "bullet":
      return (
        <ul key={key} className="legal-list">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case "numbered":
      return (
        <ol key={key} className="legal-list legal-list--numbered">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div key={key} className="legal-table-wrap">
          <table className="legal-table">
            <thead>
              <tr>
                {block.headers.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

export default function LegalDoc({ content }) {
  return (
    <article className="legal-doc">
      <header className="legal-doc-header">
        <h1>{content.title}</h1>
        <p className="legal-doc-subtitle">{content.subtitle}</p>
        <p className="legal-doc-updated">ปรับปรุงล่าสุด: {content.updated}</p>
        {content.note ? <p className="legal-doc-note">{content.note}</p> : null}
      </header>

      {content.sections.map((section, i) => (
        <section key={i} className="legal-section">
          <h2>{section.heading}</h2>
          {section.blocks.map((block, j) => renderBlock(block, j))}
        </section>
      ))}
    </article>
  );
}
