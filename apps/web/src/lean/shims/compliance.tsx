import type { PropsWithChildren } from 'react'

export type ComplianceTokenInput = {
  chainId: number
  address: string
}

export type ComplianceV2Client = Record<string, never>

export enum RestrictionReason {
  UNSPECIFIED = 0,
  DERIVATIVE = 2,
  PERMISSIONLESS_SECURITY = 3,
  REQUIRES_ACKNOWLEDGEMENT = 4,
  ACKNOWLEDGED = 5,
}

export function createComplianceV2Client(): ComplianceV2Client {
  return {}
}

export function ComplianceClientProvider({
  children,
}: PropsWithChildren<{ client?: ComplianceV2Client }>): JSX.Element {
  return <>{children}</>
}

export function useComplianceClient(): ComplianceV2Client {
  return {}
}

export function useTokenComplianceStatus(_token: ComplianceTokenInput | undefined): {
  reasons: RestrictionReason[]
  isLoading: boolean
} {
  return { reasons: [], isLoading: false }
}

export function useSetTokenAcknowledgement(): {
  acknowledgeToken: (_token: ComplianceTokenInput) => Promise<void>
  isPending: boolean
} {
  return {
    acknowledgeToken: async () => undefined,
    isPending: false,
  }
}

export function isHardBlocked(_reasons: RestrictionReason[]): boolean {
  return false
}

export function requiresAcknowledgement(_reasons: RestrictionReason[]): boolean {
  return false
}

export function isAcknowledged(_reasons: RestrictionReason[]): boolean {
  return false
}

export function isAckGated(_reasons: RestrictionReason[]): boolean {
  return false
}

export function hasUnrecognizedReason(_reasons: RestrictionReason[]): boolean {
  return false
}
