'use client';

import React, { useState } from 'react';
import { usePersonas } from '@/lib/personas/context';
import { X, ShieldCheck, Lock, CheckCircle2, Building, RefreshCw } from 'lucide-react';

const BANCOS_DISPONIBLES = [
  { nombre: 'Banco Estado', tipo: 'CuentaRUT / Cuenta Pro', logo: 'BE' },
  { nombre: 'Banco de Chile / Edwards', tipo: 'Cuenta Corriente', logo: 'BCH' },
  { nombre: 'Banco Santander Chile', tipo: 'Cuenta Corriente & Tarjetas', logo: 'SAN' },
  { nombre: 'Bci / Mach', tipo: 'Cuenta Corriente & Línea', logo: 'BCI' },
  { nombre: 'Scotiabank Chile', tipo: 'Cuenta Corriente', logo: 'SCO' },
  { nombre: 'Banco Itaú', tipo: 'Cuenta Corriente', logo: 'ITAU' },
  { nombre: 'Banco Falabella', tipo: 'Cuenta Corriente / CMR', logo: 'FAL' },
  { nombre: 'Banco Ripley', tipo: 'Cuenta Vista / Tarjeta', logo: 'RIP' },
  { nombre: 'Coopeuch', tipo: 'Cuenta Vista & Ahorro', logo: 'COO' },
];

export default function ModalConectarBanco() {
  const { modalBancoAbierto, setModalBancoAbierto, conectarNuevoBanco } = usePersonas();
  const [bancoSeleccionado, setBancoSeleccionado] = useState<string>('Scotiabank Chile');
  const [rut, setRut] = useState<string>('17.482.910-K');
  const [clave, setClave] = useState<string>('••••••••');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  if (!modalBancoAbierto) return null;

  const handleConectar = (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);

    setTimeout(() => {
      const match = BANCOS_DISPONIBLES.find((b) => b.nombre === bancoSeleccionado);
      conectarNuevoBanco(
        bancoSeleccionado,
        match?.tipo || 'Cuenta Corriente',
        Math.floor(250000 + Math.random() * 800000)
      );
      setIsProcessing(false);
      setModalBancoAbierto(false);
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg rounded-2xl bg-white border border-slate-200 p-6 text-slate-950 shadow-2xl animate-scaleUp">
        <button
          onClick={() => setModalBancoAbierto(false)}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-600 hover:text-slate-950 hover:bg-slate-100 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center">
            <Building className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-extrabold text-lg text-slate-950">Conexión Bancaria Segura</h3>
            <p className="text-xs text-slate-600">Open Finance Chile • Cifrado AES-256 de nivel bancario</p>
          </div>
        </div>

        <form onSubmit={handleConectar} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1.5">
              Selecciona tu Institución Financiera:
            </label>
            <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
              {BANCOS_DISPONIBLES.map((b) => (
                <button
                  type="button"
                  key={b.nombre}
                  onClick={() => setBancoSeleccionado(b.nombre)}
                  className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between ${
                    bancoSeleccionado === b.nombre
                      ? 'bg-blue-50 border-blue-500 text-slate-950 ring-1 ring-blue-500/40'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <span className="text-lg">{b.logo}</span>
                  <span className="text-[11px] font-bold mt-1 line-clamp-1">{b.nombre}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">RUT Titular</label>
              <input
                type="text"
                value={rut}
                onChange={(e) => setRut(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-950 font-mono"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Clave de Internet</label>
              <input
                type="password"
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-950"
                required
              />
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-start gap-2.5">
            <Lock className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <p>
              Tus credenciales nunca se almacenan en texto plano. Finazia solo realiza lectura de saldos y vencimientos para activar tu <strong>Blindaje Anti-DICOM</strong>.
            </p>
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setModalBancoAbierto(false)}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-950"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isProcessing}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-lg shadow-sm transition cursor-pointer"
            >
              {isProcessing && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>{isProcessing ? 'Verificando con Banco...' : 'Vincular y Sincronizar'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
