// senhas obvias/mais usadas no Brasil e no geral -- bloqueadas mesmo se passarem
// nas outras regras (ex: "Senha123" teria letra+numero+8 chars mas ainda e obvia)
const SENHAS_COMUNS = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "password",
  "password1",
  "senha123",
  "senha1234",
  "qwerty123",
  "qwertyui",
  "abcdefgh",
  "12345678a",
  "a12345678",
  "11111111",
  "00000000",
  "87654321",
  "asdfghjk",
  "brasil123",
  "admin123",
  "iloveyou",
]);

// retorna null se a senha for forte o suficiente, ou uma mensagem de erro explicando o motivo
export function validatePassword(password: string): string | null {
  if (password.length < 8) return "A senha precisa ter pelo menos 8 caracteres.";
  // exigir letra + numero already bloqueia senha 100% numerica (tipo data de nascimento: 15081995)
  if (!/[a-zA-Z]/.test(password)) return "A senha precisa ter pelo menos uma letra (não pode ser só números, como uma data de nascimento).";
  if (!/[0-9]/.test(password)) return "A senha precisa ter pelo menos um número.";

  const semEspacos = password.trim();
  if (SENHAS_COMUNS.has(semEspacos.toLowerCase())) return "Essa senha é muito comum, escolha outra.";

  // repeticao do mesmo caractere o tempo todo (ex: aaaaaaaa)
  if (/^(.)\1+$/.test(semEspacos)) return "A senha não pode ser o mesmo caractere repetido.";

  return null;
}
