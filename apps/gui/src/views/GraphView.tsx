import { useEffect, useState } from "react";

/**
 * Renders the /graphify knowledge graph (graphify-out/graph.html) in a sandboxed
 * iframe. The view owns its own refresh via onGraphChanged — it is deliberately
 * not remounted on storage:changed, since reloading the iframe loses pan/zoom.
 */
export function GraphView() {
  const [html, setHtml] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      const { html: next } = await window.api.graph.read();
      // A null read is transient (file missing or mid-rewrite) — keep the last
      // good copy. Identical content must not reassign srcDoc: that reloads the
      // iframe and throws away the user's pan/zoom.
      if (next !== null) setHtml((prev) => (next === prev ? prev : next));
      setLoaded(true);
    };

    load();
    const off = window.api.onGraphChanged(() => {
      clearTimeout(timer);
      timer = setTimeout(load, 250); // absorb unlink+add bursts on atomic rewrite
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, []);

  return (
    <>
      <header className="flex items-center justify-between px-6 py-3 border-b border-slate-700">
        <h1 className="text-lg font-semibold">Graph</h1>
      </header>
      {html !== null ? (
        <iframe
          srcDoc={html}
          sandbox="allow-scripts"
          className="flex-1 w-full border-0"
          title="Knowledge graph"
        />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-slate-500">
            <div className="text-3xl mb-2">🕸️</div>
            <p>{loaded ? "No graph yet." : "Loading…"}</p>
            {loaded && (
              <p className="text-sm mt-1">
                Run{" "}
                <code className="text-xs font-mono px-1.5 py-0.5 rounded bg-slate-700/80 text-slate-400">
                  /graphify
                </code>{" "}
                to generate your knowledge graph.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
