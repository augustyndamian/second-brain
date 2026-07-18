export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-700 rounded-lg w-[600px] max-h-[85vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-slate-700 flex justify-between items-center">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg">
            ✕
          </button>
        </header>
        <div className="p-5 overflow-auto flex-1">{children}</div>
        {footer && <footer className="px-5 py-3 border-t border-slate-700 flex gap-2 justify-end">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 mb-3">
      <span className="text-xs uppercase tracking-wider text-slate-400">{label}</span>
      {children}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500 min-h-[120px] resize-y"
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
    />
  );
}

export function Button({
  variant = "secondary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-blue-600 hover:bg-blue-500 text-white",
    secondary: "bg-slate-700 hover:bg-slate-600 text-slate-100",
    danger: "bg-red-600 hover:bg-red-500 text-white",
  }[variant];
  return <button {...props} className={`px-3 py-1.5 text-sm rounded ${styles}`} />;
}
