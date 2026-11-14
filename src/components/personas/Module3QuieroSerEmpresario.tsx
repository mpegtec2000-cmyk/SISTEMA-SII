'use client';

import React, { useState } from 'react';
import { usePersonas } from '@/lib/personas/context';
import {
  Rocket,
  BookOpen,
  Award,
  CheckCircle2,
  Clock,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Building,
  Layers,
  FileText,
  DollarSign,
  TrendingUp,
  Play,
  Star,
  Users,
  Check,
} from 'lucide-react';
import { CursoAcademia } from '@/lib/personas/types';

export default function Module3QuieroSerEmpresario() {
  const {
    cursos,
    setCursoModalAbierto,
    setSolicitarPackEmpresasModal,
  } = usePersonas();

  const [activeStoryPillar, setActiveStoryPillar] = useState<number>(0);

  const totalLecciones = cursos.reduce((acc, c) => acc + c.lecciones.length, 0);
  const totalCompletadas = cursos.reduce(
    (acc, c) => acc + c.lecciones.filter((l) => l.completada).length,
    0
  );
  const porcentajeGlobal = Math.round((totalCompletadas / totalLecciones) * 100);

  const PILLARS_PACK = [
    {
      titulo: '1. Software ERP Cloud Finazia',
      sub: 'Control contable, flujo de caja e impuestos en automático',
      desc: 'Emite facturas y boletas electrónicas en 1 click, concilia automáticamente con tu banco y sincroniza tu F29 con el SII sin necesidad de planillas de cálculo complicadas.',
      icon: Layers,
      stats: 'Ahorro de 15 horas al mes',
    },
    {
      titulo: '2. Gestión B2B & Inventario Inteligente',
      sub: 'Ventas corporativas, cotizaciones y órdenes de compra',
      desc: 'Genera cotizaciones profesionales que se convierten en facturas de venta con un clic. Rastrea despachos y mantén tu inventario valorizado para postulaciones a fondos Corfo y Sercotec.',
      icon: Building,
      stats: 'Trazabilidad 100% digital',
    },
    {
      titulo: '3. Garantías & Fianzas Express para Licitaciones',
      sub: 'Postula a Mercado Público sin congelar tu capital',
      desc: 'Emite certificados de fianza y boletas de garantía para licitaciones públicas y privadas en minutos. Olvídate de dejar depósitos a plazo inmovilizados en el banco.',
      icon: ShieldCheck,
      stats: 'Aprobación en 24 horas',
    },
  ];

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Hero del Módulo */}
      <div className="bg-gradient-to-r from-white via-purple-50/70 to-indigo-50/60 p-6 sm:p-8 rounded-2xl border border-purple-200 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xl">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-50 border border-purple-200 text-purple-700 text-xs font-semibold mb-2">
            <Rocket className="w-3.5 h-3.5" />
            <span>Módulo 3: De Persona Natural a Empresario</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight">
            Quiero Ser Empresario
          </h1>
          <p className="text-sm text-slate-700 mt-1.5 max-w-2xl leading-relaxed">
            Aprende a constituir legalmente tu negocio en Chile, emitir facturas con mérito ejecutivo y venderle al Estado. Y cuando estés listo, migra al <strong>Pack Empresas Finazia</strong>.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <button
            onClick={() => setSolicitarPackEmpresasModal(true)}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 font-black text-sm shadow-lg shadow-amber-500/25 transition cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-slate-950" />
            <span>Solicitar Pack Empresas</span>
          </button>
        </div>
      </div>

      {/* Barra de Avance en la Academia */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center font-bold">
            <Award className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-950">Tu Progreso en la Academia Emprendedora</h2>
            <p className="text-xs text-slate-600">
              {totalCompletadas} de {totalLecciones} lecciones completadas ({porcentajeGlobal}%)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-64">
          <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden border border-slate-200">
            <div
              className="bg-gradient-to-r from-purple-500 to-emerald-400 h-full rounded-full transition-all duration-700"
              style={{ width: `${porcentajeGlobal}%` }}
            />
          </div>
          <span className="font-mono text-xs font-bold text-emerald-700 shrink-0">
            {porcentajeGlobal}%
          </span>
        </div>
      </div>

      {/* 1. Grid de Microcursos de la Academia Emprendedora */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-purple-700" />
              Ruta Formativa: 4 Pasos Clave en Chile
            </h2>
            <p className="text-xs text-slate-600">
              Contenido práctico sin rodeos académicos. Diseñado por abogados y contadores de Finazia.
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {cursos.map((c) => {
            const completadas = c.lecciones.filter((l) => l.completada).length;
            const esCompleto = c.progreso === 100;

            return (
              <div
                key={c.id}
                onClick={() => setCursoModalAbierto(c)}
                className="group relative rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-purple-500/50 transition-all p-5 flex flex-col justify-between cursor-pointer hover:shadow-xl hover:shadow-slate-200/80"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-500/25">
                      Curso #{c.numero} • {c.nivel}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-slate-600">
                      <Clock className="w-3.5 h-3.5" />
                      {c.duracionEstimada}
                    </span>
                  </div>

                  <h3 className="font-bold text-slate-950 text-base leading-snug group-hover:text-purple-700 transition-colors">
                    {c.titulo}
                  </h3>
                  <p className="text-xs text-slate-700 font-medium mt-1">{c.subtitulo}</p>
                  <p className="text-xs text-slate-600 mt-2 line-clamp-2 leading-relaxed">
                    {c.descripcion}
                  </p>
                </div>

                <div className="mt-5 pt-4 border-t border-slate-200">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-slate-600">
                      {completadas}/{c.lecciones.length} lecciones
                    </span>
                    {esCompleto ? (
                      <span className="text-emerald-700 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Aprobado
                      </span>
                    ) : (
                      <span className="text-purple-700 font-semibold">{c.progreso}%</span>
                    )}
                  </div>

                  <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        esCompleto
                          ? 'bg-emerald-500'
                          : 'bg-gradient-to-r from-purple-500 to-indigo-400'
                      }`}
                      style={{ width: `${c.progreso}%` }}
                    />
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">
                      Incluye casos reales y tips legales
                    </span>
                    <span className="text-xs font-bold text-purple-700 group-hover:text-purple-700 flex items-center gap-1">
                      <span>Ver Lecciones</span>
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Showcase Audiovisual & Story Cards: "Pack Empresas Finazia" */}
      <div className="bg-gradient-to-br from-slate-50 via-amber-50/40 to-orange-50/30 border border-amber-200 rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold mb-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-700" />
              <span>Showcase Exclusivo Finazia</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-950">
              Pack Empresas Finazia: La Suite para Emprender con Éxito
            </h2>
            <p className="text-sm text-slate-700 mt-1 max-w-2xl">
              Constituimos tu empresa en 24h, te entregamos software ERP en la nube y emitimos tus boletas de garantía para ganar licitaciones.
            </p>
          </div>

          <button
            onClick={() => setSolicitarPackEmpresasModal(true)}
            className="px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm shadow-xl shadow-sm transition self-start md:self-auto cursor-pointer"
          >
            Dar el salto: Solicitar mi Pack
          </button>
        </div>

        {/* Story Selector Interactivo */}
        <div className="grid md:grid-cols-3 gap-4">
          {PILLARS_PACK.map((p, idx) => {
            const Icon = p.icon;
            const isSelected = activeStoryPillar === idx;

            return (
              <div
                key={p.titulo}
                onClick={() => setActiveStoryPillar(idx)}
                className={`p-5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'bg-white border-amber-500 ring-1 ring-amber-500/40 shadow-lg shadow-sm'
                    : 'bg-slate-50 border-slate-200 hover:border-slate-300 hover:bg-slate-100'
                }`}
              >
                <div>
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${
                      isSelected ? 'bg-amber-500 text-slate-950' : 'bg-slate-100 text-amber-700'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-slate-950 text-sm leading-snug">{p.titulo}</h3>
                  <p className="text-xs text-amber-700 font-medium mt-1">{p.sub}</p>
                  <p className="text-xs text-slate-600 mt-2 leading-relaxed">{p.desc}</p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between text-[11px]">
                  <span className="text-emerald-700 font-semibold">{p.stats}</span>
                  <span
                    className={`font-bold ${
                      isSelected ? 'text-amber-700' : 'text-slate-500 group-hover:text-slate-800'
                    }`}
                  >
                    {isSelected ? '● Activo' : 'Ver detalle →'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Video / Demo Preview Interactive Banner */}
        <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 p-6 sm:p-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-3 max-w-xl">
            <span className="text-xs font-mono uppercase text-emerald-700 font-bold tracking-wider">
              ¿Por qué migrar a persona jurídica?
            </span>
            <h4 className="text-lg sm:text-xl font-bold text-slate-950 leading-snug">
              Separa tu patrimonio personal del comercial y reduce tu tasa impositiva legalmente.
            </h4>
            <ul className="text-xs text-slate-700 space-y-1.5">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-700" />
                Blindaje total: ante cualquier quiebra o contingencia, tu casa y auto personal quedan protegidos.
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-700" />
                Acceso a créditos comerciales con tasas preferenciales y subsidios FOGAPE.
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-700" />
                Facturación sin tope a grandes empresas y organismos del Estado.
              </li>
            </ul>
          </div>

          <div className="shrink-0 text-center">
            <div className="p-4 rounded-xl bg-white border border-slate-200 text-left space-y-2">
              <span className="text-[10px] uppercase text-slate-500 font-bold block">
                Pack Empresas Finazia Incluye:
              </span>
              <div className="text-xs text-slate-900 space-y-1">
                <p>Constitución SpA en RES</p>
                <p>Inicio Actividades SII + F-4415</p>
                <p>Certificado Digital 1 año</p>
                <p>Software ERP Finazia Cloud</p>
                <p>Asesor contable asignado</p>
              </div>
              <button
                onClick={() => setSolicitarPackEmpresasModal(true)}
                className="w-full mt-2 py-2 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs transition cursor-pointer"
              >
                Solicitar Asesoría Gratuita
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
