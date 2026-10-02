// Create Financing Case form (S §9.3) → POST /api/cases body. Money stays a decimal string with an explicit ISO
// currency end to end ("100,000" → "100000.00"); an empty amount means "not requested", never 0.
import { CurrencyCodeSchema, DECIMAL_AMOUNT_PATTERN, DecimalAmountSchema, type CreateCaseRequest } from "@collara/domain";
import { z } from "zod";

export const CASE_CURRENCIES = ["USD", "EUR"] as const;

/** INFERRED copy (needs approval): field-level validation messages. */
export const CREATE_CASE_MESSAGES = {
  TITLE: "Enter a case name.",
  TITLE_LENGTH: "Use at most 120 characters.",
  ASSET: "Select a registered asset.",
  LENDER: "Select a lender.",
  PURPOSE_LENGTH: "Use at most 500 characters.",
  AMOUNT: "Enter an amount such as 100000.00 (at most two decimals), or leave it empty.",
} as const;

export const CreateCaseFormSchema = z
  .object({
    title: z.string().trim().min(1, CREATE_CASE_MESSAGES.TITLE).max(120, CREATE_CASE_MESSAGES.TITLE_LENGTH),
    assetRef: z.string().min(1, CREATE_CASE_MESSAGES.ASSET),
    purpose: z.string().trim().max(500, CREATE_CASE_MESSAGES.PURPOSE_LENGTH),
    selectedLenderOrgId: z.string().min(1, CREATE_CASE_MESSAGES.LENDER),
    /** "" = no dealer invited. */
    dealerOrgId: z.string(),
    principalAmount: z
      .string()
      .transform((value) => value.replaceAll(",", "").trim())
      .refine((value) => value === "" || DECIMAL_AMOUNT_PATTERN.test(value), { message: CREATE_CASE_MESSAGES.AMOUNT }),
    principalCurrency: CurrencyCodeSchema,
  })
  .transform(
    (v): CreateCaseRequest => ({
      title: v.title,
      assetRef: v.assetRef,
      selectedLenderOrgId: v.selectedLenderOrgId,
      ...(v.purpose ? { purpose: v.purpose } : {}),
      ...(v.dealerOrgId ? { dealerOrgId: v.dealerOrgId } : {}),
      ...(v.principalAmount ? { requestedPrincipal: { amount: DecimalAmountSchema.parse(v.principalAmount), currency: v.principalCurrency } } : {}),
    }),
  );

export type CreateCaseForm = z.input<typeof CreateCaseFormSchema>;

export const CREATE_CASE_DEFAULTS: CreateCaseForm = {
  title: "",
  assetRef: "",
  purpose: "",
  selectedLenderOrgId: "",
  dealerOrgId: "",
  principalAmount: "",
  principalCurrency: "USD",
};

/** Server validation paths (problem+json `issues`) → form fields, so errors are announced with their field. */
export function fieldOfIssue(path: string): keyof CreateCaseForm | null {
  const key = path.replace(/^body\./, "");
  if (key.startsWith("requestedPrincipal.currency")) return "principalCurrency";
  if (key.startsWith("requestedPrincipal")) return "principalAmount";
  const fields: readonly (keyof CreateCaseForm)[] = ["title", "assetRef", "purpose", "selectedLenderOrgId", "dealerOrgId"];
  return (fields as readonly string[]).includes(key) ? (key as keyof CreateCaseForm) : null;
}
