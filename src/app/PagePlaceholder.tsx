import { EmptyState } from '@/components/ui/EmptyState';
import { Construction } from 'lucide-react';

interface PagePlaceholderProps {
  title: string;
  description?: string;
}

export function PagePlaceholder({
  title,
  description = 'Bu bölüm yakında burada olacak.',
}: PagePlaceholderProps) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <EmptyState icon={Construction} title="Yakında" description={description} />
    </section>
  );
}
