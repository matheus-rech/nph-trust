'use client';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { PATHWAY_STAGES, STAGE_COLORS } from '@/lib/constants';

interface Props { data: Record<string, { total: number; completed: number; inProgress: number; pending: number }>; }

export default function FunnelChart({ data }: Props) {
  const chartData = PATHWAY_STAGES.map((s: any) => {
    const d = data?.[s.type];
    return { name: s.name?.replace('Symptom ', '').replace(' Review', '').replace(' Decision', '').replace(' Intervention', ''), total: d?.total ?? 0, type: s.type };
  });

  if (chartData.every((d: any) => d.total === 0)) {
    return <div className="h-full flex items-center justify-center text-sm text-[hsl(215,10%,50%)]">No pathway data available</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
        <XAxis type="number" tickLine={false} tick={{ fontSize: 10 }} />
        <YAxis type="category" dataKey="name" width={80} tickLine={false} tick={{ fontSize: 10 }} />
        <Tooltip contentStyle={{ fontSize: 11 }} />
        <Bar dataKey="total" radius={[0, 4, 4, 0]}>
          {chartData.map((entry: any, index: number) => (
            <Cell key={index} fill={STAGE_COLORS[entry.type] ?? '#60B5FF'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
