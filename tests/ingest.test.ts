import { describe, expect, it } from "vitest";
import {
  amountFromText,
  looksLikeTransfer,
  matchRule,
  merchantFromText,
  merchantKey,
  parseAmount,
  parseCapture,
  parseDate,
  referenceFromText,
  timeFromText,
} from "@/lib/ingest";

// Text as an iPhone reads it off payment screens (Shortcut: Take Screenshot → Extract Text).
// Shop names, people, accounts and references are made up.

const TODAY = "2026-10-03";

// TnG eWallet → Activity → a payment. The name in Payment Details wraps onto a second line.
const TNG_RECEIPT = `9:41
Transaction Details
-RM10.00
Payment Successful
Transaction Type
Payment
Merchant
ASIAN FOOD AND DESSERT
Payment Details
Payment - ASIAN FOOD AND
DESSERT
Date/Time
03/10/2026 12:41:07
Wallet Ref
20261003101100000012345678
Status
Successful`;

// The screen right after paying with DuitNow QR, with a logo letter read as text.
const QR_SUCCESS = `D
Payment successful
RM 8.50
Paid to
99 SPEEDMART 1234 TAMAN CONTOH
DuitNow Ref No.
20261003TNGDMYNB030OQR12345
3 Oct 2026, 7:15 PM
Done`;

// A transfer: labels first, then their values (how screen reading lists two columns).
const TRANSFER = `Transferred
RM 50.00
Transfer to
Recipient Bank/ E-Wallet
Account Number
DuitNow Ref No.
Date & Time
ALI BIN ABU
Example Bank
1234567890123
20261003EXMPMYKL0101234567
03/10/2026 09:32:00`;

describe("reading a payment screen", () => {
  it("reads a TnG receipt", () => {
    expect(parseCapture({ text: TNG_RECEIPT }, TODAY)).toEqual({
      amount: 10,
      merchant: "ASIAN FOOD AND DESSERT",
      date: "2026-10-03",
      isTransfer: false,
    });
    expect(timeFromText(TNG_RECEIPT)).toEqual({ hour: 12, minute: 41 });
  });

  it("reads a QR payment's success screen", () => {
    expect(parseCapture({ text: QR_SUCCESS }, TODAY)).toEqual({
      amount: 8.5,
      merchant: "99 SPEEDMART 1234 TAMAN CONTOH",
      date: "2026-10-03",
      isTransfer: false,
    });
    expect(timeFromText(QR_SUCCESS)).toEqual({ hour: 19, minute: 15 });
  });

  it("reads a transfer and flags it", () => {
    expect(parseCapture({ text: TRANSFER }, TODAY)).toEqual({
      amount: 50,
      merchant: "ALI BIN ABU",
      date: "2026-10-03",
      isTransfer: true,
    });
  });

  it("keeps a receipt whose amount is hidden (e.g. under a banner)", () => {
    const covered = TNG_RECEIPT.replace("-RM10.00\n", "");
    const c = parseCapture({ text: covered }, TODAY);
    expect(c.amount).toBeNull();
    expect(c.merchant).toBe("ASIAN FOOD AND DESSERT");
  });

  it("finds nothing on a screen that isn't a payment", () => {
    const home = "1:09\nMessages\nPhotos\nSettings";
    expect(parseCapture({ text: home }, TODAY)).toEqual({ amount: null, merchant: null, date: null, isTransfer: false });
    expect(referenceFromText(home)).toBeNull();
    expect(timeFromText(home)).toBeNull(); // the phone's clock isn't a payment time
  });

  it("prefers fields sent by Apple Pay or Siri over the text", () => {
    expect(parseCapture({ amount: "RM12.30", merchant: "  Test Cafe ", date: "2026-10-02" }, TODAY)).toEqual({
      amount: 12.3,
      merchant: "Test Cafe",
      date: "2026-10-02",
      isTransfer: false,
    });
  });
});

describe("bank app receipts", () => {
  // Layouts like Malaysian banking apps' success screens (made-up names and numbers).
  it.each([
    ["Beneficiary Name", "Transfer Successful\nRM 50.00\nBeneficiary Name\nALI BIN ABU\nReference ID\nMB12345678901\n03 Oct 2026 10:15 AM", "ALI BIN ABU", 50, true],
    ["Payee Name", "Payment Successful\nAmount\nRM 120.00\nPayee Name\nTNB\nDate\n03 Oct 2026", "TNB", 120, false],
    ["Recipient Name", "Successful\nMYR 25.00\nRecipient Name\nALI BIN ABU\n03/10/2026", "ALI BIN ABU", 25, false],
    ["Merchant Name", "Transaction Details\nMYR 15.90\nMerchant Name\nKEDAI CONTOH\nPosted 03 Oct 2026", "KEDAI CONTOH", 15.9, false],
    ["To:", "Payment Successful\nRM 30.00\nTo: ALI BIN ABU\nDuitNow Transfer\n03 Oct 2026", "ALI BIN ABU", 30, true],
    ["Payee Name: on one line", "Payment Successful\nRM 88.00\nPayee Name: SYARIKAT AIR CONTOH\n03 Oct 2026", "SYARIKAT AIR CONTOH", 88, false],
    ["Beneficiary Name, labels first", "Transfer Successful\nRM 10.00\nBeneficiary Name\nBeneficiary Bank\nReference ID\nALI BIN ABU\nExample Bank\nMB12345678901\n03 Oct 2026", "ALI BIN ABU", 10, true],
  ])("reads %s", (_label, text, merchant, amount, isTransfer) => {
    expect(parseCapture({ text }, TODAY)).toEqual({ amount, merchant, date: "2026-10-03", isTransfer });
  });

  // Hong Leong Bank's DuitNow transfer screen: the amount has no "RM" in front ("Transfer Amount
  // (MYR)" above "10.00"), the payee sits under "To" with the bank and account number, and "From"
  // is a masked account. Usually captured collapsed ("View more"); both reading orders.
  const HLB_ROWS = `Successful
04 Oct 2026 04:29PM
+ Favourite
Receipt
Transfer Amount (MYR)
10.00
DuitNow
Reference No.
20261004HLBBMYKL0101234
ORM21100000
From
****1234
To
ALI BIN ABU
EXAMPLE BANK/EXAMPLE
FINANCE BERHAD
1234567890
View more
Done`;
  const HLB_COLUMNS = `Successful
04 Oct 2026 04:29PM
+ Favourite
Receipt
Transfer Amount (MYR)
10.00
Reference No.
From
To
Account Type
Transfer Type
Recipient Reference
Transfer Date
20261004HLBBMYKL0101234
ORM21100000
****1234
ALI BIN ABU
EXAMPLE BANK/EXAMPLE
FINANCE BERHAD
1234567890
Current/Savings/
Investment
DuitNow (previously
Instant Transfer)
Fund Transfer
04 Oct 2026
DuitNow
View less
Done`;

  it.each([
    ["row by row", HLB_ROWS],
    ["labels first", HLB_COLUMNS],
  ])("reads a Hong Leong Bank transfer, %s", (_order, text) => {
    expect(parseCapture({ text }, "2026-10-04")).toEqual({ amount: 10, merchant: "ALI BIN ABU", date: "2026-10-04", isTransfer: true });
    expect(timeFromText(text)).toEqual({ hour: 16, minute: 29 });
    expect(referenceFromText(text)).toContain("20261004HLBBMYKL0101234");
  });

  // Public Bank's shared receipt image (PB blocks screenshots, so it's shared to the Shortcut instead).
  // "Money Sent", the payee under "Recipient Account", a status code and the reference you typed.
  const PB_RECEIPT = `Money Sent
RM 1.00
Reference No.
331704
Date & Time
04/10/2026 10:07:41.13 PM
DuitNow Ref No.
20261004PBBEMYKL010OR
M1234567
DuitNow Status Code
U000
Transfer Method
DuitNow Transfer
Recipient Reference
breakfast
Recipient Bank
Touch n Go eWallet
Recipient Account
ALI BIN ABU
From Account
****1234
BANK FOR THE PEOPLE
PUBLIC BANK
PUBLIC ISLAMIC BANK
Public Bank Berhad 196501000672 (6463-H)
Public Islamic Bank Berhad 197301001433 (14328-V)`;

  it("reads a Public Bank receipt", () => {
    expect(parseCapture({ text: PB_RECEIPT }, "2026-10-04")).toEqual({ amount: 1, merchant: "ALI BIN ABU", date: "2026-10-04", isTransfer: true });
    expect(timeFromText(PB_RECEIPT)).toEqual({ hour: 22, minute: 7 }); // fractions of a second don't hide the PM
  });

  it("doesn't take a status code or the reference you typed for the payee", () => {
    expect(merchantFromText("Recipient Account\nDuitNow Status Code\nU000\nALI BIN ABU")).toBe("ALI BIN ABU");
  });

  it("doesn't read RM inside a reference number as an amount", () => {
    expect(amountFromText("Reference No.\n20261004HLBBMYKL010\nORM21103782\nRM 10.00")).toBe(10);
    expect(amountFromText("RM21103782")).toBeNull();
    expect(amountFromText("Total RM1,250.00")).toBe(1250);
  });

  it("only takes a number without RM when its label says the currency", () => {
    expect(amountFromText("Transfer Amount (MYR)\n10.00")).toBe(10);
    expect(amountFromText("Total (RM)\n1,234.50")).toBe(1234.5);
    expect(amountFromText("Points earned\n10.00")).toBeNull();
    expect(amountFromText("Amount\n10.00")).toBeNull(); // no currency: could be anything
    expect(amountFromText("Total Amount (MYR)\n10.00\nRM 12.00")).toBe(12); // an RM amount still wins
  });

  it("knows a successful transfer from a successful payment", () => {
    expect(looksLikeTransfer("Transfer Successful")).toBe(true);
    expect(looksLikeTransfer("Fund Transfer Completed")).toBe(true);
    expect(looksLikeTransfer("Payment Successful")).toBe(false);
  });
});

describe("amounts", () => {
  it.each([
    ["RM12.50", 12.5],
    ["MYR 1,234.5", 1234.5],
    ["12", 12],
    [12.345, 12.35],
    [0, null],
    [-5, null],
    ["free", null],
    [null, null],
  ])("parseAmount(%j) = %j", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it("takes the paid amount, not balances, cashback or rewards", () => {
    expect(amountFromText("Balance RM 120.00\nCashback RM 0.50\nTotal Amount\nRM 15.90")).toBe(15.9);
    expect(amountFromText("Wallet balance: RM 88.00\nRM 7.00")).toBe(7);
  });

  it("doesn't take the label 'Total Amount' for a payee", () => {
    expect(merchantFromText("Total Amount\nRM 15.90\nMerchant\nKEDAI CONTOH")).toBe("KEDAI CONTOH");
  });
});

describe("dates", () => {
  it.each([
    ["03/10/2026", "2026-10-03"],
    ["3-10-2026", "2026-10-03"],
    ["2026-10-01", "2026-10-01"],
    ["1 Oct 2026, 8:00 AM", "2026-10-01"],
    ["Oct 2, 2026", "2026-10-02"],
    ["04/10/2026", null], // tomorrow: not a payment date
    ["sometime", null],
  ])("parseDate(%j) = %j", (input, expected) => {
    expect(parseDate(input, TODAY)).toBe(expected);
  });

  it("reads 12 AM and 12 PM", () => {
    expect(timeFromText("3 Oct 2026, 12:05 AM")).toEqual({ hour: 0, minute: 5 });
    expect(timeFromText("3 Oct 2026, 12:05 PM")).toEqual({ hour: 12, minute: 5 });
  });
});

describe("duplicates and transfers", () => {
  it("gives the same reference for the same receipt, whatever the order", () => {
    const ref = referenceFromText(TNG_RECEIPT);
    expect(ref).toBe("20261003101100000012345678");
    expect(referenceFromText("A 20261003TNGDMYNB030OQR12345\nB 20261003101100000012345678")).toBe(
      referenceFromText("B 20261003101100000012345678\nA 20261003TNGDMYNB030OQR12345")
    );
  });

  it("spots transfer screens", () => {
    expect(looksLikeTransfer(TRANSFER)).toBe(true);
    expect(looksLikeTransfer("DuitNow Transfer\nRM 5.00")).toBe(true);
    expect(looksLikeTransfer(QR_SUCCESS)).toBe(false);
  });
});

describe("merchant rules", () => {
  it("remembers a shop by its first distinctive word", () => {
    expect(merchantKey("GRAB* A-1234 KL")).toBe("GRAB");
    expect(merchantKey("Tealive @ Sunway Pyramid")).toBe("TEALIVE");
    expect(merchantKey("The Kedai Restaurant Contoh Sdn Bhd")).toBe("CONTOH");
    expect(merchantKey("99 & 7")).toBeNull();
  });

  it("picks the longest matching rule, on whole words", () => {
    const rules = [
      { pattern: "GRAB", tag_id: "ride" },
      { pattern: "GRAB FOOD", tag_id: "food" },
      { pattern: "TEA", tag_id: "drinks" },
    ];
    expect(matchRule("GRAB* A-1234", rules)?.tag_id).toBe("ride");
    expect(matchRule("Grab Food KL", rules)?.tag_id).toBe("food");
    expect(matchRule("TEALIVE", rules)).toBeNull(); // "TEA" isn't a whole word here
    expect(matchRule(null, rules)).toBeNull();
  });
});
