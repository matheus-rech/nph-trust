'use client';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { PATHWAY_STAGES, STAGE_COLORS } from '@/lib/constants';

interface Props { data: Record<string, { total: number; completed: number; inProgress: number; pending: number }>; }

export default function StageDistChart({ data }: Props) {
  const chartData = PATHWAY_STAGES.map((s: any) => {
    const d = data?.[s.type];
    return { name: s.name, value: d?.completed ?? 0, type: s.type };
  }).filter((d: any) => d.value > 0);

  if (chartData.length === 0) {
    return <div className="h-full flex items-center justify-center text-sm text-[hsl(215,10%,50%)]">No completed stages</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="55%" outerRadius={90} innerRadius={40}>
          {chartData.map((entry: any, index: number) => (
            <Cell key={index} fill={STAGE_COLORS[entry.type] ?? '#60B5FF'} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ fontSize: 11 }} />
        <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
