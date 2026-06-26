import { Interface } from '@ethersproject/abi'
import { BigNumber } from '@ethersproject/bignumber'
import { MaxUint256 } from '@ethersproject/constants'
import { Contract } from '@ethersproject/contracts'
import { ERC20_ALLOWANCE_ABI, PERMIT2_ABI } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/abis'
import { PERMIT2_ADDRESS } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import { getGnosisProvider } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/provider'

// Permit2 amounts/expirations are uint160/uint48; use the maxima for an "infinite" approval.
export const PERMIT2_MAX_AMOUNT = BigNumber.from(2).pow(160).sub(1)
export const PERMIT2_MAX_EXPIRATION = BigNumber.from(2).pow(48).sub(1)

export const erc20Interface = new Interface(ERC20_ALLOWANCE_ABI)
export const permit2Interface = new Interface(PERMIT2_ABI)

interface Erc20AllowanceContract {
  allowance: (owner: string, spender: string) => Promise<BigNumber>
}

/** Reads ERC20 `allowance(owner, spender)` on Gnosis. */
export async function readErc20Allowance(args: { owner: string; token: string; spender: string }): Promise<BigNumber> {
  const erc20 = new Contract(args.token, ERC20_ALLOWANCE_ABI, getGnosisProvider()) as unknown as Erc20AllowanceContract
  return BigNumber.from(await erc20.allowance(args.owner, args.spender))
}

/** Calldata for `ERC20.approve(spender, amount)` (defaults to max). */
export function buildErc20ApproveData(spender: string, amount: BigNumber = BigNumber.from(MaxUint256)): string {
  return erc20Interface.encodeFunctionData('approve', [spender, amount])
}

/** Calldata for `Permit2.approve(token, spender, amount, expiration)` (defaults to max/no-expiry). */
export function buildPermit2ApproveData(args: {
  token: string
  spender: string
  amount?: BigNumber
  expiration?: BigNumber
}): string {
  return permit2Interface.encodeFunctionData('approve', [
    args.token,
    args.spender,
    args.amount ?? PERMIT2_MAX_AMOUNT,
    args.expiration ?? PERMIT2_MAX_EXPIRATION,
  ])
}

export { PERMIT2_ADDRESS }
