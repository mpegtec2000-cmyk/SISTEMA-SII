export type ModuloId = 'metas' | 'blindaje' | 'empresario' | 'creditos' | 'inversiones';

export type CategoriaMeta = 'casa' | 'auto' | 'emprender' | 'otro';

export interface MetaPatrimonial {
  id: string;
  titulo: string;
  categoria: CategoriaMeta;
  icono: string;
  montoObjetivo: number;
  montoAhorrado: number;
  plazoMeses: number;
  fechaInicio: string;
  fechaEstimada: string;
  aporteMensualSugerido: number;
  imagenUrl: string;
  descripcion: string;
}

export interface CuentaBancaria {
  id: string;
  banco: string;
  logo: string;
  tipoCuenta: string;
  numeroEnmascarado: string;
  saldoDisponible: number;
  cupoTotal?: number;
  cupoUtilizado?: number;
  lineaSobregiroTotal?: number;
  lineaSobregiroUtilizada?: number;
  ultimaSincronizacion: string;
  estado: 'conectado' | 'sincronizando' | 'error';
}

export interface VencimientoPago {
  id: string;
  entidad: string;
  descripcion: string;
  categoria: 'tarjeta' | 'credito' | 'servicios' | 'otro';
  montoTotal: number;
  pagoMinimo?: number;
  fechaVencimiento: string;
  diasRestantes: number;
  estado: 'al_dia' | 'alerta_t5' | 'alerta_t3' | 'alerta_t1' | 'pagado';
  pagado: boolean;
}

export type SemaforoEstado = 'verde' | 'amarillo' | 'rojo';

export interface SemaforoInfo {
  estado: SemaforoEstado;
  titulo: string;
  descripcion: string;
  cargaFinancieraPct: number;
  scoreDicom: number;
  riesgoTexto: string;
}

export interface GastoMensual {
  categoria: string;
  monto: number;
  porcentaje: number;
  color: string;
}

export interface HistoricoFlujo {
  mes: string;
  ingresos: number;
  gastos: number;
  deudaNeta: number;
}

export interface LeccionCurso {
  id: string;
  titulo: string;
  duracion: string;
  completada: boolean;
  contenido: string;
  consejosClave: string[];
}

export interface CursoAcademia {
  id: string;
  numero: number;
  titulo: string;
  subtitulo: string;
  descripcion: string;
  nivel: 'Inicial' | 'Intermedio' | 'Avanzado';
  duracionEstimada: string;
  progreso: number; // 0 - 100
  portadaColor: string;
  icono: string;
  lecciones: LeccionCurso[];
}

export interface BrechaCredito {
  tipo: 'critica' | 'advertencia' | 'info';
  titulo: string;
  descripcion: string;
  solucionSugerida: string;
}

export interface OportunidadInversion {
  id: string;
  codigoOC: string;
  mandante: string;
  tipoMandante: 'Publico' | 'Privado' | 'Gran Empresa';
  pymeRazonSocial: string;
  rubro: string;
  montoTotalOC: number;
  montoFinanciado: number;
  tasaMensual: number; // e.g. 1.65 (1.65%)
  tasaAnual: number;
  plazoDias: number;
  riesgo: 'A+' | 'A' | 'B+';
  fechaLiquidacionEstimada: string;
  garantia: string;
  descripcion: string;
}

export interface InversionUsuario {
  id: string;
  oportunidadId: string;
  codigoOC: string;
  mandante: string;
  pyme: string;
  montoInvertido: number;
  tasaMensual: number;
  retornoEsperado: number;
  fechaInversion: string;
  fechaEstimadaPago: string;
  estado: 'en_ejecucion' | 'factura_cedida' | 'por_pagar' | 'liquidado';
}
