import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import { HeaderChrome, FooterChrome } from "@/components/ConditionalChrome";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FINANZIA · Gestión financiera, contable, legal e inmobiliaria",
  description:
    "Plataforma SaaS para PyMEs y personas: diagnósticos, planes mensuales, créditos, bancarización y consignación inmobiliaria.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen antialiased">
        <Suspense fallback={<div className="h-14 border-b border-slate-200 bg-white" />}>
          <HeaderChrome>
            <SiteHeader />
          </HeaderChrome>
        </Suspense>
        <Suspense fallback={<div className="p-10 text-slate-500">Cargando…</div>}>{children}</Suspense>
        <Suspense fallback={null}>
          <FooterChrome>
            <footer className="mt-20 border-t border-slate-200 py-8 text-center text-sm text-slate-500">
              © FINANZIA · Todos los derechos reservados
            </footer>
          </FooterChrome>
        </Suspense>
      </body>
    </html>
  );
}
