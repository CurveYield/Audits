# Auditor Test Plan V20

## M-01

- Compare one 365-day checkpoint with 365 daily checkpoints at decay rates 0, 1, 3, and 10.
- Assert identical principal and Treasury decay transfers for identical elapsed time.
- Assert identical total reward liabilities when target yield is below cap, above cap, and crosses the cap.
- Fuzz arbitrary checkpoint partitions whose durations sum to the same total elapsed time.
- Fuzz decay-rate changes after checkpoint settlement and after the 14-day timelock.
- Test elapsed time beyond full principal extinction; rewards must stop at extinction.
- Confirm `_topUpMintReserve()` call order and mint-reservation behavior are unchanged from V20.

## M-02

- Seed ordinary rewards, migrate normally, and confirm rewards are claimed, converted, compounded, withdrawn, and moved to the replacement.
- Force reward claim, quote, swap, and deposit failures independently; normal migration must revert atomically.
- After a failed normal migration, execute emergency migration with the same matured candidate.
- Confirm old active principal becomes zero and replacement receives returned WANT.
- Confirm old strategy is `retired`, paused, cannot harvest, and cannot unpause.
- Confirm emergency migration deliberately leaves ordinary/cyGOV rewards unclaimed without blocking principal.
- Confirm emergency upgrade cannot bypass candidate validation or the seven-day delay.

## Fee split

- Verify 33% Treasury and 7% live-admin fees on excess, 40% total.
- Verify queued benchmark value still routes to Treasury.
- Transfer the admin role and confirm only the new admin receives future 7% fees.
- Fuzz conservation: user + Treasury + admin must equal the incoming reward.
