'use client';

import React, { useState } from 'react';
import { usePersonas } from '@/lib/personas/context';
import { X, Target, Home, Car, Briefcase, Plus } from 'lucide-react';
import { CategoriaMeta } from '@/lib/personas/types';

export default function ModalNuevaMeta() {
  const { modalNuevaMetaAbierto, setModalNuevaMetaAbierto, crearNuevaMeta } = usePersonas();

  const [titulo, setTitulo] = useState('');
  const [categoria, setCategoria] = useState<CategoriaMeta>('casa');
  const [montoObjetivo, setMontoObjetivo] = useState<number>(10000000);
  const [plazoMeses, setPlazoMeses] = useState<number>(24);
  const [descripcion, setDescripcion] = useState('');

  if (!modalNuevaMetaAbierto) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!titulo) return;

    const fechaInicio = new Date().toISOString().split('T')[0];
    const fechaEst = new Date();
    fechaEst.setMonth(fechaEst.getMonth() + plazoMeses);
    const fechaEstimada = fechaEst.toISOString().split('T')[0];

    const imagenUrl =
      categoria === 'casa'
        ? 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80'
        : categoria === 'auto'
        ? 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=800&q=80'
        : 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=800&q=80';

    crearNuevaMeta({
      titulo,
      categoria,
      icono: categoria === 'casa' ? 'Home' : categoria === 'auto' ? 'Car' : 'Briefcase',
      montoObjetivo,
      plazoMeses,
      fechaInicio,
      fechaEstimada,
      aporteMensualSugerido: Math.round(montoObjetivo / plazoMeses),
      imagenUrl,
      descripcion: descripcion || `Meta de ahorro para ${titulo}`,
    });

    setModalNuevaMetaAbierto(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg rounded-2xl bg-white border border-slate-200 p-6 sm:p-7 text-slate-950 shadow-2xl animate-scaleUp">
        <button
          onClick={() => setModalNuevaMetaAbierto(false)}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-600 hover:text-slate-950 hover:bg-slate-100 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <Target className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-extrabold text-lg text-slate-950">Crear Nueva Meta Patrimonial</h3>
            <p className="text-xs text-slate-600">Define tu objetivo en CLP y tu horizonte de ahorro</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">
              Nombre de la Meta
            </label>
            <input
              type="text"
              placeholder="Ej. Terreno en el Sur / Pie depto 2D2B"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-950"
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'casa', label: 'Vivienda', icon: Home },
              { id: 'auto', label: 'Vehículo', icon: Car },
              { id: 'emprender', label: 'Negocio', icon: Briefcase },
            ].map((cat) => {
              const Icon = cat.icon;
              return (
                <button
                  type="button"
                  key={cat.id}
                  onClick={() => setCategoria(cat.id as CategoriaMeta)}
                  className={`p-2.5 rounded-xl border flex flex-col items-center gap-1.5 transition ${
                    categoria === cat.id
                      ? 'bg-emerald-50 border-emerald-500 text-slate-950 font-bold'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4 text-emerald-700" />
                  <span className="text-xs">{cat.label}</span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Monto Objetivo (CLP)
              </label>
              <input
                type="number"
                min={500000}
                step={500000}
                value={montoObjetivo}
                onChange={(e) => setMontoObjetivo(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-950 font-mono"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Plazo (Meses)
              </label>
              <input
                type="number"
                min={3}
                max={120}
                value={plazoMeses}
                onChange={(e) => setPlazoMeses(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-950 font-mono"
                required
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">
              Descripción o Motivación (Opcional)
            </label>
            <textarea
              rows={2}
              placeholder="Ej. Pie para comprar depto antes de cumplir 35 años..."
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-950"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setModalNuevaMetaAbierto(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-950"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-sm transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Guardar Meta</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
