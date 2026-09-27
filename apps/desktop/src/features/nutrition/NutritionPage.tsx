import { useState } from 'react';
import { DayLogTab } from './DayLogTab.tsx';
import { FoodsTab } from './FoodsTab.tsx';
import { GoalsTab } from './GoalsTab.tsx';
import { TrendsTab } from './TrendsTab.tsx';

const TABS = [
  { id: 'journal', label: 'Journal' },
  { id: 'aliments', label: 'Aliments & recettes' },
  { id: 'objectifs', label: 'Objectifs' },
  { id: 'tendances', label: 'Tendances' },
] as const;

export function NutritionPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('journal');
  return (
    <div className="page nutrition-page">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">Alimentation</span>
          <h1>Nutrition</h1>
        </div>
      </header>
      <div className="subtabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-selected' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'journal' && <DayLogTab />}
      {tab === 'aliments' && <FoodsTab />}
      {tab === 'objectifs' && <GoalsTab />}
      {tab === 'tendances' && <TrendsTab />}
    </div>
  );
}
