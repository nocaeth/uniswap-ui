import { formatUnits, getAddress, parseAbi, type PublicClient } from 'viem'

export const GNO_ADDRESS = '0x9c58bacc331c9aa871afd802db6379a98e80cedb'
export const OSGNO_ADDRESS = '0xf490c80aae5f2616d3e3bda2483e30c4cb21d1a0'
export const OSGNO_RATE_ORACLE_ADDRESS = getAddress('0x9B1b13afA6a57e54C03AD0428a4766C39707D272')

const MAX_OSGNO_RATE = 10

const OSGNO_RATE_ORACLE_ABI = parseAbi(['function getRate() view returns (uint256)'])

export function isOsgnoAddress(address: string): boolean {
  return address.toLowerCase() === OSGNO_ADDRESS
}

export function deriveOsgnoPriceUsd(gnoPriceUsd: number | undefined, rate: number | undefined): number | undefined {
  if (!gnoPriceUsd || !rate) {
    return undefined
  }
  const price = gnoPriceUsd * rate
  return Number.isFinite(price) && price > 0 ? price : undefined
}

export function applyOsgnoOracleUsdPrice(usd: Map<string, number>, rate: number | undefined): void {
  const osGnoPriceUsd = deriveOsgnoPriceUsd(usd.get(GNO_ADDRESS), rate)
  if (osGnoPriceUsd !== undefined) {
    usd.set(OSGNO_ADDRESS, osGnoPriceUsd)
  }
}

export async function fetchOsgnoRate(client: PublicClient): Promise<number | undefined> {
  const rawRate = await client.readContract({
    address: OSGNO_RATE_ORACLE_ADDRESS,
    abi: OSGNO_RATE_ORACLE_ABI,
    functionName: 'getRate',
  })
  const rate = Number(formatUnits(rawRate, 18))
  return Number.isFinite(rate) && rate > 0 && rate <= MAX_OSGNO_RATE ? rate : undefined
}
