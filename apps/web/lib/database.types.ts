// Mirrors supabase/migrations. Regenerate after schema changes:
//   npx supabase gen types typescript --local > apps/web/lib/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type DecisionStatus =
  | "allowed"
  | "awaiting_customer"
  | "pending_review"
  | "released"
  | "blocked"
  | "customer_verified"
  | "customer_cancelled";

export type Database = {
  public: {
    Tables: {
      audit_log: {
        Row: {
          id: number;
          at: string;
          actor: string;
          event: string;
          txn_id: string | null;
          decision_id: number | null;
          payload: Json;
          prev_hash: string | null;
          hash: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      decisions: {
        Row: {
          id: number;
          txn_id: string;
          risk: number;
          action: Database["public"]["Enums"]["txn_action"];
          status: DecisionStatus;
          reasons: Json;
          features: Json;
          model_version: string;
          latency_ms: number;
          decided_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "decisions_txn_id_fkey";
            columns: ["txn_id"];
            isOneToOne: true;
            referencedRelation: "transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      model_versions: {
        Row: { version: string; metrics: Json; policy: Json; created_at: string };
        Insert: { version: string; metrics: Json; policy: Json; created_at?: string };
        Update: { version?: string; metrics?: Json; policy?: Json; created_at?: string };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string;
          role: Database["public"]["Enums"]["app_role"];
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      reviews: {
        Row: {
          id: number;
          decision_id: number;
          reviewer_id: string;
          verdict: string;
          note: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "reviews_decision_id_fkey";
            columns: ["decision_id"];
            isOneToOne: false;
            referencedRelation: "decisions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_reviewer_id_fkey";
            columns: ["reviewer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      shortcut_audits: {
        Row: { id: number; model_version: string | null; mode: string; result: Json; created_at: string };
        Insert: { model_version?: string | null; mode: string; result: Json };
        Update: { model_version?: string | null; mode?: string; result?: Json };
        Relationships: [];
      };
      transactions: {
        Row: {
          id: string;
          account_id: string;
          payee_id: string;
          amount: number;
          type: string;
          ts: string;
          old_balance: number;
          channel: string;
          received_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      customer_respond: { Args: { p_txn_id: string; p_outcome: string }; Returns: DecisionStatus };
      ingest_decisions: { Args: { payload: Json }; Returns: number };
      review_decision: {
        Args: { p_decision_id: number; p_verdict: string; p_note?: string };
        Returns: DecisionStatus;
      };
      verify_audit_chain: {
        Args: never;
        Returns: { ok: boolean; checked: number; first_bad_id: number | null }[];
      };
    };
    Enums: {
      app_role: "analyst" | "compliance" | "admin";
      decision_status: DecisionStatus;
      txn_action: "allow" | "verify" | "hold";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database["public"];
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
