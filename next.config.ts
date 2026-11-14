import type { NextConfig } from "next";

const ERP_BACKEND_URL = process.env.ERP_BACKEND_URL || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  skipTrailingSlashRedirect: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return {
      afterFiles: [
        {
          source: "/erp",
          destination: `${ERP_BACKEND_URL}/`,
        },
        {
          source: "/erp/",
          destination: `${ERP_BACKEND_URL}/`,
        },
        {
          source: "/static/:path*",
          destination: `${ERP_BACKEND_URL}/static/:path*`,
        },
        {
          source: "/share/:path*",
          destination: `${ERP_BACKEND_URL}/share/:path*`,
        },
        {
          source: "/docs",
          destination: `${ERP_BACKEND_URL}/docs`,
        },
        {
          source: "/openapi.json",
          destination: `${ERP_BACKEND_URL}/openapi.json`,
        },
      ],
      fallback: [
        {
          source: "/api/companies/",
          destination: `${ERP_BACKEND_URL}/api/companies/`,
        },
        {
          source: "/api/folders/",
          destination: `${ERP_BACKEND_URL}/api/folders/`,
        },
        {
          source: "/api/tenders/",
          destination: `${ERP_BACKEND_URL}/api/tenders/`,
        },
        {
          source: "/api/quotations/",
          destination: `${ERP_BACKEND_URL}/api/quotations/`,
        },
        {
          source: "/api/commercial-docs/",
          destination: `${ERP_BACKEND_URL}/api/commercial-docs/`,
        },
        {
          source: "/api/:path*",
          destination: `${ERP_BACKEND_URL}/api/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
