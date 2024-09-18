import { Config, FormattedTransaction } from './types';
export declare class Ledger {
    private ledger;
    private canisterId;
    /**
     * Initializes the Ledger instance.
     *
     * @param canisterId - The Canister ID of the token ledger to interact with.
     * @param config - Optional configuration object.
     */
    constructor(canisterId: string, config?: Config);
    /**
     * Retrieves the total supply of the token from the ledger.
     *
     * @returns A promise that resolves to the total supply as a bigint.
     */
    getTotalSupply(): Promise<bigint>;
    /**
     * Retrieves the total number of transactions from the ledger.
     *
     * @returns A promise that resolves to the total number of transactions as a bigint.
     */
    getTotalTransactions(): Promise<bigint>;
    /**
     * Iterates through all transactions in batches, invoking a callback for each batch.
     * Handles both current and archived transactions.
     *
     * @param callback - Function to call for each batch of transactions.
     */
    iterateTransactions(callback: (batch: FormattedTransaction[]) => boolean): Promise<void>;
    /**
     * Filters transactions based on the provided account or principal hash and applies a callback to each filtered batch.
     * The callback can return a boolean indicating whether to continue the iteration.
     *
     * @param identifier - The account or principal hash string to filter transactions.
     * @param callback - A callback function that receives the filtered transactions and returns a boolean to continue or stop.
     * @returns A promise that resolves when all relevant transactions have been processed or the callback stops the iteration.
     */
    filterTransactionsByIdentifier(identifier: string, callback: (transactions: FormattedTransaction[]) => boolean): Promise<void>;
    /**
     * Counts unique accounts in the transactions (combined from 'from' and 'to' accounts).
     *
     * @returns A promise that resolves to the count of unique accounts.
     */
    countUniqueAccounts(): Promise<{
        accounts: number;
        principals: number;
    }>;
    /**
     * Collects holders and their balances and sorts them by balance.
     *
     * @param sortOrder - Optional. The order to sort the results: 'asc' for ascending, 'desc' for descending. Default is 'desc'.
     * @returns A promise that resolves to an array of objects where each object contains an account identifier, principal, and its balance, sorted by balance.
     */
    collectHoldersAndBalances(sortOrder?: 'asc' | 'desc'): Promise<{
        account: string;
        principal: string;
        balance: bigint;
    }[]>;
}
