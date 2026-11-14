import type { Metadata } from 'next';
import { PersonasProvider } from '@/lib/personas/context';
import Header from '@/components/personas/Header';
import Sidebar from '@/components/personas/Sidebar';
import BottomBar from '@/components/personas/BottomBar';
import ModalConectarBanco from '@/components/personas/ModalConectarBanco';
import ModalPackEmpresas from '@/components/personas/ModalPackEmpresas';
import ModalInvertirOC from '@/components/personas/ModalInvertirOC';
import ModalCursoDetalle from '@/components/personas/ModalCursoDetalle';
import ModalNuevaMeta from '@/components/personas/ModalNuevaMeta';
import ToastNotification from '@/components/personas/ToastNotification';

export const metadata: Metadata = {
  title: 'Finazia - Portal Personas | Salud Financiera & Blindaje Anti-DICOM',
  description:
    'Plataforma integral de salud financiera para personas en Chile: metas patrimoniales, blindaje anti-DICOM, academia emprendedora, simulador de créditos con diagnóstico e inversión en órdenes de compra.',
};

export default function PersonasLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PersonasProvider>
      <div className="min-h-screen bg-[#EAECEF] text-zinc-950 p-1.5 sm:p-2.5 flex flex-col font-sans selection:bg-zinc-900 selection:text-white">
        <div className="saas-framed-shell flex-1 flex p-1.5 sm:p-2 gap-1.5 sm:gap-2 max-w-[1800px] w-full mx-auto min-h-[calc(100vh-20px)]">
          <Sidebar />
          <div className="saas-elevated-canvas flex-1 min-w-0 flex flex-col overflow-hidden">
            <Header />
            <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 pb-24 lg:pb-12 overflow-x-hidden">
              {children}
            </main>
          </div>
        </div>
        <BottomBar />

        {/* Modales Globales */}
        <ModalConectarBanco />
        <ModalPackEmpresas />
        <ModalInvertirOC />
        <ModalCursoDetalle />
        <ModalNuevaMeta />
        <ToastNotification />
      </div>
    </PersonasProvider>
  );
}
