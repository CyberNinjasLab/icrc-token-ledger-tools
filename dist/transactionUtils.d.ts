import { Transaction } from '@dfinity/ledger-icrc/dist/candid/icrc_ledger';
import { FormattedTransaction } from './types';
export declare function parseTransaction(index: bigint, transaction: Transaction): FormattedTransaction | undefined;
