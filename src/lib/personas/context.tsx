'use client';

import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import confetti from 'canvas-confetti';
import {
  ModuloId,
  MetaPatrimonial,
  CuentaBancaria,
  VencimientoPago,
  GastoMensual,
  HistoricoFlujo,
  CursoAcademia,
  OportunidadInversion,
  InversionUsuario,
  SemaforoEstado,
  SemaforoInfo,
} from './types';
import {
  METAS_INICIALES,
  CUENTAS_BANCARIAS_INICIALES,
  VENCIMIENTOS_INICIALES,
  GASTOS_MENSUALES,
  HISTORICO_FLUJO,
  CURSOS_ACADEMIA,
  OPORTUNIDADES_INVERSION,
  INVERSIONES_USUARIO_INICIALES,
} from './mockData';

interface PersonasContextType {
  moduloActivo: ModuloId;
  setModuloActivo: (m: ModuloId) => void;

  // Usuario & Finanzas Base
  nombreUsuario: string;
  rutUsuario: string;
  ingresoLiquidoMensual: number;
  setIngresoLiquidoMensual: (n: number) => void;
  ufValor: number;

  // Módulo 1: Metas
  metas: MetaPatrimonial[];
  metaSeleccionada: MetaPatrimonial;
  setMetaSeleccionadaId: (id: string) => void;
  agregarAporteMeta: (metaId: string, monto: number) => void;
  crearNuevaMeta: (nuevaMeta: Omit<MetaPatrimonial, 'id' | 'montoAhorrado'>) => void;

  // Módulo 2: Bancos & Anti-DICOM
  cuentas: CuentaBancaria[];
  vencimientos: VencimientoPago[];
  gastosMensuales: GastoMensual[];
  historicoFlujo: HistoricoFlujo[];
  marcarPagoRealizado: (id: string) => void;
  sincronizarCuentas: () => void;
  isSyncing: boolean;
  conectarNuevoBanco: (banco: string, tipo: string, saldoInicial: number) => void;

  // Semáforo Anti-DICOM
  semaforoOverride: SemaforoEstado | null;
  setSemaforoOverride: (s: SemaforoEstado | null) => void;
  semaforoInfo: SemaforoInfo;
  saldoLiquidoTotal: number;
  cupoTarjetasTotal: number;
  cupoTarjetasUtilizado: number;
  lineaSobregiroTotal: number;
  lineaSobregiroUtilizada: number;
  cargaFinancieraActual: number;

  // Módulo 3: Academia & Pack Empresas
  cursos: CursoAcademia[];
  completarLeccion: (cursoId: string, leccionId: string) => void;
  cursoModalAbierto: CursoAcademia | null;
  setCursoModalAbierto: (c: CursoAcademia | null) => void;
  solicitarPackEmpresasModal: boolean;
  setSolicitarPackEmpresasModal: (open: boolean) => void;

  // Módulo 5: Inversiones
  oportunidades: OportunidadInversion[];
  misInversiones: InversionUsuario[];
  invertirEnOportunidad: (oportunidadId: string, monto: number) => boolean;
  oportunidadParaInvertir: OportunidadInversion | null;
  setOportunidadParaInvertir: (op: OportunidadInversion | null) => void;

  // Modales generales
  modalBancoAbierto: boolean;
  setModalBancoAbierto: (open: boolean) => void;
  modalNuevaMetaAbierto: boolean;
  setModalNuevaMetaAbierto: (open: boolean) => void;

  // Notificaciones & Feedback
  mensajeToast: string | null;
  mostrarToast: (msg: string) => void;
}

const PersonasContext = createContext<PersonasContextType | undefined>(undefined);

export function PersonasProvider({ children }: { children: React.ReactNode }) {
  const [moduloActivo, setModuloActivo] = useState<ModuloId>('metas');

  const [nombreUsuario] = useState('Ignacio Valenzuela');
  const [rutUsuario] = useState('17.482.910-K');
  const [ingresoLiquidoMensual, setIngresoLiquidoMensual] = useState(1850000);
  const ufValor = 37842;

  // Módulo 1: Metas
  const [metas, setMetas] = useState<MetaPatrimonial[]>(METAS_INICIALES);
  const [metaSeleccionadaId, setMetaSeleccionadaId] = useState<string>(METAS_INICIALES[0].id);

  const metaSeleccionada = useMemo(() => {
    return metas.find((m) => m.id === metaSeleccionadaId) || metas[0];
  }, [metas, metaSeleccionadaId]);

  // Módulo 2: Cuentas y Vencimientos
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>(CUENTAS_BANCARIAS_INICIALES);
  const [vencimientos, setVencimientos] = useState<VencimientoPago[]>(VENCIMIENTOS_INICIALES);
  const [gastosMensuales] = useState<GastoMensual[]>(GASTOS_MENSUALES);
  const [historicoFlujo] = useState<HistoricoFlujo[]>(HISTORICO_FLUJO);
  const [isSyncing, setIsSyncing] = useState(false);
  const [semaforoOverride, setSemaforoOverride] = useState<SemaforoEstado | null>(null);

  // Módulo 3: Academia
  const [cursos, setCursos] = useState<CursoAcademia[]>(CURSOS_ACADEMIA);
  const [cursoModalAbierto, setCursoModalAbierto] = useState<CursoAcademia | null>(null);
  const [solicitarPackEmpresasModal, setSolicitarPackEmpresasModal] = useState(false);

  // Módulo 5: Inversiones
  const [oportunidades, setOportunidades] = useState<OportunidadInversion[]>(OPORTUNIDADES_INVERSION);
  const [misInversiones, setMisInversiones] = useState<InversionUsuario[]>(INVERSIONES_USUARIO_INICIALES);
  const [oportunidadParaInvertir, setOportunidadParaInvertir] = useState<OportunidadInversion | null>(null);

  // Modales
  const [modalBancoAbierto, setModalBancoAbierto] = useState(false);
  const [modalNuevaMetaAbierto, setModalNuevaMetaAbierto] = useState(false);
  const [mensajeToast, setMensajeToast] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Hidratar y persistir estado en localStorage para no perder cambios al recargar
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('finanzia_personas_state_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.metas) && parsed.metas.length > 0) setMetas(parsed.metas);
        if (typeof parsed.metaSeleccionadaId === 'string') setMetaSeleccionadaId(parsed.metaSeleccionadaId);
        if (Array.isArray(parsed.cuentas) && parsed.cuentas.length > 0) setCuentas(parsed.cuentas);
        if (Array.isArray(parsed.vencimientos) && parsed.vencimientos.length > 0) setVencimientos(parsed.vencimientos);
        if (Array.isArray(parsed.cursos) && parsed.cursos.length > 0) setCursos(parsed.cursos);
        if (Array.isArray(parsed.oportunidades) && parsed.oportunidades.length > 0) setOportunidades(parsed.oportunidades);
        if (Array.isArray(parsed.misInversiones)) setMisInversiones(parsed.misInversiones);
        if (typeof parsed.ingresoLiquidoMensual === 'number') setIngresoLiquidoMensual(parsed.ingresoLiquidoMensual);
      }
    } catch {
      // Ignorar errores de parseo en localStorage
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        'finanzia_personas_state_v1',
        JSON.stringify({
          metas,
          metaSeleccionadaId,
          cuentas,
          vencimientos,
          cursos,
          oportunidades,
          misInversiones,
          ingresoLiquidoMensual,
        })
      );
    } catch {
      // Ignorar errores de cuota en localStorage
    }
  }, [hydrated, metas, metaSeleccionadaId, cuentas, vencimientos, cursos, oportunidades, misInversiones, ingresoLiquidoMensual]);

  const mostrarToast = (msg: string) => {
    setMensajeToast(msg);
    setTimeout(() => {
      setMensajeToast(null);
    }, 4500);
  };

  // Cálculos consolidados bancarios
  const saldoLiquidoTotal = useMemo(() => {
    return cuentas.reduce((acc, c) => acc + c.saldoDisponible, 0);
  }, [cuentas]);

  const cupoTarjetasTotal = useMemo(() => {
    return cuentas.reduce((acc, c) => acc + (c.cupoTotal || 0), 0);
  }, [cuentas]);

  const cupoTarjetasUtilizado = useMemo(() => {
    return cuentas.reduce((acc, c) => acc + (c.cupoUtilizado || 0), 0);
  }, [cuentas]);

  const lineaSobregiroTotal = useMemo(() => {
    return cuentas.reduce((acc, c) => acc + (c.lineaSobregiroTotal || 0), 0);
  }, [cuentas]);

  const lineaSobregiroUtilizada = useMemo(() => {
    return cuentas.reduce((acc, c) => acc + (c.lineaSobregiroUtilizada || 0), 0);
  }, [cuentas]);

  // Carga financiera = cuotas de deuda / ingreso líquido
  const cargaFinancieraActual = useMemo(() => {
    const pagosDeudaMes = vencimientos
      .filter((v) => !v.pagado && (v.categoria === 'tarjeta' || v.categoria === 'credito'))
      .reduce((acc, v) => acc + v.montoTotal, 0);
    return Math.round((pagosDeudaMes / ingresoLiquidoMensual) * 100);
  }, [vencimientos, ingresoLiquidoMensual]);

  // Semáforo dinámico o forzado por simulador
  const semaforoInfo: SemaforoInfo = useMemo(() => {
    if (semaforoOverride) {
      if (semaforoOverride === 'rojo') {
        return {
          estado: 'rojo',
          titulo: 'Alerta Roja: Riesgo DICOM Inminente',
          descripcion: 'Carga financiera proyectada > 48% con cuotas por vencer en menos de 72h sin cobertura líquida suficiente.',
          cargaFinancieraPct: 51,
          scoreDicom: 460,
          riesgoTexto: 'Alto Riesgo Comercial (Boletín)',
        };
      }
      if (semaforoOverride === 'amarillo') {
        return {
          estado: 'amarillo',
          titulo: 'Alerta Amarilla: Precaución Financiera',
          descripcion: 'Carga financiera entre 36% y 45%. El saldo disponible cubre las cuentas inmediatas con margen estrecho.',
          cargaFinancieraPct: 39,
          scoreDicom: 680,
          riesgoTexto: 'Riesgo Moderado (Requiere contención)',
        };
      }
      return {
        estado: 'verde',
        titulo: 'Blindaje Activo: Situación Saludable',
        descripcion: 'Carga financiera óptima (<30%), 0% sobregiro y saldo suficiente para cubrir holgadamente la quincena.',
        cargaFinancieraPct: 23,
        scoreDicom: 890,
        riesgoTexto: 'Sin Riesgo (Protección Activa)',
      };
    }

    // Cálculo natural
    const hayVencimientoCritico = vencimientos.some(
      (v) => !v.pagado && v.diasRestantes <= 3 && v.montoTotal > saldoLiquidoTotal
    );

    if (cargaFinancieraActual > 45 || hayVencimientoCritico || lineaSobregiroUtilizada > 0.8 * lineaSobregiroTotal) {
      return {
        estado: 'rojo',
        titulo: 'Alerta Roja: Riesgo DICOM Inminente',
        descripcion: 'Tu carga financiera supera el umbral seguro o tienes cuotas que vencen en menos de 72 horas sin cobertura.',
        cargaFinancieraPct: Math.max(cargaFinancieraActual, 48),
        scoreDicom: 490,
        riesgoTexto: 'Riesgo Crítico de Morosidad',
      };
    }

    if (cargaFinancieraActual >= 35 || vencimientos.some((v) => !v.pagado && v.diasRestantes <= 5)) {
      return {
        estado: 'amarillo',
        titulo: 'Alerta Amarilla: Precaución y Ajuste Sugerido',
        descripcion: 'Carga entre 35% y 45%. Mantén un ojo en las cuentas por vencer esta semana para evitar sobregiros.',
        cargaFinancieraPct: Math.max(cargaFinancieraActual, 36),
        scoreDicom: 710,
        riesgoTexto: 'Alerta Preventiva',
      };
    }

    return {
      estado: 'verde',
      titulo: 'Blindaje Activo: Finanzas Blindadas',
      descripcion: 'Carga financiera saludable (<35%), sin sobregiros y con cobertura total para los pagos del mes.',
      cargaFinancieraPct: cargaFinancieraActual || 23,
      scoreDicom: 865,
      riesgoTexto: 'Excelente Comportamiento',
    };
  }, [semaforoOverride, cargaFinancieraActual, vencimientos, saldoLiquidoTotal, lineaSobregiroUtilizada, lineaSobregiroTotal]);

  // Acciones
  const agregarAporteMeta = (metaId: string, monto: number) => {
    setMetas((prev) =>
      prev.map((m) => {
        if (m.id === metaId) {
          const nuevoAhorro = Math.min(m.montoObjetivo, m.montoAhorrado + monto);
          const pct = Math.round((nuevoAhorro / m.montoObjetivo) * 100);

          // Si alcanzó un hito importante, lanzamos confeti
          if (pct >= 50 || pct >= 100) {
            try {
              confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
            } catch (e) {
              // Ignore in environments without window/canvas
            }
          }

          // Ajustamos fecha estimada de llegada restando meses
          const mesesMenos = Math.max(1, Math.round(monto / (m.aporteMensualSugerido || 250000)));
          return {
            ...m,
            montoAhorrado: nuevoAhorro,
          };
        }
        return m;
      })
    );
    mostrarToast(`¡Excelente! Aporte de $${monto.toLocaleString('es-CL')} acreditado a tu meta. Tu fecha estimada de logro se adelantó.`);
  };

  const crearNuevaMeta = (nueva: Omit<MetaPatrimonial, 'id' | 'montoAhorrado'>) => {
    const id = `meta-${Date.now()}`;
    const metaCreada: MetaPatrimonial = {
      ...nueva,
      id,
      montoAhorrado: 0,
    };
    setMetas((prev) => [metaCreada, ...prev]);
    setMetaSeleccionadaId(id);
    mostrarToast(`¡Nueva meta "${nueva.titulo}" creada con éxito!`);
  };

  const marcarPagoRealizado = (id: string) => {
    setVencimientos((prev) =>
      prev.map((v) => {
        if (v.id === id) {
          return { ...v, pagado: true, estado: 'pagado' };
        }
        return v;
      })
    );
    try {
      confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 } });
    } catch (e) {}
    mostrarToast('Cuenta marcada como pagada. Tu blindaje anti-DICOM se actualizó favorablemente.');
  };

  const sincronizarCuentas = () => {
    setIsSyncing(true);
    setTimeout(() => {
      setCuentas((prev) =>
        prev.map((c) => ({
          ...c,
          ultimaSincronizacion: 'Recién actualizado',
        }))
      );
      setIsSyncing(false);
      mostrarToast('Sincronización bancaria Open Finance completada con éxito.');
    }, 1500);
  };

  const conectarNuevoBanco = (banco: string, tipo: string, saldoInicial: number) => {
    const nuevaCta: CuentaBancaria = {
      id: `cta-${Date.now()}`,
      banco,
      logo: banco.toLowerCase().includes('bci') ? 'BCI' : banco.toLowerCase().includes('scotia') ? 'SCO' : 'BAN',
      tipoCuenta: tipo,
      numeroEnmascarado: `•••• ${Math.floor(1000 + Math.random() * 9000)}`,
      saldoDisponible: saldoInicial,
      ultimaSincronizacion: 'Recién conectado',
      estado: 'conectado',
    };
    setCuentas((prev) => [...prev, nuevaCta]);
    mostrarToast(`¡Cuenta de ${banco} conectada exitosamente mediante Open Finance!`);
  };

  const completarLeccion = (cursoId: string, leccionId: string) => {
    setCursos((prev) =>
      prev.map((curso) => {
        if (curso.id === cursoId) {
          const nuevasLecciones = curso.lecciones.map((l) => (l.id === leccionId ? { ...l, completada: true } : l));
          const completadasCount = nuevasLecciones.filter((l) => l.completada).length;
          const nuevoProgreso = Math.round((completadasCount / nuevasLecciones.length) * 100);

          if (nuevoProgreso === 100) {
            try {
              confetti({ particleCount: 100, spread: 80, origin: { y: 0.5 } });
            } catch (e) {}
            mostrarToast(`¡Felicitaciones! Has completado el curso "${curso.titulo}".`);
          }

          const cursoActualizado = {
            ...curso,
            progreso: nuevoProgreso,
            lecciones: nuevasLecciones,
          };
          if (cursoModalAbierto?.id === cursoId) {
            setCursoModalAbierto(cursoActualizado);
          }
          return cursoActualizado;
        }
        return curso;
      })
    );
  };

  const invertirEnOportunidad = (oportunidadId: string, monto: number): boolean => {
    const op = oportunidades.find((o) => o.id === oportunidadId);
    if (!op) return false;

    if (monto > saldoLiquidoTotal) {
      mostrarToast('Saldo insuficiente en tus cuentas disponibles para este monto.');
      return false;
    }

    // Descontar saldo de la cuenta con mayor liquidez
    setCuentas((prev) => {
      let restanteADescontar = monto;
      return prev.map((c) => {
        if (restanteADescontar <= 0) return c;
        if (c.saldoDisponible >= restanteADescontar) {
          const nuevo = c.saldoDisponible - restanteADescontar;
          restanteADescontar = 0;
          return { ...c, saldoDisponible: nuevo };
        } else {
          restanteADescontar -= c.saldoDisponible;
          return { ...c, saldoDisponible: 0 };
        }
      });
    });

    // Actualizar financiamiento de la orden
    setOportunidades((prev) =>
      prev.map((o) => {
        if (o.id === oportunidadId) {
          return {
            ...o,
            montoFinanciado: Math.min(o.montoTotalOC, o.montoFinanciado + monto),
          };
        }
        return o;
      })
    );

    // Ganancia esperada según tasa y plazo
    const factorGanancia = 1 + (op.tasaMensual / 100) * (op.plazoDias / 30);
    const retornoEsperado = Math.round(monto * factorGanancia);

    const nuevaInversion: InversionUsuario = {
      id: `inv-${Date.now()}`,
      oportunidadId: op.id,
      codigoOC: op.codigoOC,
      mandante: op.mandante,
      pyme: op.pymeRazonSocial,
      montoInvertido: monto,
      tasaMensual: op.tasaMensual,
      retornoEsperado,
      fechaInversion: new Date().toISOString().split('T')[0],
      fechaEstimadaPago: op.fechaLiquidacionEstimada,
      estado: 'en_ejecucion',
    };

    setMisInversiones((prev) => [nuevaInversion, ...prev]);

    try {
      confetti({ particleCount: 90, spread: 80, origin: { y: 0.6 } });
    } catch (e) {}

    mostrarToast(
      `¡Inversión de $${monto.toLocaleString('es-CL')} confirmada en ${op.codigoOC}! Ganancia proyectada: $${(
        retornoEsperado - monto
      ).toLocaleString('es-CL')}`
    );
    return true;
  };

  return (
    <PersonasContext.Provider
      value={{
        moduloActivo,
        setModuloActivo,
        nombreUsuario,
        rutUsuario,
        ingresoLiquidoMensual,
        setIngresoLiquidoMensual,
        ufValor,
        metas,
        metaSeleccionada,
        setMetaSeleccionadaId,
        agregarAporteMeta,
        crearNuevaMeta,
        cuentas,
        vencimientos,
        gastosMensuales,
        historicoFlujo,
        marcarPagoRealizado,
        sincronizarCuentas,
        isSyncing,
        conectarNuevoBanco,
        semaforoOverride,
        setSemaforoOverride,
        semaforoInfo,
        saldoLiquidoTotal,
        cupoTarjetasTotal,
        cupoTarjetasUtilizado,
        lineaSobregiroTotal,
        lineaSobregiroUtilizada,
        cargaFinancieraActual,
        cursos,
        completarLeccion,
        cursoModalAbierto,
        setCursoModalAbierto,
        solicitarPackEmpresasModal,
        setSolicitarPackEmpresasModal,
        oportunidades,
        misInversiones,
        invertirEnOportunidad,
        oportunidadParaInvertir,
        setOportunidadParaInvertir,
        modalBancoAbierto,
        setModalBancoAbierto,
        modalNuevaMetaAbierto,
        setModalNuevaMetaAbierto,
        mensajeToast,
        mostrarToast,
      }}
    >
      {children}
    </PersonasContext.Provider>
  );
}

export function usePersonas() {
  const context = useContext(PersonasContext);
  if (!context) {
    throw new Error('usePersonas debe usarse dentro de un PersonasProvider');
  }
  return context;
}
