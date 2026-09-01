// Chave Pix de destino do operador (marketplace) -- validação de FORMATO
// pura, sem I/O. Mesmo contrato de manutenção já usado para
// calculateMarketplaceAmounts/calculateRefund (src/lib/marketplace-ledger.ts):
// a migration 0054 espelha exatamente esta lógica em SQL, as duas precisam
// ficar idênticas.
//
// IMPORTANTE: validar formato/checksum NÃO confirma que a chave existe ou
// pertence ao operador -- isso só o provider (Asaas) pode confirmar, e essa
// integração ainda não existe. Por isso toda conta cadastrada aqui nasce
// 'unverified' e permanece assim até essa integração real ser desenhada (ver
// docs/adr/0003-marketplace-payout-destination-and-release-policy.md).

export type PixKeyType = "cpf" | "cnpj" | "email" | "telefone" | "evp";

export const PIX_KEY_TYPES: readonly PixKeyType[] = ["cpf", "cnpj", "email", "telefone", "evp"] as const;

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

// Mesmo algoritmo de public.trial_validate_cpf (migration 0045) -- checksum
// REAL (dois dígitos verificadores), não só contagem de dígitos. Repetido
// aqui (não reaproveitado via chamada de rede) porque este é código de
// FORMULÁRIO, roda no processo Node da rota/action, nunca tem acesso direto
// ao Postgres da mesma forma que uma RPC interna teria.
export function isValidCpfChecksum(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false; // sequência repetida (ex: 11111111111)

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
  let remainder = sum % 11;
  const d1 = remainder < 2 ? 0 : 11 - remainder;
  if (d1 !== Number(digits[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(digits[i]) * (11 - i);
  remainder = sum % 11;
  const d2 = remainder < 2 ? 0 : 11 - remainder;
  if (d2 !== Number(digits[10])) return false;

  return true;
}

// Mesmo algoritmo de public.trial_validate_cnpj (migration 0045).
export function isValidCnpjChecksum(digits: string): boolean {
  if (!/^\d{14}$/.test(digits)) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * weights1[i];
  let remainder = sum % 11;
  const d1 = remainder < 2 ? 0 : 11 - remainder;
  if (d1 !== Number(digits[12])) return false;

  sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(digits[i]) * weights2[i];
  remainder = sum % 11;
  const d2 = remainder < 2 ? 0 : 11 - remainder;
  if (d2 !== Number(digits[13])) return false;

  return true;
}

// Estrutural, básico -- mesmo padrão já usado em POST /marketplace/bookings
// pro e-mail do cliente final (marketplace-api.ts), não um parser RFC 5322
// completo (não é o objetivo aqui).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmailFormat(value: string): boolean {
  return EMAIL_PATTERN.test(value) && value.length <= 320;
}

// Telefone brasileiro: DDD (2) + número (8 ou 9 dígitos) = 10 ou 11 dígitos.
export function isValidPhoneDigits(digits: string): boolean {
  return /^\d{10,11}$/.test(digits);
}

// Chave aleatória (EVP) do Pix é sempre um UUID v4 formatado com hífens.
const EVP_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidEvpFormat(value: string): boolean {
  return EVP_PATTERN.test(value);
}

export type ValidatePixKeyResult = { valid: true; normalized: string } | { valid: false; error: string };

// Normaliza e valida SÓ o formato (nunca a titularidade -- ver comentário no
// topo do arquivo). cpf/cnpj/telefone são normalizados pra dígitos puros;
// email é normalizado pra minúsculas/trim; evp é normalizado pra minúsculas
// (UUIDs são case-insensitive por convenção, mas armazenamos consistente).
export function validatePixKey(type: PixKeyType, rawValue: string): ValidatePixKeyResult {
  const trimmed = (rawValue ?? "").trim();
  if (!trimmed) return { valid: false, error: "Chave Pix é obrigatória." };

  switch (type) {
    case "cpf": {
      const digits = onlyDigits(trimmed);
      if (!isValidCpfChecksum(digits)) return { valid: false, error: "CPF inválido." };
      return { valid: true, normalized: digits };
    }
    case "cnpj": {
      const digits = onlyDigits(trimmed);
      if (!isValidCnpjChecksum(digits)) return { valid: false, error: "CNPJ inválido." };
      return { valid: true, normalized: digits };
    }
    case "email": {
      const normalized = trimmed.toLowerCase();
      if (!isValidEmailFormat(normalized)) return { valid: false, error: "E-mail inválido." };
      return { valid: true, normalized };
    }
    case "telefone": {
      const digits = onlyDigits(trimmed);
      if (!isValidPhoneDigits(digits)) return { valid: false, error: "Telefone inválido -- use DDD + número (10 ou 11 dígitos)." };
      return { valid: true, normalized: digits };
    }
    case "evp": {
      const normalized = trimmed.toLowerCase();
      if (!isValidEvpFormat(normalized)) return { valid: false, error: "Chave aleatória (EVP) inválida -- formato esperado é um UUID." };
      return { valid: true, normalized };
    }
    default: {
      const exhaustive: never = type;
      return { valid: false, error: `Tipo de chave desconhecido: ${exhaustive as string}` };
    }
  }
}

// Mascaramento -- NUNCA usado pra decidir nada, só pra exibição. O valor
// completo nunca deve ser devolvido por nenhuma API/RPC voltada ao operador
// (ver migration 0054: só service_role tem SELECT direto na coluna crua).
export function maskPixKey(type: PixKeyType, normalized: string): string {
  switch (type) {
    case "cpf":
      return `***.***.***-${normalized.slice(-2)}`;
    case "cnpj":
      return `**.***.***/****-${normalized.slice(-2)}`;
    case "telefone": {
      const last4 = normalized.slice(-4);
      return `(**) *****-${last4}`;
    }
    case "email": {
      const at = normalized.indexOf("@");
      if (at <= 0) return "***";
      const local = normalized.slice(0, at);
      const domain = normalized.slice(at + 1);
      const visible = local.slice(0, Math.min(2, local.length));
      return `${visible}***@${domain}`;
    }
    case "evp":
      return `${normalized.slice(0, 8)}...${normalized.slice(-6)}`;
    default: {
      const exhaustive: never = type;
      return `***${exhaustive as string}`;
    }
  }
}
