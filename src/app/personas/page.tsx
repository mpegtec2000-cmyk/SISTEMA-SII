'use client';

import React from 'react';
import { usePersonas } from '@/lib/personas/context';
import Module1DashboardMetas from '@/components/personas/Module1DashboardMetas';
import Module2BlindajeAntiDicom from '@/components/personas/Module2BlindajeAntiDicom';
import Module3QuieroSerEmpresario from '@/components/personas/Module3QuieroSerEmpresario';
import Module4SimuladorCreditos from '@/components/personas/Module4SimuladorCreditos';
import Module5InversionesFinazia from '@/components/personas/Module5InversionesFinazia';

export default function PersonasPage() {
  const { moduloActivo } = usePersonas();

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      {moduloActivo === 'metas' && <Module1DashboardMetas />}
      {moduloActivo === 'blindaje' && <Module2BlindajeAntiDicom />}
      {moduloActivo === 'empresario' && <Module3QuieroSerEmpresario />}
      {moduloActivo === 'creditos' && <Module4SimuladorCreditos />}
      {moduloActivo === 'inversiones' && <Module5InversionesFinazia />}
    </div>
  );
}
