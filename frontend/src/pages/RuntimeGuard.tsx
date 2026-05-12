export default function RuntimeGuard() {
  return (
    <div className="h-full min-h-screen bg-surface-0 p-4 md:p-6">
      <div className="mx-auto grid h-full min-h-[calc(100vh-3rem)] max-w-[1800px] grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_340px]">
        <section className="rounded-2xl border border-border bg-surface-1" />
        <section className="rounded-2xl border border-border bg-surface-1" />
        <section className="rounded-2xl border border-border bg-surface-1" />
      </div>
    </div>
  );
}
