import { useNavigate } from 'react-router-dom';
import { Users, Globe } from 'lucide-react';
import { useI18n } from '../i18n';

interface ActionCard {
  icon: React.ElementType;
  title: string;
  description: string;
  onClick: () => void;
  accent?: boolean;
}

function Card({ icon: Icon, title, description, onClick, accent }: ActionCard) {
  return (
    <button
      onClick={onClick}
      className={`group flex flex-col items-center gap-5 p-8 rounded-2xl border transition-all duration-200 text-center
        hover:scale-[1.02] hover:shadow-xl
        ${accent
          ? 'bg-accent/10 border-accent/30 hover:bg-accent/15 hover:border-accent/50 shadow-lg shadow-accent/10'
          : 'bg-surface-1 border-border hover:bg-surface-2 hover:border-accent/30'
        }`}
    >
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all
        ${accent
          ? 'bg-accent/20 group-hover:bg-accent/30'
          : 'bg-surface-2 group-hover:bg-accent/10'
        }`}>
        <Icon className={`w-7 h-7 ${accent ? 'text-accent' : 'text-text-secondary group-hover:text-accent'} transition-colors`} />
      </div>

      <p className={`text-[17px] font-bold tracking-tight ${accent ? 'text-accent' : 'text-text-primary'}`}>
        {title}
      </p>

      <p className="text-[13px] text-text-secondary leading-relaxed max-w-[200px]">
        {description}
      </p>
    </button>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const goToWorld = () => {
    navigate('/agent-town');
  };

  return (
    <div className="min-h-screen bg-surface-0 flex flex-col items-center justify-center px-8 py-16">

      {/* ── Logo + title ── */}
      <div className="flex flex-col items-center gap-4 mb-16">
        <img src="/logo.png" alt="XSafeClaw" className="w-20 h-20 rounded-2xl shadow-xl shadow-accent/25" />
        <div className="text-center space-y-2">
          <h1 className="text-[32px] font-bold text-text-primary tracking-tight">
            {t.home.title}
          </h1>
          <p className="text-[15px] text-text-muted">{t.home.subtitle}</p>
        </div>
      </div>

      {/* ── Two cards in one row ── */}
      <div className="grid grid-cols-2 gap-6 w-full max-w-2xl">
        <Card
          icon={Globe}
          title={t.home.agentTown}
          description={t.home.agentTownDesc}
          onClick={goToWorld}
          accent
        />
        <Card
          icon={Users}
          title={t.home.agentDashboard}
          description={t.home.agentDashboardDesc}
          onClick={() => navigate('/monitor?tab=agent')}
        />
      </div>

    </div>
  );
}
