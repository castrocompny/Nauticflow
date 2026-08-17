// Mostrado instantaneamente pelo Next.js assim que o usuário clica num link do
// menu lateral, enquanto a page.tsx do destino ainda está buscando dados no
// servidor -- sem isso, o clique parecia "sem resposta" até o servidor terminar.
// Sidebar/Topbar (definidos no layout.tsx) continuam visíveis e clicáveis; só a
// área de conteúdo troca por este esqueleto.
export default function Loading() {
  return (
    <div className="animate-pulse space-y-5" aria-hidden="true">
      <div className="flex items-center justify-between">
        <div className="h-7 w-48 rounded-md bg-surfaceHover" />
        <div className="h-9 w-32 rounded-lg bg-surfaceHover" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 rounded-card border border-line bg-surface" />
        ))}
      </div>
      <div className="h-64 rounded-card border border-line bg-surface" />
      <div className="h-64 rounded-card border border-line bg-surface" />
    </div>
  );
}
