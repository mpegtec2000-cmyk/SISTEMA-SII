'use client';

import React, { useState } from 'react';
import { usePersonas } from '@/lib/personas/context';
import { X, BookOpen, CheckCircle2, Clock, Check, ChevronRight, Award, Sparkles } from 'lucide-react';

export default function ModalCursoDetalle() {
  const { cursoModalAbierto, setCursoModalAbierto, completarLeccion } = usePersonas();
  const [leccionActivaIdx, setLeccionActivaIdx] = useState<number>(0);

  if (!cursoModalAbierto) return null;

  const c = cursoModalAbierto;
  const leccion = c.lecciones[leccionActivaIdx] || c.lecciones[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white border border-purple-200 p-6 sm:p-7 text-slate-950 shadow-2xl animate-scaleUp flex flex-col justify-between">
        <button
          onClick={() => setCursoModalAbierto(null)}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-600 hover:text-slate-950 hover:bg-slate-100 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Curso */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
              Curso #{c.numero}
            </span>
            <span className="text-xs text-slate-600 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {c.duracionEstimada}
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-950">{c.titulo}</h2>
          <p className="text-xs text-slate-700 mt-1">{c.subtitulo}</p>
        </div>

        {/* Tabs de Lecciones */}
        <div className="flex items-center gap-2 overflow-x-auto pb-3 mb-4 border-b border-slate-200">
          {c.lecciones.map((l, idx) => (
            <button
              key={l.id}
              onClick={() => setLeccionActivaIdx(idx)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                leccionActivaIdx === idx
                  ? 'bg-purple-600 text-white font-bold'
                  : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              {l.completada ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
              ) : (
                <span className="w-3.5 h-3.5 rounded-full border border-slate-200 flex items-center justify-center text-[9px]">
                  {idx + 1}
                </span>
              )}
              <span>Lección {idx + 1}</span>
            </button>
          ))}
        </div>

        {/* Contenido de la Lección Activa */}
        <div className="space-y-4 flex-1">
          <h3 className="font-bold text-lg text-slate-950">{leccion.titulo}</h3>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs sm:text-sm text-slate-700 leading-relaxed">
            {leccion.contenido}
          </div>

          <div className="p-4 rounded-xl bg-purple-50 border border-purple-200 space-y-2">
            <span className="text-xs font-bold text-purple-700 uppercase tracking-wider block">
              Consejos Prácticos para Chile:
            </span>
            <ul className="text-xs text-slate-700 space-y-1.5">
              {leccion.consejosClave.map((consejo, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <span>{consejo}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Footer con Acción */}
        <div className="pt-6 mt-6 border-t border-slate-200 flex items-center justify-between">
          <div className="text-xs text-slate-600">
            {c.lecciones.filter((l) => l.completada).length} de {c.lecciones.length} lecciones aprobadas
          </div>

          <div className="flex items-center gap-3">
            {!leccion.completada ? (
              <button
                onClick={() => completarLeccion(c.id, leccion.id)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs shadow-md shadow-sm transition cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Marcar como Completada</span>
              </button>
            ) : (
              <span className="text-xs text-emerald-700 font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                <span>Lección Aprobada</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
