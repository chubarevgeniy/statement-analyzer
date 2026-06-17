1. **Fix `CategoryStep` State Initialization**
   - In `src/components/ImportReview.tsx`, add `key={unknownKeys[step - fxNeeds.length].key}` to `<CategoryStep>` so state resets when navigating to the next transaction.

2. **Examples Generation Logic**
   - A helper function `selectExamples(txns)` needs to be added. This function will take a list of `{ description, amount }` objects for a category and return up to 7 examples (min, max, closest to average, closest to median, and up to 3 random others).
   - In `ImportPanel.tsx`, instead of just `getMappings()`, fetch `getAllTxns()` from `../db/transactionsDb`. Also fetch `getMappings()` if needed, but `getAllTxns()` has `categoryId`. Group transactions by `categoryId`, capturing their descriptions and amounts. Store these full objects in state, or pre-compute the 7 examples and store them as strings, wait, no. We need to recalculate them when `choices` changes in `ImportReview.tsx`.
   - To do this dynamically in `ImportReview.tsx`, we can pass all historical transactions (grouped by category) down to `ImportReview`.
   - Actually, let's keep it simple: Define `ExampleTxn = { description: string, amount: number }`. Pass `examples: Record<string, ExampleTxn[]>` to `ImportReview`.
   - In `ImportPanel.tsx`, `examples` is populated by mapping over `await getAllTxns()` and grouping by `categoryId`. For each transaction, push `{ description: t.counterpartyName ?? t.rawDescription, amount: t.amount }` to the category's array.
   - In `ImportReview.tsx`, we combine `examples` with the current `choices`. We map `unknownKeys` to find the ones that have been categorized in `choices`, and append them to the category's `ExampleTxn[]`.
   - Then, inside `<CategoryStep>` before sending to `suggestSingleCategoryLlm`, we run the 7-example selection algorithm for each category, converting the selected `ExampleTxn`s to strings like `"{description} ({amount})"` and pass `Record<string, string[]>` to `suggestSingleCategoryLlm`.

3. **Pre-commit Instructions**
   - Run verification tests using `npm test`.

Let's verify this plan with `request_plan_review`.
