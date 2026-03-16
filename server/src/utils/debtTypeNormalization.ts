export interface DebtTypeNormalizationInput {
  debtType?: string | null;
  creditLimit?: number | null;
  lenderName?: string | null;
  accountTypeCode?: number | null;
}

function toLower(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function hasCreditLimit(value: number | null | undefined): boolean {
  return (value ?? 0) > 0;
}

export function isCardLikeAccount(input: DebtTypeNormalizationInput): boolean {
  const debt = toLower(input.debtType);
  const lender = toLower(input.lenderName);
  const limitBased = hasCreditLimit(input.creditLimit);
  const code = input.accountTypeCode ?? null;

  const cardLikeByType = debt.includes('credit card') || debt.includes('card');
  const cardLikeByLender = lender.includes('card');
  const cardLikeByTypeCode = code === 10 || code === 15 || code === 41 || code === 43;
  const cardLikeBusinessLine = limitBased && (
    debt === 'loan' ||
    debt.includes('business loan') ||
    debt.includes('consumer loan')
  );

  return cardLikeByType || cardLikeByLender || (limitBased && cardLikeByTypeCode) || cardLikeBusinessLine;
}

export function normalizeDebtTypeLabel(input: DebtTypeNormalizationInput): string {
  if (isCardLikeAccount(input)) return 'Credit Card';
  const raw = (input.debtType || '').trim();
  return raw || 'Loan';
}

