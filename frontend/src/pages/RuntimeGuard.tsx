export default function RuntimeGuard() {
  return (
    <div className="min-h-screen w-full bg-surface-0 p-4 md:p-6">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-[1700px] grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(520px,1fr)_300px]">
        <section className="rounded-2xl border border-border bg-surface-1" />
        <section className="rounded-2xl border border-border bg-surface-1" />
        <section className="rounded-2xl border border-border bg-surface-1" />
      </div>
    </div>
  );
}
