import type { AccountRef, Ledger, SourceAccount } from './source.js';

const LEDGER_ORDER: readonly Ledger[] = ['global', 'guest', 'external', 'booking'];

/**
 * Lookups over a flattened chart of accounts. Account numbers can repeat across
 * the four ledgers (apaleo has `1200` in guest and external accounts), so a
 * lookup prefers an account of the same type and then the ledger order
 * global, guest, external, booking.
 */
export class ChartIndex {
  private readonly byNumber = new Map<string, SourceAccount[]>();

  constructor(readonly accounts: readonly SourceAccount[]) {
    const ordered = [...accounts].sort((a, b) => LEDGER_ORDER.indexOf(a.ledger) - LEDGER_ORDER.indexOf(b.ledger));
    for (const account of ordered) {
      const list = this.byNumber.get(account.number) ?? [];
      list.push(account);
      this.byNumber.set(account.number, list);
    }
  }

  find(number: string, type?: string): SourceAccount | undefined {
    const candidates = this.byNumber.get(number) ?? [];
    return candidates.find((a) => a.type === type) ?? candidates[0];
  }

  has(number: string): boolean {
    return this.byNumber.has(number);
  }

  /**
   * The top-level account a ledger account rolls up to: through the parent chain
   * of the chart (or the line's own `parentNumber` when the account is not in
   * the chart), else, for per-reservation accounts without a parent, the first
   * top-level account of the same type. Undefined when nothing matches.
   */
  mainAccountOf(ref: AccountRef): SourceAccount | undefined {
    let current = this.find(ref.number, ref.type);
    let parentNumber = current ? current.parentNumber : ref.parentNumber;
    if (!current && parentNumber === undefined) return this.topLevelOfType(ref.type);
    const seen = new Set<string>();
    while (parentNumber !== undefined && !seen.has(parentNumber)) {
      seen.add(parentNumber);
      const parent = this.find(parentNumber, ref.type);
      if (!parent) break;
      current = parent;
      parentNumber = parent.parentNumber;
    }
    return current ?? this.topLevelOfType(ref.type);
  }

  private topLevelOfType(type: string): SourceAccount | undefined {
    const topLevel = this.accounts.filter((a) => a.parentNumber === undefined && a.type === type);
    return topLevel.find((a) => a.ledger === 'guest') ?? topLevel[0];
  }
}
