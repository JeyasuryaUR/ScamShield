import type { Tables } from "@/lib/database.types";

export type DecisionWithTxn = Tables<"decisions"> & { transactions: Tables<"transactions"> | null };

export const DECISION_WITH_TXN = "*, transactions(*)" as const;

export type QueueCounts = { pending: number; awaiting: number; total: number };
