# `icrc-token-ledger-tools`

A utility package for interacting with ICRC token ledgers on the Internet Computer. 

Designed to work seamlessly with the ICRC ledger system, making it easier to retrieve and manipulate token transactions and balances.

## Installation

To install the package, use npm:

```bash
npm install icrc-token-ledger-tools
```

## Usage

Here is an example of how to initialize the `Ledger` class and fetch data:

```typescript
import { Ledger } from 'icrc-token-ledger-tools';

// Initialize the ledger with the token ledger canister ID
const ledger = new Ledger('your-canister-id');

try {
    // Fetch the total token supply
    const totalSupply = await ledger.getTotalSupply();
    console.log('Total Supply:', totalSupply);

    // Fetch total number of transactions
    const totalTransactions = await ledger.getTotalTransactions();
    console.log('Total Transactions:', totalTransactions);

    // Iterate through transactions
    await ledger.iterateTransactions((batch) => {
        console.log('Transaction Batch:', batch);
        return true; // Continue processing
    });

    // Filter transactions by account or principal identifier
    await ledger.filterTransactionsByIdentifier('account-or-principal-id', (filteredBatch) => {
        console.log('Filtered Transactions:', filteredBatch);
        return true; // Continue processing
    });

    // Count unique accounts
    const uniqueAccounts = await ledger.countUniqueAccounts();
    console.log('Unique Accounts:', uniqueAccounts);

    // Collect holders and balances, sorting by balance in descending order
    const holders = await ledger.collectHoldersAndBalances('desc');
    console.log('Holders and Balances:', holders);
} catch (error) {
    console.error('An error occurred:', error);
}
```

## Configuration

You can configure the ledger instance using the following options:

- **debug**: Enables debug logging.
- **parallelBatches**: Sets the number of parallel batches when fetching archived transactions.

```typescript
const ledger = new Ledger('your-canister-id', { debug: true, parallelBatches: 5 });
```

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
