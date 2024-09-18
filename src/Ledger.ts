import { GetTransactionsRequest, GetTransactionsResponse, TransactionRange } from '@dfinity/ledger-icrc/dist/candid/icrc_ledger';
import { ArchiveBatch, Config, FormattedTransaction, LedgerInstance } from './types';
import ic from 'ic0';
import { parseTransaction } from './transactionUtils';

const MAX_LEDGER_BATCH_SIZE = BigInt(2000);

const DEFAULT_PARALLEL_BATCHES = 10;

export class Ledger {
    private ledger: LedgerInstance;
    private canisterId: string;

    /**
     * Initializes the Ledger instance.
     * 
     * @param canisterId - The Canister ID of the token ledger to interact with.
     * @param config - Optional configuration object.
     */
    constructor(canisterId: string, config: Config = {}) {
        const icInstance = ic(canisterId) as any;
        this.canisterId = canisterId;
        this.ledger = {
            ic: icInstance,
            debug: config.debug || false,
            parallel_batches: config.parallelBatches || DEFAULT_PARALLEL_BATCHES
        };
    }

    /**
     * Retrieves the total supply of the token from the ledger.
     * 
     * @returns A promise that resolves to the total supply as a bigint.
     */
    async getTotalSupply(): Promise<bigint> {
        return BigInt(await this.ledger.ic.call('icrc1_total_supply').catch(() => {
            throw new Error("Unable to determine total supply from ledger");
        }));
    }

    /**
     * Retrieves the total number of transactions from the ledger.
     * 
     * @returns A promise that resolves to the total number of transactions as a bigint.
     */
    async getTotalTransactions(): Promise<bigint> {
        return BigInt(await this.ledger.ic.call('get_total_tx').catch(async () => {
            // Fallback mechanism in case 'get_total_tx' fails
            const request: GetTransactionsRequest = { start: BigInt(0), length: BigInt(0) };
            const transactionsInitialCall = await this.ledger.ic.call('get_transactions', request) as GetTransactionsResponse;
            if (transactionsInitialCall && transactionsInitialCall.log_length !== undefined) {
                return transactionsInitialCall.log_length;
            } else {
                throw new Error("Unable to determine total transactions from initial call");
            }
        }));
    }
    
    /**
     * Iterates through all transactions in batches, invoking a callback for each batch.
     * Handles both current and archived transactions.
     * 
     * @param callback - Function to call for each batch of transactions.
     */
    async iterateTransactions(callback: (batch: FormattedTransaction[]) => boolean): Promise<void> {
        const totalTransactions = await this.getTotalTransactions();
        let startSearchIndex = totalTransactions;
        let archivePrincipal = '';
        let end = BigInt(0);
    
        // Debug log: Total transactions count
        if (this.ledger.debug) {
            console.log(`Total Transactions: ${totalTransactions}`);
        }
    
        // Process current ledger transactions in batches
        while (startSearchIndex > BigInt(0)) {
            const length = startSearchIndex < MAX_LEDGER_BATCH_SIZE ? startSearchIndex : MAX_LEDGER_BATCH_SIZE;
            startSearchIndex -= BigInt(length);
    
            if (this.ledger.debug) {
                console.log(`Fetching transactions from index ${startSearchIndex} with length ${length}`);
            }
    
            const request: GetTransactionsRequest = { start: BigInt(startSearchIndex), length: BigInt(length) };
            const transactionsBatch = await this.ledger.ic.call('get_transactions', request) as GetTransactionsResponse;
    
            // Debug log: Transactions batch fetched
            if (this.ledger.debug) {
                console.log(`Fetched ${transactionsBatch.transactions.length} transactions`);
            }
    
            transactionsBatch.transactions.reverse();
    
            const formattedBatch = transactionsBatch.transactions.map((tx, index) => parseTransaction(totalTransactions - BigInt(index) - BigInt(1), tx)).filter(tx => tx !== null);
    
            const continueIteration = callback(formattedBatch as FormattedTransaction[]);
            if (!continueIteration) {
                return;
            }
    
            // Check and cache archived transactions data
            if (transactionsBatch.archived_transactions && transactionsBatch.archived_transactions.length) {
                const archived_transactions: any = transactionsBatch.archived_transactions;
                archivePrincipal = archived_transactions[0].callback[0].toText();
                if (transactionsBatch.first_index) {
                    end = BigInt(transactionsBatch.first_index);
                }
    
                if (this.ledger.debug) {
                    console.log(`Found archived transactions. Archive principal: ${archivePrincipal}, first index: ${end}`);
                }
    
                break;
            }
        }
    
        // If archived transactions are present, process them in batches
        if (archivePrincipal) {
            const archiveCanister = ic(archivePrincipal) as any;
            
            // Get the batch max size of the current archive canister
            const initialRequest: GetTransactionsRequest = { start: BigInt(0), length: BigInt(2000) };
            const initialResponse = await archiveCanister.call('get_transactions', initialRequest) as GetTransactionsResponse;
            const archiveBatchSize = BigInt(initialResponse.transactions.length);

            let startIndex = end - (end % archiveBatchSize);
            let length = startIndex < archiveBatchSize ? startIndex : archiveBatchSize;

            while (startIndex >= BigInt(0)) {
                if (this.ledger.debug) {
                    console.log(`Fetching archived transactions in parallel.`);
                    console.log(`parallel_batches=${this.ledger.parallel_batches}`);
                    console.log(`Index pointer=${startIndex}`)
                }

                // Fetch archive batches in parallel
                const promises: Promise<ArchiveBatch>[] = [];
                for (let i = 0; i < this.ledger.parallel_batches && startIndex >= BigInt(0); i++) {
                    const currentStartIndex = startIndex;
                    const request: GetTransactionsRequest = { start: BigInt(startIndex), length: BigInt(length) };
                    promises.push(
                    archiveCanister.call('get_transactions', request).then((batch: TransactionRange) => ({ startIndex: currentStartIndex, batch }))
                    );

                    if (startIndex === BigInt(0)) {
                        break;
                    }

                    length = startIndex < archiveBatchSize ? startIndex : archiveBatchSize;
                    startIndex -= BigInt(length);
                }

                const archivedBatches = await Promise.all(promises);
                archivedBatches.forEach(batch => {
                    // Debug log: Archived transactions batch fetched
                    if (this.ledger.debug) {
                        console.log(`Fetched ${batch.batch.transactions.length} archived transactions`);
                        console.log(`Start index of the current batch is ${batch.startIndex}`)
                    }
                    
                    const formattedBatch = batch.batch.transactions.map((tx, index) => parseTransaction(batch.startIndex + BigInt(index), tx)).filter(tx => tx !== null);
                    formattedBatch.reverse();
                    const continueIteration = callback(formattedBatch as FormattedTransaction[]);
                    
                    if (!continueIteration) {
                        return;
                    }
                });

                if (startIndex === BigInt(0)) {
                    break;
                }
            }
        }
    }
  

    /**
     * Filters transactions based on the provided account or principal hash and applies a callback to each filtered batch.
     * The callback can return a boolean indicating whether to continue the iteration.
     * 
     * @param identifier - The account or principal hash string to filter transactions.
     * @param callback - A callback function that receives the filtered transactions and returns a boolean to continue or stop.
     * @returns A promise that resolves when all relevant transactions have been processed or the callback stops the iteration.
     */
    async filterTransactionsByIdentifier(identifier: string, callback: (transactions: FormattedTransaction[]) => boolean): Promise<void> {
        const isRelevantTransaction = (tx: FormattedTransaction): boolean => {
            return (tx.from?.account === identifier || tx.from?.principal === identifier) ||
                (tx.to?.account === identifier || tx.to?.principal === identifier);
        };

        

        await this.iterateTransactions((batch) => {
            const filteredTransactions = batch.filter(isRelevantTransaction);
            if (filteredTransactions.length > 0) {
                // Pass filtered transactions to the provided callback and get decision to continue or stop
                return callback(filteredTransactions);
            }
            return true; // Continue iterating if no relevant transactions are found in the current batch
        });
    }

    /**
     * Counts unique accounts in the transactions (combined from 'from' and 'to' accounts).
     * 
     * @returns A promise that resolves to the count of unique accounts.
     */
    async countUniqueAccounts(): Promise<{ accounts: number, principals: number }> {
        const uniqueAccounts = new Set<string>();
        const uniquePrincipals = new Set<string>();

        await this.iterateTransactions((batch) => {
            batch.forEach(tx => {
                if (tx.from?.account) {
                    uniqueAccounts.add(tx.from.account);
                    uniquePrincipals.add(tx.from.principal);
                }
                if (tx.to?.account) {
                    uniqueAccounts.add(tx.to.account);
                    uniquePrincipals.add(tx.to.principal);
                }
            });
            return true; // Continue iterating through all transactions
        });

        return {
            accounts: uniqueAccounts.size,
            principals: uniquePrincipals.size
        }
    }

    /**
     * Collects holders and their balances and sorts them by balance.
     * 
     * @param sortOrder - Optional. The order to sort the results: 'asc' for ascending, 'desc' for descending. Default is 'desc'.
     * @returns A promise that resolves to an array of objects where each object contains an account identifier, principal, and its balance, sorted by balance.
     */
    async collectHoldersAndBalances(sortOrder: 'asc' | 'desc' = 'desc'): Promise<{ account: string; principal: string; balance: bigint }[]> {
        const holders: { [account: string]: { account: string; principal: string; subaccount: string | undefined; balance: bigint } } = {};

        await this.iterateTransactions((batch) => {
            batch.forEach((tx: FormattedTransaction) => {
                if (tx.type === 'mint') {
                    if (tx.to?.account) {
                        const account = tx.to.account;
                        const principal = tx.to.principal;
                        const subaccount = tx.to.subaccount;
                        if (!holders[account]) {
                            holders[account] = { account, principal, subaccount, balance: BigInt(0) };
                        }
                        holders[account].balance += tx.value;
                    }
                } else if (tx.type === 'burn') {
                    if (tx.from?.account) {
                        const account = tx.from.account;
                        const principal = tx.from.principal;
                        const subaccount = tx.from.subaccount;
                        if (!holders[account]) {
                            holders[account] = { account, principal, subaccount, balance: BigInt(0) };
                        }
                        holders[account].balance -= tx.value;
                    }
                } else if (tx.type === 'transfer') {
                    if (tx.from?.account) {
                        const fromAccount = tx.from.account;
                        const fromPrincipal = tx.from.principal;
                        const fromSubaccount = tx.from.subaccount;
                        if (!holders[fromAccount]) {
                            holders[fromAccount] = { account: fromAccount, principal: fromPrincipal, subaccount: fromSubaccount, balance: BigInt(0) };
                        }
                        holders[fromAccount].balance -= tx.value;
                        if (tx.fee) {
                            holders[fromAccount].balance -= tx.fee;
                        }
                    }
                    if (tx.to?.account) {
                        const toAccount = tx.to.account;
                        const toPrincipal = tx.to.principal;
                        const toSubaccount = tx.to.subaccount;
                        if (!holders[toAccount]) {
                            holders[toAccount] = { account: toAccount, principal: toPrincipal, subaccount: toSubaccount, balance: BigInt(0) };
                        }
                        holders[toAccount].balance += tx.value;
                    }
                }
            });
            return true; // Continue iterating through all transactions
        });

        // Filter out accounts with balances <= 0
        const positiveBalances = Object.values(holders)
            .filter(holder => holder.balance > BigInt(0));

        // Sort the filtered balances
        positiveBalances.sort((a, b) => {
            if (sortOrder === 'asc') {
                return a.balance < b.balance ? -1 : a.balance > b.balance ? 1 : 0;
            } else {
                return a.balance > b.balance ? -1 : a.balance < b.balance ? 1 : 0;
            }
        });

        return positiveBalances;
    }

}
