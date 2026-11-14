'use client';

import React from 'react';
import { usePersonas } from '@/lib/personas/context';
import { ModuloId } from '@/lib/personas/types';
import { Home, ShieldCheck, Rocket, Calculator, TrendingUp } from 'lucide-react';

const ITEMS: { id: ModuloId; label: string; icon: React.ElementType }[] = [
  { id: 'metas', label: 'Metas', icon: Home },
  { id: 'blindaje', label: 'Anti-DICOM', icon: ShieldCheck },
  { id: 'empresario', label: 'Academia', icon: Rocket },
  { id: 'creditos', label: 'Créditos', icon: Calculator },
  { id: 'inversiones', label: 'Inversión', icon: TrendingUp },
];

export default function BottomBar() {
  const { moduloActivo, setModuloActivo, semaforoInfo } = usePersonas();

  return (
    <nav className="lg:hidden fixed bottom-2 left-2 right-2 z-40 bg-[#141416]/95 backdrop-blur-md border border-white/10 rounded-2xl px-2 py-1.5 shadow-xl">
      <div className="flex items-center justify-around">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const isSelected = moduloActivo === item.id;

          return (
            <button
              key={item.id}
              onClick={() => setModuloActivo(item.id)}
              className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all relative cursor-pointer ${
                isSelected
                  ? 'text-white font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <div
                className={`p-1.5 rounded-xl transition-all ${
                  isSelected ? 'bg-white/15 text-white shadow-inner' : ''
                }`}
              >
                <Icon className="w-4 h-4" />
              </div>
              <span className="text-[10px] mt-0.5">{item.label}</span>

              {item.id === 'blindaje' && semaforoInfo.estado === 'rojo' && (
                <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-rose-500 animate-ping" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
