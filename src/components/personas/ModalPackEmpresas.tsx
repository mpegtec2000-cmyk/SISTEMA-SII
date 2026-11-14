'use client';

import React, { useState } from 'react';
import { usePersonas } from '@/lib/personas/context';
import { X, Sparkles, Check, Building, ShieldCheck, ArrowRight, Layers } from 'lucide-react';

export default function ModalPackEmpresas() {
  const {
    solicitarPackEmpresasModal,
    setSolicitarPackEmpresasModal,
    nombreUsuario,
    rutUsuario,
    mostrarToast,
  } = usePersonas();

  const [nombreEmpresa, setNombreEmpresa] = useState('');
  const [tipoSociedad, setTipoSociedad] = useState('SpA');
  const [rubro, setRubro] = useState('Servicios y Consultoría');
  const [enviado, setEnviado] = useState(false);

  if (!solicitarPackEmpresasModal) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setEnviado(true);
    setTimeout(() => {
      mostrarToast('¡Solicitud recibida! Un asesor de Finazia te contactará por WhatsApp para coordinar tu constitución.');
      setEnviado(false);
      setSolicitarPackEmpresasModal(false);
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-xl rounded-2xl bg-white border border-amber-200 p-6 sm:p-7 text-slate-950 shadow-2xl animate-scaleUp">
        <button
          onClick={() => setSolicitarPackEmpresasModal(false)}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-600 hover:text-slate-950 hover:bg-slate-100 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 text-slate-950 flex items-center justify-center font-black shadow-lg shadow-sm">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-extrabold text-xl text-slate-950">Solicitud de Pack Empresas Finazia</h3>
            <p className="text-xs text-amber-700">Constitución SpA + ERP en la nube + Garantías para licitaciones</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-slate-900 space-y-1.5">
            <span className="font-bold text-amber-700 block">¿Qué obtienes con el Pack Empresas?</span>
            <ul className="space-y-1">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                Redacción y firma electrónica de estatutos en Tu Empresa en un Día (SpA).
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                Iniciación F-4415 ante el SII con régimen ProPyme 0% impuesto primera categoría.
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                Acceso completo al ERP Finazia (facturación electrónica, cobranza y caja).
              </li>
            </ul>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Idea o Nombre de Fantasía
              </label>
              <input
                type="text"
                placeholder="Ej. Austral Cloud SpA"
                value={nombreEmpresa}
                onChange={(e) => setNombreEmpresa(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-950"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Tipo de Sociedad</label>
              <select
                value={tipoSociedad}
                onChange={(e) => setTipoSociedad(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-950"
              >
                <option value="SpA">SpA (Sociedad por Acciones - Recomendada)</option>
                <option value="EIRL">EIRL (Empresa Individual Resp. Ltda.)</option>
                <option value="Ltda">Sociedad de Responsabilidad Limitada</option>
              </select>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Rubro Principal</label>
              <input
                type="text"
                value={rubro}
                onChange={(e) => setRubro(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-950"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Representante Legal
              </label>
              <input
                type="text"
                value={`${nombreUsuario} (${rutUsuario})`}
                disabled
                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs text-slate-600"
              />
            </div>
          </div>

          <div className="pt-3 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setSolicitarPackEmpresasModal(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-950"
            >
              Cerrar
            </button>
            <button
              type="submit"
              disabled={enviado}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/25 transition cursor-pointer"
            >
              <span>{enviado ? 'Agendando asesoría...' : 'Enviar y Agendar Asesoría 1 a 1'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
