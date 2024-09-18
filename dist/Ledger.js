var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import ic from 'ic0';
import { parseTransaction } from './transactionUtils';
const MAX_LEDGER_BATCH_SIZE = BigInt(2000);
const DEFAULT_PARALLEL_BATCHES = 10;
export class Ledger {
    /**
     * Initializes the Ledger instance.
     *
     * @param canisterId - The Canister ID of the token ledger to interact with.
     * @param config - Optional configuration object.
     */
    constructor(canisterId, config = {}) {
        const icInstance = ic(canisterId);
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
    getTotalSupply() {
        return __awaiter(this, void 0, void 0, function* () {
            return BigInt(yield this.ledger.ic.call('icrc1_total_supply').catch(() => {
                throw new Error("Unable to determine total supply from ledger");
            }));
        });
    }
    /**
     * Retrieves the total number of transactions from the ledger.
     *
     * @returns A promise that resolves to the total number of transactions as a bigint.
     */
    getTotalTransactions() {
        return __awaiter(this, void 0, void 0, function* () {
            return BigInt(yield this.ledger.ic.call('get_total_tx').catch(() => __awaiter(this, void 0, void 0, function* () {
                // Fallback mechanism in case 'get_total_tx' fails
                const request = { start: BigInt(0), length: BigInt(0) };
                const transactionsInitialCall = yield this.ledger.ic.call('get_transactions', request);
                if (transactionsInitialCall && transactionsInitialCall.log_length !== undefined) {
                    return transactionsInitialCall.log_length;
                }
                else {
                    throw new Error("Unable to determine total transactions from initial call");
                }
            })));
        });
    }
    /**
     * Iterates through all transactions in batches, invoking a callback for each batch.
     * Handles both current and archived transactions.
     *
     * @param callback - Function to call for each batch of transactions.
     */
    iterateTransactions(callback) {
        return __awaiter(this, void 0, void 0, function* () {
            const totalTransactions = yield this.getTotalTransactions();
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
                const request = { start: BigInt(startSearchIndex), length: BigInt(length) };
                const transactionsBatch = yield this.ledger.ic.call('get_transactions', request);
                // Debug log: Transactions batch fetched
                if (this.ledger.debug) {
                    console.log(`Fetched ${transactionsBatch.transactions.length} transactions`);
                }
                transactionsBatch.transactions.reverse();
                const formattedBatch = transactionsBatch.transactions.map((tx, index) => parseTransaction(totalTransactions - BigInt(index) - BigInt(1), tx)).filter(tx => tx !== null);
                const continueIteration = callback(formattedBatch);
                if (!continueIteration) {
                    return;
                }
                // Check and cache archived transactions data
                if (transactionsBatch.archived_transactions && transactionsBatch.archived_transactions.length) {
                    const archived_transactions = transactionsBatch.archived_transactions;
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
                const archiveCanister = ic(archivePrincipal);
                // Get the batch max size of the current archive canister
                const initialRequest = { start: BigInt(0), length: BigInt(2000) };
                const initialResponse = yield archiveCanister.call('get_transactions', initialRequest);
                const archiveBatchSize = BigInt(initialResponse.transactions.length);
                let startIndex = end - (end % archiveBatchSize);
                let length = startIndex < archiveBatchSize ? startIndex : archiveBatchSize;
                while (startIndex >= BigInt(0)) {
                    if (this.ledger.debug) {
                        console.log(`Fetching archived transactions in parallel.`);
                        console.log(`parallel_batches=${this.ledger.parallel_batches}`);
                        console.log(`Index pointer=${startIndex}`);
                    }
                    // Fetch archive batches in parallel
                    const promises = [];
                    for (let i = 0; i < this.ledger.parallel_batches && startIndex >= BigInt(0); i++) {
                        const currentStartIndex = startIndex;
                        const request = { start: BigInt(startIndex), length: BigInt(length) };
                        promises.push(archiveCanister.call('get_transactions', request).then((batch) => ({ startIndex: currentStartIndex, batch })));
                        if (startIndex === BigInt(0)) {
                            break;
                        }
                        length = startIndex < archiveBatchSize ? startIndex : archiveBatchSize;
                        startIndex -= BigInt(length);
                    }
                    const archivedBatches = yield Promise.all(promises);
                    archivedBatches.forEach(batch => {
                        // Debug log: Archived transactions batch fetched
                        if (this.ledger.debug) {
                            console.log(`Fetched ${batch.batch.transactions.length} archived transactions`);
                            console.log(`Start index of the current batch is ${batch.startIndex}`);
                        }
                        const formattedBatch = batch.batch.transactions.map((tx, index) => parseTransaction(batch.startIndex + BigInt(index), tx)).filter(tx => tx !== null);
                        formattedBatch.reverse();
                        const continueIteration = callback(formattedBatch);
                        if (!continueIteration) {
                            return;
                        }
                    });
                    if (startIndex === BigInt(0)) {
                        break;
                    }
                }
            }
        });
    }
    /**
     * Filters transactions based on the provided account or principal hash and applies a callback to each filtered batch.
     * The callback can return a boolean indicating whether to continue the iteration.
     *
     * @param identifier - The account or principal hash string to filter transactions.
     * @param callback - A callback function that receives the filtered transactions and returns a boolean to continue or stop.
     * @returns A promise that resolves when all relevant transactions have been processed or the callback stops the iteration.
     */
    filterTransactionsByIdentifier(identifier, callback) {
        return __awaiter(this, void 0, void 0, function* () {
            const isRelevantTransaction = (tx) => {
                var _a, _b, _c, _d;
                return (((_a = tx.from) === null || _a === void 0 ? void 0 : _a.account) === identifier || ((_b = tx.from) === null || _b === void 0 ? void 0 : _b.principal) === identifier) ||
                    (((_c = tx.to) === null || _c === void 0 ? void 0 : _c.account) === identifier || ((_d = tx.to) === null || _d === void 0 ? void 0 : _d.principal) === identifier);
            };
            yield this.iterateTransactions((batch) => {
                const filteredTransactions = batch.filter(isRelevantTransaction);
                if (filteredTransactions.length > 0) {
                    // Pass filtered transactions to the provided callback and get decision to continue or stop
                    return callback(filteredTransactions);
                }
                return true; // Continue iterating if no relevant transactions are found in the current batch
            });
        });
    }
    /**
     * Counts unique accounts in the transactions (combined from 'from' and 'to' accounts).
     *
     * @returns A promise that resolves to the count of unique accounts.
     */
    countUniqueAccounts() {
        return __awaiter(this, void 0, void 0, function* () {
            const uniqueAccounts = new Set();
            const uniquePrincipals = new Set();
            yield this.iterateTransactions((batch) => {
                batch.forEach(tx => {
                    var _a, _b;
                    if ((_a = tx.from) === null || _a === void 0 ? void 0 : _a.account) {
                        uniqueAccounts.add(tx.from.account);
                        uniquePrincipals.add(tx.from.principal);
                    }
                    if ((_b = tx.to) === null || _b === void 0 ? void 0 : _b.account) {
                        uniqueAccounts.add(tx.to.account);
                        uniquePrincipals.add(tx.to.principal);
                    }
                });
                return true; // Continue iterating through all transactions
            });
            return {
                accounts: uniqueAccounts.size,
                principals: uniquePrincipals.size
            };
        });
    }
    /**
     * Collects holders and their balances and sorts them by balance.
     *
     * @param sortOrder - Optional. The order to sort the results: 'asc' for ascending, 'desc' for descending. Default is 'desc'.
     * @returns A promise that resolves to an array of objects where each object contains an account identifier, principal, and its balance, sorted by balance.
     */
    collectHoldersAndBalances() {
        return __awaiter(this, arguments, void 0, function* (sortOrder = 'desc') {
            const holders = {};
            yield this.iterateTransactions((batch) => {
                batch.forEach((tx) => {
                    var _a, _b, _c, _d;
                    if (tx.type === 'mint') {
                        if ((_a = tx.to) === null || _a === void 0 ? void 0 : _a.account) {
                            const account = tx.to.account;
                            const principal = tx.to.principal;
                            const subaccount = tx.to.subaccount;
                            if (!holders[account]) {
                                holders[account] = { account, principal, subaccount, balance: BigInt(0) };
                            }
                            holders[account].balance += tx.value;
                        }
                    }
                    else if (tx.type === 'burn') {
                        if ((_b = tx.from) === null || _b === void 0 ? void 0 : _b.account) {
                            const account = tx.from.account;
                            const principal = tx.from.principal;
                            const subaccount = tx.from.subaccount;
                            if (!holders[account]) {
                                holders[account] = { account, principal, subaccount, balance: BigInt(0) };
                            }
                            holders[account].balance -= tx.value;
                        }
                    }
                    else if (tx.type === 'transfer') {
                        if ((_c = tx.from) === null || _c === void 0 ? void 0 : _c.account) {
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
                        if ((_d = tx.to) === null || _d === void 0 ? void 0 : _d.account) {
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
                }
                else {
                    return a.balance > b.balance ? -1 : a.balance < b.balance ? 1 : 0;
                }
            });
            return positiveBalances;
        });
    }
}
