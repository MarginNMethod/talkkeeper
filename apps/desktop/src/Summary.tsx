import type { Segment } from "./api";
export function Summary({
  markdown,
  segments,
}: {
  markdown: string;
  segments: Segment[];
}) {
  return (
    <div>
      {markdown
        .split(/(?=^#{1,6} )/m)
        .filter(Boolean)
        .map((section, index) => {
          const references = new Set<number>();
          for (const match of section.matchAll(/\[#(\d+)(?:-(\d+))?\]/g)) {
            const first = Number(match[1]),
              last = Number(match[2] ?? match[1]);
            if (last >= first && last - first <= 10000)
              for (let seq = first; seq <= last; seq++) references.add(seq);
          }
          return (
            <section className="summary-section" key={index}>
              <p>{section}</p>
              {[...references].map((seq) => {
                const segment = segments.find((s) => s.seq === seq);
                return (
                  <details key={seq}>
                    <summary
                      title={segment?.text ?? "Source segment unavailable"}
                    >
                      Source {seq}
                    </summary>
                    {segment ? (
                      <p>
                        <a href={`#segment-${seq}`}>
                          {segment.speaker} ·{" "}
                          {Math.floor(segment.start_ms / 1000)}s
                        </a>
                        : {segment.text}
                      </p>
                    ) : (
                      <p>This segment has been removed or expired.</p>
                    )}
                  </details>
                );
              })}
            </section>
          );
        })}
    </div>
  );
}
