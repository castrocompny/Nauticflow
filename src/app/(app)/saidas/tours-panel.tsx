import { Card } from "@/components/ui";
import { DeleteButton } from "@/components/delete-button";
import { deleteTour } from "./actions";
import type { Tour } from "@/lib/types";

// Lista os passeios cadastrados da empresa com um botão de excluir em cada. É o lugar
// pra limpar a lista que aparece no dropdown de "Passeio" ao criar uma saída.
export function ToursPanel({ tours }: { tours: Tour[] }) {
  if (tours.length === 0) return null;

  return (
    <Card className="mb-4">
      <p className="font-display text-sm font-semibold text-heading">Passeios cadastrados</p>
      <p className="mt-0.5 text-xs text-muted">
        Esses são os passeios reutilizados no dropdown ao criar uma saída. Excluir remove da
        lista — se o passeio já tiver saídas, o histórico é preservado.
      </p>
      <ul className="mt-3 divide-y divide-line">
        {tours.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm text-body">{t.name}</span>
            <DeleteButton
              action={deleteTour}
              id={t.id}
              confirmText={`Excluir o passeio "${t.name}"? Se ele já tiver saídas cadastradas, ele só sai da lista (o histórico das saídas é mantido).`}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}
