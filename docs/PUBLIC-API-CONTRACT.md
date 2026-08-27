# Contrato da API Pública do NauticFlow — para consumo pelo ToursFlow

> Documento gerado por inspeção direta do código-fonte (`src/app/api/public/*`, `src/lib/public-api.ts`) e por chamadas reais contra produção, com um passeio de teste publicado e depois apagado. Nenhum campo aqui foi inventado — o que está descrito é exatamente o que a API responde hoje (26/08/2026). Se o código mudar depois, este arquivo pode ficar desatualizado — não é gerado automaticamente.

## 1. Base URL

Produção: **`https://nauticflow.com.br`** (domínio configurado em `NEXT_PUBLIC_SITE_URL` na Vercel — ver `src/lib/site-url.ts`).

- **Não existe URL de staging.** O workflow de branch de teste (`testes`) está pausado desde antes desta etapa — só existe produção (`main`) hoje.
- **Não existe URL de preview fixa.** A Vercel gera uma URL de preview *efêmera* por deploy quando um PR é aberto, mas isso não é um ambiente estável para o ToursFlow apontar.
- **Em desenvolvimento local**, use `http://localhost:3000` (rodando `npm run dev` neste repositório) — todas as rotas abaixo funcionam localmente, apontando pro **mesmo banco de produção** (não há banco de teste separado neste projeto agora).

Todas as rotas ficam sob o prefixo **`/api/public/`**.

## 2. Autenticação

**Nenhuma.** Confirmado no código (nenhuma das 5 rotas lê `Authorization`, cookie ou qualquer header customizado) e por teste real: todas responderam `200`/`404` normalmente sem nenhum header de autenticação.

Não precisa de: `Authorization`, API key, secret, cookie de sessão. É GET público de verdade.

**Achado nesta verificação (já corrigido, fora do escopo desta etapa de documentação, ver seção 12)**: até a correção, o middleware global do NauticFlow redirecionava chamadas sem sessão para `/login`, incluindo `/api/public/*` — ou seja, embora o *código* das rotas nunca tenha exigido autenticação, o *middleware* impedia o acesso público até isso ser corrigido. Hoje, já corrigido, confirmado funcionando sem qualquer autenticação.

## 3. `GET /api/public/tours`

**URL completa**: `https://nauticflow.com.br/api/public/tours`

### Query params (todos opcionais)

| Param | Tipo | Comportamento real confirmado |
|---|---|---|
| `destination` | string | Comparado (lowercase) contra `destination_slug` (sem acento). Sem match → lista vazia, nunca erro. |
| `category` | string | Deve ser um dos 6 valores da seção 7. Valor inválido → **`400`** `{"error":"Categoria inválida."}` |
| `page` | inteiro | `page=0`, negativo ou não-numérico → cai pra `1` silenciosamente (sem erro) |
| `limit` | inteiro | Testado com `limit=999` → **capado em `50`** silenciosamente (sem erro). Default sem o param: `20`. |

Não existem outros parâmetros (nem ordenação, nem busca por texto) hoje.

### Response shape (confirmado por chamada real)

```ts
{
  data: Array<{
    slug: string;
    name: string;
    shortDescription: string | null;
    destination: string | null;
    category: string | null;
    durationMinutes: number | null;
    priceType: string;           // "por_pessoa" | "por_grupo" | "a_partir_de"
    basePriceCents: number;      // inteiro, em centavos
    coverPhotoUrl: string | null; // signed URL já pronta (ver seção 9), ou null se não houver capa
    company: {
      name: string;
      city: string | null;
    };
  }>;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
```

**Não existe `id`** (nem uuid, nem numérico) neste item — só `slug`. **Não existe** `operator` (é `company`, sempre esse nome). `coverPhotoUrl` aqui é confirmadamente **a foto marcada como capa de verdade** (`is_cover=true`), não a primeira por ordem — testado com 2 fotos fora de ordem, o campo veio certo.

### Exemplo REAL (passeio de teste, apagado depois do teste)

```json
{
  "data": [
    {
      "slug": "teste-contrato-api-passeio-2484d3",
      "name": "TESTE CONTRATO API - Passeio",
      "shortDescription": "Passeio de teste pra validar o contrato da API.",
      "destination": "Arraial do Cabo",
      "category": "ilhas",
      "durationMinutes": 240,
      "priceType": "por_pessoa",
      "basePriceCents": 25000,
      "coverPhotoUrl": "https://gggpihphjjxndpfntnvm.supabase.co/storage/v1/object/sign/tour-photos/.../foto-posicao-1-e-a-capa.png?token=eyJ...",
      "company": { "name": "Admin Equipe Castro", "city": "Buzios" }
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 1,
  "totalPages": 1
}
```

## 4. `GET /api/public/tours/[slug]`

**URL completa**: `https://nauticflow.com.br/api/public/tours/{slug}`

### Response shape (confirmado por chamada real, campos exatos na ordem que o JSON real trouxe)

```ts
{
  data: {
    slug: string;
    name: string;
    shortDescription: string | null;
    destination: string | null;
    category: string | null;
    durationMinutes: number | null;
    priceType: string;
    basePriceCents: number;
    coverPhotoUrl: string | null;
    company: { name: string; city: string | null };
    description: string | null;
    itinerary: string | null;
    included: string | null;
    notIncluded: string | null;             // camelCase — não é "not_included"
    importantInformation: string | null;
    cancellationPolicy: string | null;
    boarding: {
      name: string | null;
      address: string | null;
      neighborhood: string | null;
      city: string | null;
      state: string | null;
      zipCode: string | null;                // não é "zip_code"
      reference: string | null;
      instructions: string | null;
      latitude: number | null;
      longitude: number | null;
    };
    photos: string[];                        // ARRAY DE STRINGS — signed URLs prontas, nunca objetos
  }
}
```

**Sem `id`**, igual à listagem. **`photos` é um array plano de strings** (URLs já assinadas), na ordem de `position` — **não** é um array de objetos com `id`/`isCover`/`sortOrder`/`alt`. Se o ToursFlow precisar saber qual é a capa dentro de `photos`, hoje **não dá pra saber por esse array** — é preciso comparar com `coverPhotoUrl`.

`coverPhotoUrl` (tanto aqui quanto na listagem) segue esta regra, confirmada por teste real com 2 fotos fora de ordem (capa marcada na segunda posição): (1) a foto marcada `is_cover=true`; (2) se nenhuma estiver marcada como capa, a primeira por `position`; (3) `null` se não houver foto nenhuma. As duas rotas usam exatamente a mesma regra.

### Exemplo REAL

```json
{
  "data": {
    "slug": "teste-contrato-api-passeio-2484d3",
    "name": "TESTE CONTRATO API - Passeio",
    "shortDescription": "Passeio de teste pra validar o contrato da API.",
    "destination": "Arraial do Cabo",
    "category": "ilhas",
    "durationMinutes": 240,
    "priceType": "por_pessoa",
    "basePriceCents": 25000,
    "coverPhotoUrl": "https://.../foto-posicao-0-nao-capa.png?token=...",
    "company": { "name": "Admin Equipe Castro", "city": "Buzios" },
    "description": "Descrição completa de teste do contrato.",
    "itinerary": "Roteiro de teste.",
    "included": "Guia, água",
    "notIncluded": "Almoço",
    "importantInformation": "Levar protetor solar",
    "cancellationPolicy": "Cancelamento gratuito até 24h antes",
    "boarding": {
      "name": "Píer Teste Contrato",
      "address": "Av. Teste, 456",
      "neighborhood": "Praia dos Anjos",
      "city": "Arraial do Cabo",
      "state": "RJ",
      "zipCode": "28930-000",
      "reference": "Ao lado do posto de turismo",
      "instructions": "Chegar 20 minutos antes",
      "latitude": -22.9661,
      "longitude": -42.0278
    },
    "photos": [
      "https://.../foto-posicao-0-nao-capa.png?token=...",
      "https://.../foto-posicao-1-e-a-capa.png?token=..."
    ]
  }
}
```

## 5. `GET /api/public/tours/[slug]/departures`

**URL completa**: `https://nauticflow.com.br/api/public/tours/{slug}/departures`

### Response shape

```ts
{
  data: Array<{
    id: string;           // uuid da saída -- ÚNICO endpoint que expõe um id de verdade
    departsAt: string;    // ISO 8601, timezone UTC explícito (ver seção 10)
    priceCents: number;
    priceType: string;
    soldOut: boolean;
  }>
}
```

Não existe `availableSeats` nem `status` nem nenhum outro campo — confirmado lendo o código e por chamada real. Não existe paginação nesta rota (limite fixo de 100 no código, sem parâmetro pro consumidor mudar isso).

### Comportamento confirmado

- **Só saídas futuras**: filtro `departs_at >= agora` (comparação feita no servidor, no momento da chamada).
- **Cancelada nunca aparece**: filtro `status <> 'cancelada'`.
- **Saída sem preço nunca aparece**: filtro `price_cents is not null` — **não existe fallback pro preço-base do passeio aqui**. Se o operador não definiu preço na saída específica, ela simplesmente não aparece nesta lista (mesmo que o passeio tenha `basePriceCents`).
- `soldOut` é calculado no servidor comparando `capacity` real da embarcação (nunca exposta) contra `SUM(people_count)` de reservas `confirmada` — nunca é a capacidade que aparece, só o booleano.

### Exemplo REAL

```json
{
  "data": [
    {
      "id": "38e89c3e-70f0-4671-a5a8-c336e75468e4",
      "departsAt": "2026-09-06T14:00:00+00:00",
      "priceCents": 25000,
      "priceType": "por_pessoa",
      "soldOut": false
    }
  ]
}
```

## 6. `GET /api/public/destinations`

**URL completa**: `https://nauticflow.com.br/api/public/destinations`

```ts
{ data: Array<{ slug: string; name: string }> }
```

Exatamente 2 campos, sem mais nada. Só lista destinos que têm **ao menos um passeio `published`** no momento da chamada (não é uma lista fixa/cadastrada à parte). Ordenado alfabeticamente (`pt-BR`).

### Exemplo REAL

```json
{ "data": [{ "slug": "arraial-do-cabo", "name": "Arraial do Cabo" }] }
```

## 7. `GET /api/public/categories`

**URL completa**: `https://nauticflow.com.br/api/public/categories`

```ts
{ data: Array<{ value: string; label: string }> }
```

**Não é** `slug`/`name` — é **`value`/`label`**. Lista fixa (não consulta o banco), sempre estes 6 valores, na mesma ordem:

### Exemplo REAL (idêntico sempre)

```json
{
  "data": [
    { "value": "passeio_privativo", "label": "Passeio privativo" },
    { "value": "por_do_sol", "label": "Pôr do sol" },
    { "value": "praias", "label": "Praias" },
    { "value": "ilhas", "label": "Ilhas" },
    { "value": "passeio_compartilhado", "label": "Passeio compartilhado" },
    { "value": "outro", "label": "Outro" }
  ]
}
```

## 8. Status codes e erros

| Situação | Status | Corpo real |
|---|---|---|
| Sucesso (qualquer rota) | `200` | `{ "data": ... }` |
| `category` inválida em `/tours` | `400` | `{"error":"Categoria inválida."}` |
| Slug inexistente **ou** passeio não publicado (`/tours/[slug]`) | `404` | `{"error":"Passeio não encontrado."}` — **de propósito, os dois casos dão o mesmo erro** (não dá pra saber se o slug nunca existiu ou se existe mas está em draft/paused/rejected) |
| Slug inexistente/não publicado em `/departures` | `404` | `{"error":"Passeio não encontrado."}` |
| Erro interno do banco (qualquer rota) | `500` | `{"error":"Erro ao consultar passeios."}` / `"Erro ao consultar o passeio."` / `"Erro ao consultar saídas."` / `"Erro ao consultar destinos."` (mensagem genérica, nunca vaza detalhe/stack trace do erro real) |
| Passeio sem nenhuma saída futura precificada | `200` | `{"data":[]}` — **não é erro**, lista vazia normal |
| Falha ao gerar signed URL de uma foto específica | Não gera erro na rota — aquela foto é simplesmente **omitida** do array/campo (`coverPhotoUrl` vira `null` se a única foto falhar; `photos` só não inclui a que falhou) |

## 9. Signed URLs de fotos

**A URL já vem pronta pra usar** — `coverPhotoUrl` e cada item de `photos` já são URLs completas e assinadas (`https://<projeto>.supabase.co/storage/v1/object/sign/tour-photos/...?token=...`), geradas na hora da chamada. **O consumidor não precisa (e não consegue) montar nada** — é só usar a string como `src` de imagem direto.

**Expiram em 1 hora** (`PHOTO_SIGNED_URL_TTL_SECONDS = 3600` em `src/lib/public-api.ts`) a partir do momento em que a API foi chamada — não são estáveis pra cache de longo prazo. Se o ToursFlow cachear a resposta da API por mais de 1h, as URLs de foto vão expirar mesmo que o resto do conteúdo continue válido.

## 10. Timezone das saídas

`departsAt` é serializado diretamente da coluna `departures.departs_at` (`timestamptz` no Postgres) — vem sempre em **UTC, ISO 8601, com offset explícito `+00:00`** (confirmado no exemplo real: `"2026-09-06T14:00:00+00:00"`). O NauticFlow internamente trabalha em horário de Brasília (UTC-3, sem horário de verão) pra exibição — **o ToursFlow precisa fazer essa conversão por conta própria** se quiser mostrar o horário local; a API não devolve nada já convertido nem informa o fuso do operador.

## 11. CORS / consumo server-side pelo ToursFlow

**Nenhum header de CORS é enviado** hoje (confirmado com `curl -I` real — não existe `Access-Control-Allow-Origin` em nenhuma resposta). Isso **não é um problema** para o cenário descrito (ToursFlow consumindo a API do lado do servidor dele — Node.js, RSC, API route no próprio backend do ToursFlow): CORS é uma restrição imposta pelo **navegador**, não pela rede — uma chamada `fetch`/`axios` feita a partir de código rodando no servidor do ToursFlow nunca passa por essa checagem.

**Só importaria** se, no futuro, uma página do ToursFlow quisesse chamar `https://nauticflow.com.br/api/public/*` **direto do JavaScript rodando no navegador do visitante** — nesse caso, o navegador bloquearia por falta de `Access-Control-Allow-Origin`, e seria necessário adicionar headers de CORS nessas rotas (mudança de código simples, não feita agora por estar fora do escopo desta etapa).

Não há nenhuma outra limitação de rede/host — as rotas são endpoints HTTP públicos normais, sem allowlist de IP nem de domínio de origem.
