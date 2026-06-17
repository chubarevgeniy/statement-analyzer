1. **Fix AI Guessing Only Once**: In `src/components/ImportReview.tsx`, `aiResult` and `aiLoading` are initialized as state variables inside `<CategoryStep>`. However, `aiResult` starts as `undefined`, and `useEffect` only runs if `aiResult === undefined` AND `aiLoading` is false. When `item` changes (because we go to the next unknown transaction), `aiResult` retains the value from the previous transaction because the component does not unmount. The solution is to reset `aiResult` to `undefined` when `item.key` changes. Alternatively, since React reuses components, we can add `key={item.key}` to `<CategoryStep>` in `ImportReview.tsx` so it fully resets state when a new item is shown, which is the cleanest fix.

2. **Update Examples Generation Logic (7 examples constraint)**:
   - The user requested that each category sent to the AI as examples should contain at most 7 examples: min, max, average, median, and 3 randoms.
   - We need actual transactions to find the min, max, etc. However, `getMappings()` in `ImportPanel.tsx` only returns `{key, categoryId}`. We need amounts to calculate min, max, average, and median.
   - The `examples` prop in `ImportPanel.tsx` and `ImportReview.tsx` and `llm.ts` will need to change to support this. We will get all transactions from `getAllTxns()`, group them by `categoryId`, and extract the description/key and amount.
   - We will select 7 examples based on the amounts for each category. Wait, the user mentioned "average" and "median". But since we just pass strings as examples, we can find the transactions that represent the min amount, max amount, amount closest to average, amount closest to median, and 3 random others. We can formulate these into descriptive strings (e.g., `"{description} ({amount})"`).
   - Alternatively, since `examples` currently is `Record<string, string[]>`, we can update it to be an array of descriptive strings like `["Groceries (15.50)", "Supermarket (120.00)", ...]`.

3. **Update Examples on Category Selection**:
   - The user also requested that when a previous transaction is accepted into a category, the list of examples in that category changes.
   - We need to pass down a function or dynamically recalculate the examples inside `ImportReview.tsx` (or update `pending.examples` in `ImportPanel.tsx`) whenever a new category choice is made. Since `choices` state is kept in `ImportReview.tsx`, we can pass `choices` and `unknownKeys` into the logic that builds examples, combining historical examples with the current session's choices.

Let's refine the plan.
