import { Interface } from '@ethersproject/abi'
import { BigNumber } from '@ethersproject/bignumber'
import { Contract } from '@ethersproject/contracts'
import { ERC20_ALLOWANCE_ABI, PERMIT2_ABI } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/abis'
import { PERMIT2_ADDRESS } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import { getGnosisProvider } from 'uniswap/src/features/transactions/swap/services/gnosisRouter/provider'

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

/** Calldata for `ERC20.approve(spender, amount)`. */
export function buildErc20ApproveData(spender: string, amount: BigNumber): string {
  return erc20Interface.encodeFunctionData('approve', [spender, amount])
}

/** Calldata for `Permit2.approve(token, spender, amount, expiration)`. */
export function buildPermit2ApproveData(args: {
  token: string
  spender: string
  amount: BigNumber
  expiration: BigNumber
}): string {
  return permit2Interface.encodeFunctionData('approve', [args.token, args.spender, args.amount, args.expiration])
}

export { PERMIT2_ADDRESS }
