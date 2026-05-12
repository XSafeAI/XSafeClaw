import BudgetControlCard from '../components/BudgetControlCard';

export default function RuntimeGuard() {
  return (
    <div className="min-h-screen w-full bg-surface-0 p-4 md:p-6">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-[1700px] grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(520px,1fr)_300px]">
        <section className="rounded-2xl border border-border bg-surface-1 p-3 flex flex-col">
          <button
            type="button"
            className="w-full rounded-lg border border-border bg-surface-0 px-3 py-2.5 text-left text-[13px] font-medium text-text-secondary hover:text-text-primary hover:border-border-active transition-colors"
          >
            + New Task
          </button>

          <div className="mt-4">
            <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">AGENTS</p>
            <div className="mt-2 space-y-2">
              {['OpenClaw', 'Hermes', 'Nanobot'].map((name) => (
                <div key={name} className="rounded-lg border border-border bg-surface-0 px-3 py-2.5">
                  <p className="text-[12px] font-medium text-text-primary">{name}</p>
                  <p className="mt-0.5 text-[10px] text-text-muted">占位卡片 · 后续接入实时状态</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">TOOLS</p>
            <div className="mt-2 space-y-2">
              {['Shell', 'File System', 'MCP Servers'].map((name) => (
                <div key={name} className="rounded-lg border border-border bg-surface-0 px-3 py-2.5">
                  <p className="text-[12px] font-medium text-text-primary">{name}</p>
                  <p className="mt-0.5 text-[10px] text-text-muted">占位卡片 · 后续接入权限与统计</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-auto pt-4 space-y-3">
            <BudgetControlCard />
            <div className="rounded-lg border border-border bg-surface-0 px-3 py-2.5">
              <p className="text-[12px] font-medium text-text-primary">XClaw User</p>
              <p className="mt-0.5 text-[10px] text-text-muted">用户信息占位卡片</p>
            </div>
          </div>
        </section>
        <section className="rounded-2xl border border-border bg-surface-1" />
        <section className="rounded-2xl border border-border bg-surface-1" />
      </div>
    </div>
  );
}
