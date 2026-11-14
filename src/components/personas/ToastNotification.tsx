'use client';

import React from 'react';
import { usePersonas } from '@/lib/personas/context';
import { Sparkles, CheckCircle2 } from 'lucide-react';

export default function ToastNotification() {
  const { mensajeToast } = usePersonas();

  if (!mensajeToast) return null;

  return (
    <div className="fixed bottom-16 lg:bottom-6 right-4 sm:right-8 z-50 animate-bounce">
      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-emerald-500 text-slate-950 font-bold text-xs sm:text-sm shadow-2xl shadow-emerald-500/40 border border-emerald-300">
        <CheckCircle2 className="w-5 h-5 shrink-0" />
        <span>{mensajeToast}</span>
      </div>
    </div>
  );
}
