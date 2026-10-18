// The /pay demo customer. Their history is seeded in the scorer (services/scorer/scorer/demo_seed.py).
export const DEMO_ACCOUNT = "C-DEMO-PRIYA";
export const DEMO_BALANCE = 52_000;

export type Scenario = {
  id: string;
  label: string;
  payee: string;
  payeeName: string;
  amount: number;
  type: "PAYMENT" | "TRANSFER";
  hour: number; // local hour (IST)
  minute: number;
  note: string;
};

export const SCENARIOS: Scenario[] = [
  {
    id: "grocer",
    label: "Groceries, usual shop",
    payee: "M-GROCER-ANNAI",
    payeeName: "Annai Stores",
    amount: 640,
    type: "PAYMENT",
    hour: 9,
    minute: 5,
    note: "Paid here many times before",
  },
  {
    id: "amma",
    label: "Money to Amma",
    payee: "C-AMMA",
    payeeName: "Amma",
    amount: 3_000,
    type: "TRANSFER",
    hour: 20,
    minute: 15,
    note: "Known payee, usual amount",
  },
  {
    id: "olx",
    label: "Advance to an online marketplace seller",
    payee: "C-OLX-SELLER",
    payeeName: "Seller (bike listing)",
    amount: 15_000,
    type: "TRANSFER",
    hour: 14,
    minute: 20,
    note: "First time paying this person",
  },
  {
    id: "kyc",
    label: "\"Bank KYC officer\" asks for a transfer",
    payee: "C-KYC-SUPPORT-77",
    payeeName: "KYC Verification Desk",
    amount: 48_500,
    type: "TRANSFER",
    hour: 23,
    minute: 42,
    note: "New payee, late at night, most of the balance",
  },
];
