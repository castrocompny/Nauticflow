import nextConfig from "eslint-config-next/core-web-vitals";

// next lint foi removido no Next 16 -- agora e so ESLint direto, com config flat
// (formato novo do ESLint 9). O .eslintrc.json antigo nao e mais lido.
const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "supabase/**"] },
  ...nextConfig,
];

export default eslintConfig;
