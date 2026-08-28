import { createHmac } from "node:crypto";

// Módulo server-only (mesma convenção de src/lib/image-moderation.ts -- nunca
// importado por um "use client"). Responsabilidade: validação REAL (dígito
// verificador) de CPF/CNPJ e cálculo de fingerprint HMAC-SHA256, usados pelo
// anti-abuso do trial de 7 dias (ver DOCUMENTACAO.md, migration 0045).
//
// DECISÃO DE ARQUITETURA IMPORTANTE: estas funções aqui NÃO são a autoridade
// que decide se um trial é concedido -- essa decisão mora inteira dentro do
// gatilho handle_new_user() no banco (migration 0045), que recalcula a MESMA
// validação e o MESMO fingerprint a partir do dado bruto (CPF/CNPJ e e-mail),
// nunca confiando num fingerprint pronto vindo de fora. Motivo: o endpoint
// `auth.signup` do Supabase é público (chave anon já é pública no bundle do
// navegador) e pode ser chamado DIRETO, sem passar pelo Server Action
// signUp() abaixo -- se o gatilho confiasse num document_fingerprint/
// email_fingerprint pronto, mandado como metadata, um atacante podia mandar
// qualquer valor aleatório ali e sempre "parecer" uma identidade nova,
// destruindo o anti-abuso por completo. Esta é exatamente a mesma lógica já
// usada pra RPC/gatilhos do projeto inteiro (create_marketplace_booking,
// validate_tour_for_publishing): a fonte de verdade de segurança é sempre o
// banco, nunca a camada de cima.
//
// Este módulo existe mesmo assim porque tem dois usos legítimos e seguros:
// 1) validação antecipada no Server Action signUp() -- rejeitar CPF/CNPJ com
//    dígito verificador inválido ANTES de chamar auth.signUp(), com mensagem
//    melhor do que a genérica do gatilho (não depende de pepper nenhum, é só
//    matemática pública);
// 2) testável isoladamente (mesmo padrão desta sessão -- scripts standalone,
//    sem framework), garantindo que o algoritmo aqui bate byte a byte com o
//    equivalente em PL/pgSQL na migration 0045 -- ver comentário lá.

export type DocumentKind = "cpf" | "cnpj";

export function normalizeDocumentDigits(raw: string): string {
  return (raw || "").replace(/\D/g, "");
}

export function normalizeEmail(raw: string): string {
  return (raw || "").trim().toLowerCase();
}

// true quando os 11/14 dígitos são todos iguais (000...0, 111...1, ...) --
// esses valores passam no cálculo ingênuo de dígito verificador por
// coincidência matemática (quirk conhecido do algoritmo), então precisam de
// um bloqueio explícito à parte.
function isRepeatedDigitSequence(digits: string): boolean {
  return /^(\d)\1+$/.test(digits);
}

function cpfCheckDigit(digits: string, weightStart: number): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += Number(digits[i]) * (weightStart - i);
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCpf(rawOrDigits: string): boolean {
  const digits = normalizeDocumentDigits(rawOrDigits);
  if (digits.length !== 11) return false;
  if (isRepeatedDigitSequence(digits)) return false;

  const d1 = cpfCheckDigit(digits.slice(0, 9), 10);
  if (d1 !== Number(digits[9])) return false;
  const d2 = cpfCheckDigit(digits.slice(0, 10), 11);
  if (d2 !== Number(digits[10])) return false;
  return true;
}

function cnpjCheckDigit(digits: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += Number(digits[i]) * weights[i];
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

const CNPJ_WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

export function isValidCnpj(rawOrDigits: string): boolean {
  const digits = normalizeDocumentDigits(rawOrDigits);
  if (digits.length !== 14) return false;
  if (isRepeatedDigitSequence(digits)) return false;

  const d1 = cnpjCheckDigit(digits.slice(0, 12), CNPJ_WEIGHTS_1);
  if (d1 !== Number(digits[12])) return false;
  const d2 = cnpjCheckDigit(digits.slice(0, 13), CNPJ_WEIGHTS_2);
  if (d2 !== Number(digits[13])) return false;
  return true;
}

// Dispatcha pelo tamanho (11 = CPF, 14 = CNPJ) -- mesma convenção já usada no
// resto do projeto (companies.cnpj aceita os dois, campo legado).
export function isValidDocument(rawOrDigits: string): boolean {
  const digits = normalizeDocumentDigits(rawOrDigits);
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return false;
}

export function detectDocumentKind(rawOrDigits: string): DocumentKind | null {
  const digits = normalizeDocumentDigits(rawOrDigits);
  if (digits.length === 11) return "cpf";
  if (digits.length === 14) return "cnpj";
  return null;
}

const DOCUMENT_FINGERPRINT_PREFIX = "trial:document:v1:";
const EMAIL_FINGERPRINT_PREFIX = "trial:email:v1:";

// HMAC-SHA256 hex (64 chars minúsculos) -- mesmo algoritmo da versão em
// PL/pgSQL (migration 0045, função public.trial_fingerprint) que É a
// autoridade de verdade. As duas implementações precisam continuar
// idênticas -- documentado nos dois lugares.
export function computeDocumentFingerprint(pepper: string, normalizedDigits: string): string {
  return createHmac("sha256", pepper).update(DOCUMENT_FINGERPRINT_PREFIX + normalizedDigits).digest("hex");
}

export function computeEmailFingerprint(pepper: string, normalizedEmail: string): string {
  return createHmac("sha256", pepper).update(EMAIL_FINGERPRINT_PREFIX + normalizedEmail).digest("hex");
}

export function getTrialIdentityPepper(): string | null {
  const pepper = process.env.TRIAL_IDENTITY_PEPPER;
  return pepper && pepper.length > 0 ? pepper : null;
}
