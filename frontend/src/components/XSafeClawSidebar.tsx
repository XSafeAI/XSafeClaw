import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Settings, Shield } from 'lucide-react';
import './XSafeClawSidebar.css';

type AgentStatus = 'ready' | 'working' | 'blocked' | 'offline';

type AgentItem = {
  id: 'openclaw' | 'hermes' | 'nanobot';
  name: 'OpenClaw' | 'Hermes' | 'Nanobot';
  status: AgentStatus;
  pendingRiskCount: number;
};

type SidebarState = 'collapsed' | 'expanded';

type ActivePanel =
  | 'overview'
  | 'agents'
  | 'riskApproval'
  | 'settings';

type AgentPetState = 'typing' | 'sleeping';

const agents: AgentItem[] = [
  {
    id: 'openclaw',
    name: 'OpenClaw',
    status: 'ready',
    pendingRiskCount: 0,
  },
  {
    id: 'hermes',
    name: 'Hermes',
    status: 'working',
    pendingRiskCount: 0,
  },
  {
    id: 'nanobot',
    name: 'Nanobot',
    status: 'blocked',
    pendingRiskCount: 1,
  },
];

function useAgentPetState(agentItems: AgentItem[]): AgentPetState {
  return useMemo(() => {
    const hasActiveTask = agentItems.some(
      agent => agent.status === 'working' || agent.status === 'blocked',
    );

    return hasActiveTask ? 'typing' : 'sleeping';
  }, [agentItems]);
}

function usePendingRiskCount(agentItems: AgentItem[]): number {
  return useMemo(
    () => agentItems.reduce((sum, agent) => sum + agent.pendingRiskCount, 0),
    [agentItems],
  );
}

function getRiskBadgeText(count: number): string {
  if (count <= 0) return '';
  if (count > 9) return '9+';
  return String(count);
}

function getRiskTooltipText(count: number): string {
  if (count <= 0) return '暂无风险审批';
  return `${count} 个风险审批待处理`;
}

function getRiskAriaLabel(count: number): string {
  if (count <= 0) return '暂无风险审批，打开风险审批页';
  return `${count} 个风险审批待处理，打开风险审批页`;
}

function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="xsafeclawTooltipAnchor">
      {children}
      <span className="xsafeclawTooltip" role="tooltip">{text}</span>
    </span>
  );
}

function CollapsedLogoButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Tooltip text="XSafeClaw">
      <button
        type="button"
        className="collapsedButton collapsedLogo"
        onClick={onOpen}
        aria-label="打开 XSafeClaw 总览"
      >
        <span className="collapsedLogoBox">
          <Shield className="collapsedLogoIcon" strokeWidth={1.8} />
        </span>
      </button>
    </Tooltip>
  );
}

function AgentPetButton({
  petState,
  onOpen,
}: {
  petState: AgentPetState;
  onOpen: () => void;
}) {
  const isTyping = petState === 'typing';
  const tooltipText = isTyping ? '智能体正在工作' : '暂无智能体工作';
  const ariaLabel = isTyping
    ? '智能体正在工作，打开智能体状态页'
    : '暂无智能体工作，打开智能体状态页';
  const imageSrc = isTyping
    ? '/assets/xsafeclaw_lobster_typing.gif'
    : '/assets/xsafeclaw_lobster_sleeping.gif';

  return (
    <Tooltip text={tooltipText}>
      <button
        type="button"
        className="collapsedButton agentPetIndicator"
        onClick={onOpen}
        aria-label={ariaLabel}
      >
        <span className="agentPetBox">
          <img className="agentPetImage" src={imageSrc} alt="" aria-hidden="true" />
        </span>
      </button>
    </Tooltip>
  );
}

function RiskBadgeButton({
  count,
  onOpen,
}: {
  count: number;
  onOpen: () => void;
}) {
  const badgeText = getRiskBadgeText(count);

  return (
    <Tooltip text={getRiskTooltipText(count)}>
      <button
        type="button"
        className="collapsedButton collapsedRiskBadge"
        onClick={onOpen}
        aria-label={getRiskAriaLabel(count)}
      >
        {badgeText && <span className="riskBadge">{badgeText}</span>}
      </button>
    </Tooltip>
  );
}

function SettingsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Tooltip text="设置">
      <button
        type="button"
        className="collapsedButton collapsedSettings"
        onClick={onOpen}
        aria-label="打开设置页"
      >
        <span className="collapsedSettingsButton">
          <Settings className="collapsedSettingsIcon" strokeWidth={1.8} />
        </span>
      </button>
    </Tooltip>
  );
}

function CollapsedSidebar({
  petState,
  pendingRiskCount,
  onOpenPanel,
}: {
  petState: AgentPetState;
  pendingRiskCount: number;
  onOpenPanel: (panel: ActivePanel) => void;
}) {
  return (
    <aside className="collapsedSidebar" aria-label="XSafeClaw 收起态入口">
      <CollapsedLogoButton onOpen={() => onOpenPanel('overview')} />
      <AgentPetButton petState={petState} onOpen={() => onOpenPanel('agents')} />
      <RiskBadgeButton count={pendingRiskCount} onOpen={() => onOpenPanel('riskApproval')} />
      <SettingsButton onOpen={() => onOpenPanel('settings')} />
    </aside>
  );
}

function ExpandedPanel({
  activePanel,
  pendingRiskCount,
  petState,
}: {
  activePanel: ActivePanel;
  pendingRiskCount: number;
  petState: AgentPetState;
}) {
  const panelTitle: Record<ActivePanel, string> = {
    overview: '总览页',
    agents: '智能体页',
    riskApproval: '风险审批页',
    settings: '设置页',
  };

  return (
    <aside className="expandedSidebar" aria-label={`XSafeClaw ${panelTitle[activePanel]}`}>
      <section className="expandedPanel">
        <p className="expandedPanelKicker">XSafeClaw</p>
        <h2 className="expandedPanelTitle">{panelTitle[activePanel]}</h2>

        {activePanel === 'overview' && (
          <div className="expandedPanelBody">
            <p>当前为前端 Mock 展示。</p>
            <p>待处理风险审批：{pendingRiskCount}</p>
          </div>
        )}

        {activePanel === 'agents' && (
          <div className="expandedPanelBody">
            <p>宠物状态：{petState === 'typing' ? '打字' : '睡觉'}</p>
            <p>OpenClaw：ready</p>
            <p>Hermes：working</p>
            <p>Nanobot：blocked</p>
          </div>
        )}

        {activePanel === 'riskApproval' && (
          <div className="expandedPanelBody">
            <p>{getRiskTooltipText(pendingRiskCount)}</p>
            <p>默认展示第一条待处理风险。</p>
          </div>
        )}

        {activePanel === 'settings' && (
          <div className="expandedPanelBody">
            <p>设置页前端占位。</p>
            <p>本阶段不接入真实设置功能。</p>
          </div>
        )}
      </section>
    </aside>
  );
}

export default function XSafeClawSidebar() {
  const [sidebarState, setSidebarState] = useState<SidebarState>('collapsed');
  const [activePanel, setActivePanel] = useState<ActivePanel>('overview');
  const agentPetState = useAgentPetState(agents);
  const pendingRiskCount = usePendingRiskCount(agents);

  function openPanel(panel: ActivePanel) {
    setSidebarState('expanded');
    setActivePanel(panel);
  }

  if (sidebarState === 'expanded') {
    return (
      <ExpandedPanel
        activePanel={activePanel}
        pendingRiskCount={pendingRiskCount}
        petState={agentPetState}
      />
    );
  }

  return (
    <CollapsedSidebar
      petState={agentPetState}
      pendingRiskCount={pendingRiskCount}
      onOpenPanel={openPanel}
    />
  );
}
