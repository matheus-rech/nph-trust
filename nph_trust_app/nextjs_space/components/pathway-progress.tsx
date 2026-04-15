'use client';
import { PATHWAY_STAGES, STAGE_COLORS, STATUS_COLORS } from '@/lib/constants';
import { CheckCircle2, Circle, Clock, SkipForward, XCircle } from 'lucide-react';

interface PathwayEvent {
  id: string;
  status: string;
  stageDefinition: { stageType: string; name: string; sortOrder: number };
  data?: any;
  occurredAt?: string;
  completedAt?: string;
}

interface Props {
  events: PathwayEvent[];
  compact?: boolean;
}

const STATUS_ICONS: Record<string, any> = {
  COMPLETED: CheckCircle2,
  IN_PROGRESS: Clock,
  PENDING: Circle,
  SKIPPED: SkipForward,
  CANCELLED: XCircle,
  FAILED: XCircle,
};

export default function PathwayProgress({ events, compact }: Props) {
  const eventMap: Record<string, PathwayEvent> = {};
  (events ?? []).forEach((e: PathwayEvent) => {
    eventMap[e?.stageDefinition?.stageType] = e;
  });

  return (
    <div className={`flex ${compact ? 'gap-1' : 'gap-2 flex-wrap'}`}>
      {PATHWAY_STAGES.map((stage: any, i: number) => {
        const event = eventMap[stage.type];
        const status = event?.status ?? 'NOT_STARTED';
        const color = status === 'NOT_STARTED' ? '#e2e8f0' : (STATUS_COLORS[status] ?? '#94a3b8');
        const Icon = STATUS_ICONS[status] ?? Circle;

        if (compact) {
          return (
            <div key={stage.type} className="flex items-center gap-0.5" title={`${stage.name}: ${status}`}>
              <div className="w-6 h-1.5 rounded-full" style={{ backgroundColor: color }} />
            </div>
          );
        }

        return (
          <div key={stage.type} className="flex items-center gap-2">
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${color}20`, border: `2px solid ${color}` }}>
                <Icon className="w-4 h-4" style={{ color }} />
              </div>
              <span className="text-[10px] text-center mt-1 leading-tight max-w-[60px]" style={{ color: status !== 'NOT_STARTED' ? color : '#94a3b8' }}>
                {stage.name?.split(' ')?.[0]}
              </span>
            </div>
            {i < PATHWAY_STAGES.length - 1 && <div className="w-4 h-0.5 rounded-full bg-[hsl(210,15%,88%)] mt-[-12px]" />}
          </div>
        );
      })}
    </div>
  );
}
