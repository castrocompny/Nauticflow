import { defineConfig } from "vitest/config";
import path from "path";

// Base mínima de testes (achado da auditoria de prontidão ToursFlow,
// 2026-09-24: repositório não tinha nenhum framework de teste). Cobre só
// lógica isolável em memória (auth/flags/validação/mapeamento de status,
// Asaas com fetch mockado) -- nada que dependa de Postgres real, que segue
// marcado E2E/DB INTEGRATION REQUIRED nos próprios arquivos de teste.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
