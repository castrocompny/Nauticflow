import { describe, it, expect, beforeEach, vi } from "vitest";

// deleteReservation: o bloqueio de verdade é o trigger trg_reservation_
// marketplace_delete_guard (migration 0080, testado em supabase/tests/
// database/). Aqui só o que a server action devolve pro operador quando o
// banco recusa apagar uma reserva do marketplace.

type DeleteResult = { error: { message: string } | null };
let deleteResult: DeleteResult;

const deleteQuery = {
  eq: vi.fn(() => deleteQuery),
  then: (resolve: (value: DeleteResult) => unknown) => resolve(deleteResult),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { company_id: "c-1" } }) }),
          }),
        };
      }
      return { delete: () => deleteQuery };
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/profile", () => ({ getProfile: vi.fn() }));
vi.mock("@/lib/subscription", () => ({ requireActiveSubscription: vi.fn() }));

function formWithId(id: string): FormData {
  const fd = new FormData();
  fd.set("id", id);
  return fd;
}

beforeEach(() => {
  deleteResult = { error: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("deleteReservation", () => {
  it("tells the operator to cancel instead when the database refuses to delete a marketplace booking", async () => {
    deleteResult = { error: { message: "MARKETPLACE_RESERVATION_DELETE_FORBIDDEN" } };
    const { deleteReservation } = await import("./actions");
    const result = await deleteReservation(formWithId("r-1"));
    expect(result.error).toBe(
      "Reservas do marketplace não podem ser excluídas. Altere o status para Cancelada."
    );
  });

  it("keeps the generic message for other database errors", async () => {
    deleteResult = { error: { message: "algum outro erro" } };
    const { deleteReservation } = await import("./actions");
    const result = await deleteReservation(formWithId("r-1"));
    expect(result.error).toBe("Não foi possível excluir a reserva. Tente novamente.");
  });

  it("returns no error when the delete succeeds", async () => {
    const { deleteReservation } = await import("./actions");
    const result = await deleteReservation(formWithId("r-1"));
    expect(result.error).toBe("");
  });
});
